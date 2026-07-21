import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock workspace-store
vi.mock('./workspace-store.js', () => ({
  loadWorkspace: vi.fn(() => null),
  saveWorkspace: vi.fn(),
  clearWorkspace: vi.fn(),
}));

// Mock @levr/sdk
vi.mock('@levr/sdk', () => ({
  authGetSitesV1: vi.fn(),
}));

import { resolveWorkspace, autoSelectWorkspace } from './resolve-workspace.js';
import { authGetSitesV1 } from '@levr/sdk';
import {
  loadWorkspace,
  saveWorkspace,
  clearWorkspace,
} from './workspace-store.js';

const mockAuthGetSites = vi.mocked(authGetSitesV1);
const mockLoadWorkspace = vi.mocked(loadWorkspace);
const mockSaveWorkspace = vi.mocked(saveWorkspace);
const mockClearWorkspace = vi.mocked(clearWorkspace);

interface TestSite {
  workspace_id: string;
  workspace_name: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'guest';
  is_primary: boolean;
  last_accessed_at: string | null;
}

const site1: TestSite = {
  workspace_id: 'ws-1',
  workspace_name: 'Workspace One',
  user_id: 'u-1',
  role: 'owner',
  is_primary: true,
  last_accessed_at: null,
};
const site2: TestSite = {
  workspace_id: 'ws-2',
  workspace_name: 'Workspace Two',
  user_id: 'u-1',
  role: 'member',
  is_primary: false,
  last_accessed_at: null,
};

function mockSites(sites: TestSite[]) {
  mockAuthGetSites.mockResolvedValue({
    ok: true,
    data: { sites, current_workspace_id: sites[0]?.workspace_id ?? '' },
    error: undefined,
    request: new Request('http://test'),
    response: new Response(),
  } as never);
}

const originalEnv = process.env;

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...originalEnv };
  delete process.env['LEVR_WORKSPACE_ID'];
});

afterEach(() => {
  process.env = originalEnv;
});

describe('resolveWorkspace', () => {
  describe('step 1: --workspace-id flag', () => {
    it('returns flag value when valid', async () => {
      mockSites([site1, site2]);
      const result = await resolveWorkspace('ws-1');
      expect(result).toEqual({ workspaceId: 'ws-1', source: 'flag' });
    });

    it('throws when flag value not in sites', async () => {
      mockSites([site1]);
      await expect(resolveWorkspace('ws-bad')).rejects.toThrow(
        "Workspace ws-bad not found. Run 'levr workspace list'.",
      );
    });
  });

  describe('step 2: LEVR_WORKSPACE_ID env', () => {
    it('returns env value when valid', async () => {
      process.env['LEVR_WORKSPACE_ID'] = 'ws-2';
      mockSites([site1, site2]);
      const result = await resolveWorkspace();
      expect(result).toEqual({ workspaceId: 'ws-2', source: 'env' });
    });

    it('throws when env value not in sites', async () => {
      process.env['LEVR_WORKSPACE_ID'] = 'ws-invalid';
      mockSites([site1]);
      await expect(resolveWorkspace()).rejects.toThrow(
        "LEVR_WORKSPACE_ID ws-invalid not found. Run 'levr workspace list'.",
      );
    });
  });

  describe('step 3: disk cache', () => {
    it('returns cached value when valid', async () => {
      mockLoadWorkspace.mockReturnValue('ws-1');
      mockSites([site1, site2]);
      const result = await resolveWorkspace();
      expect(result).toEqual({ workspaceId: 'ws-1', source: 'cache' });
    });

    it('clears stale cache and falls through', async () => {
      mockLoadWorkspace.mockReturnValue('ws-stale');
      mockSites([site1]);
      const result = await resolveWorkspace();
      expect(mockClearWorkspace).toHaveBeenCalled();
      // Falls through to auto-select (single workspace)
      expect(result).toEqual({ workspaceId: 'ws-1', source: 'auto' });
    });
  });

  describe('step 4: auto-select', () => {
    it('auto-selects and persists when single workspace', async () => {
      mockSites([site1]);
      const result = await resolveWorkspace();
      expect(result).toEqual({ workspaceId: 'ws-1', source: 'auto' });
      expect(mockSaveWorkspace).toHaveBeenCalledWith('ws-1');
    });

    it('throws when no workspaces', async () => {
      mockSites([]);
      await expect(resolveWorkspace()).rejects.toThrow(
        'No workspaces available.',
      );
    });
  });

  describe('step 5: multiple workspaces error', () => {
    it('throws with workspace list', async () => {
      mockSites([site1, site2]);
      await expect(resolveWorkspace()).rejects.toThrow(
        'Multiple workspaces. Select one:',
      );
    });

    it('includes workspace names and IDs in error', async () => {
      mockSites([site1, site2]);
      await expect(resolveWorkspace()).rejects.toThrow('Workspace One (ws-1)');
    });
  });

  describe('API failure', () => {
    it('throws descriptive error on API failure', async () => {
      mockAuthGetSites.mockRejectedValue(new Error('Network error'));
      await expect(resolveWorkspace()).rejects.toThrow(
        "Failed to list workspaces. Check your connection and run 'levr auth login'.",
      );
    });

    it('throws descriptive error on API error response', async () => {
      mockAuthGetSites.mockResolvedValue({
        ok: false,
        data: undefined,
        error: { message: 'Unauthorized' },
        request: new Request('http://test'),
        response: new Response(null, { status: 401 }),
      } as never);
      await expect(resolveWorkspace()).rejects.toThrow(
        "Failed to list workspaces. Check your connection and run 'levr auth login'.",
      );
    });
  });

  describe('sites caching', () => {
    it('fetches sites only once per resolveWorkspace call', async () => {
      // Cache miss -> falls through to auto-select, both need sites
      mockLoadWorkspace.mockReturnValue('ws-stale');
      mockSites([site1]);
      await resolveWorkspace();
      // authGetSitesV1 should be called only once despite cache miss + auto-select
      expect(mockAuthGetSites).toHaveBeenCalledTimes(1);
    });
  });
});

describe('autoSelectWorkspace', () => {
  it('returns single with workspace info and persists', async () => {
    mockSites([site1]);
    const result = await autoSelectWorkspace();
    expect(result).toEqual({
      kind: 'single',
      workspaceId: 'ws-1',
      workspaceName: 'Workspace One',
    });
    expect(mockSaveWorkspace).toHaveBeenCalledWith('ws-1');
  });

  it('returns multiple with count for multi-workspace', async () => {
    mockSites([site1, site2]);
    const result = await autoSelectWorkspace();
    expect(result).toEqual({ kind: 'multiple', count: 2 });
    expect(mockSaveWorkspace).not.toHaveBeenCalled();
  });

  it('returns none when no workspaces', async () => {
    mockSites([]);
    const result = await autoSelectWorkspace();
    expect(result).toEqual({ kind: 'none' });
  });

  it('returns none on API failure (non-fatal)', async () => {
    mockAuthGetSites.mockRejectedValue(new Error('Network error'));
    const result = await autoSelectWorkspace();
    expect(result).toEqual({ kind: 'none' });
  });
});
