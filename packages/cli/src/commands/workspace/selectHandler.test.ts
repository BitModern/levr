import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LocalContext } from '../../context.js';

vi.mock('../../auth/resolve-token.js', () => ({
  resolveToken: vi.fn(),
}));

vi.mock('../../utils/sdk-client.js', () => ({
  configureClient: vi.fn(),
}));

vi.mock('@levr/sdk', () => ({
  authGetSitesV1: vi.fn(),
}));

vi.mock('../../workspace/workspace-store.js', () => ({
  saveWorkspace: vi.fn(),
}));

import { selectHandler } from './selectHandler.js';
import { resolveToken } from '../../auth/resolve-token.js';
import { authGetSitesV1 } from '@levr/sdk';
import { saveWorkspace } from '../../workspace/workspace-store.js';

const mockResolveToken = vi.mocked(resolveToken);
const mockAuthGetSites = vi.mocked(authGetSitesV1);
const mockSaveWorkspace = vi.mocked(saveWorkspace);

const logError = vi.fn();
const logSuccess = vi.fn();

function createMockContext(): LocalContext {
  logError.mockReset();
  logSuccess.mockReset();
  return {
    process: {
      stdout: { write: vi.fn() },
      stderr: { write: vi.fn() },
      exitCode: 0,
    },
    logger: {
      error: logError,
      info: vi.fn(),
      success: logSuccess,
      warning: vi.fn(),
      debug: vi.fn(),
      setVerbose: vi.fn(),
    },
  } as unknown as LocalContext;
}

beforeEach(() => {
  vi.clearAllMocks();
});

const sitesResponse = {
  ok: true,
  data: {
    sites: [
      {
        workspace_id: 'ws-1',
        workspace_name: 'Acme',
        role: 'owner',
        is_primary: true,
        user_id: 'u-1',
        last_accessed_at: null,
      },
    ],
    current_workspace_id: 'ws-1',
  },
  error: undefined,
  request: new Request('http://test'),
  response: new Response(),
} as never;

describe('selectHandler', () => {
  it('shows error when not authenticated', async () => {
    mockResolveToken.mockRejectedValue(new Error('No auth'));
    const ctx = createMockContext();
    await selectHandler.call(ctx, {} as Record<string, never>, 'ws-1');
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('levr auth login'),
    );
    expect(ctx.process.exitCode).toBe(1);
  });

  it('saves workspace when valid', async () => {
    mockResolveToken.mockResolvedValue({ token: 'tok', type: 'jwt' });
    mockAuthGetSites.mockResolvedValue(sitesResponse);

    const ctx = createMockContext();
    await selectHandler.call(ctx, {} as Record<string, never>, 'ws-1');

    expect(mockSaveWorkspace).toHaveBeenCalledWith('ws-1');
    expect(logSuccess).toHaveBeenCalledWith(expect.stringContaining('Acme'));
  });

  it('errors when workspace not found', async () => {
    mockResolveToken.mockResolvedValue({ token: 'tok', type: 'jwt' });
    mockAuthGetSites.mockResolvedValue(sitesResponse);

    const ctx = createMockContext();
    await selectHandler.call(ctx, {} as Record<string, never>, 'ws-bad');

    expect(logError).toHaveBeenCalledWith(expect.stringContaining('not found'));
    expect(ctx.process.exitCode).toBe(1);
  });
});
