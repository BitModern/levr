import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LocalContext } from '../../context.js';

vi.mock('../../auth/resolve-token.js', () => ({
  resolveToken: vi.fn(),
  CredentialsMismatchError: class extends Error {},
}));

vi.mock('../../utils/sdk-client.js', () => ({
  configureClient: vi.fn(),
}));

vi.mock('@levr/sdk', () => ({
  authGetSitesV1: vi.fn(),
}));

vi.mock('../../workspace/workspace-store.js', () => ({
  loadWorkspace: vi.fn(() => null),
}));

import { listHandler } from './listHandler.js';
import { resolveToken } from '../../auth/resolve-token.js';
import { authGetSitesV1 } from '@levr/sdk';
import { loadWorkspace } from '../../workspace/workspace-store.js';

const mockResolveToken = vi.mocked(resolveToken);
const mockAuthGetSites = vi.mocked(authGetSitesV1);
const mockLoadWorkspace = vi.mocked(loadWorkspace);

const logError = vi.fn();
const logInfo = vi.fn();
const logSuccess = vi.fn();

function createMockContext(): LocalContext {
  const output: string[] = [];
  logError.mockReset();
  logInfo.mockReset();
  logSuccess.mockReset();
  return {
    process: {
      stdout: {
        write: vi.fn((s: string) => {
          output.push(s);
          return true;
        }),
      },
      stderr: { write: vi.fn() },
      exitCode: 0,
    },
    logger: {
      error: logError,
      info: logInfo,
      success: logSuccess,
      warning: vi.fn(),
      debug: vi.fn(),
      setVerbose: vi.fn(),
    },
    _output: output,
  } as unknown as LocalContext & { _output: string[] };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listHandler', () => {
  it('forwards the resolveToken error when not authenticated', async () => {
    mockResolveToken.mockRejectedValue(
      new Error("Not authenticated. Run 'levr auth login' first."),
    );
    const ctx = createMockContext();
    await listHandler.call(ctx);
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('levr auth login'),
    );
    expect(ctx.process.exitCode).toBe(1);
  });

  it('surfaces the cross-environment mismatch message verbatim', async () => {
    mockResolveToken.mockRejectedValue(
      new Error(
        'Stored credentials are for https://api.levr.one, but this command targets https://api.levr.now.',
      ),
    );
    const ctx = createMockContext();
    await listHandler.call(ctx);
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('Stored credentials are for'),
    );
    expect(ctx.process.exitCode).toBe(1);
  });

  it('lists workspaces with current indicator', async () => {
    mockResolveToken.mockResolvedValue({ token: 'tok', type: 'jwt' });
    mockAuthGetSites.mockResolvedValue({
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
          {
            workspace_id: 'ws-2',
            workspace_name: 'Beta',
            role: 'member',
            is_primary: false,
            user_id: 'u-1',
            last_accessed_at: null,
          },
        ],
        current_workspace_id: 'ws-1',
      },
      error: undefined,
      request: new Request('http://test'),
      response: new Response(),
    } as never);
    mockLoadWorkspace.mockReturnValue('ws-1');

    const ctx = createMockContext();
    await listHandler.call(ctx);

    const output = (
      ctx.process.stdout.write as ReturnType<typeof vi.fn>
    ).mock.calls
      .map((c: string[]) => c[0])
      .join('');
    expect(output).toContain('Acme (ws-1) [owner] *');
    expect(output).toContain('Beta (ws-2) [member]');
    expect(output).not.toContain('Beta (ws-2) [member] *');
  });
});
