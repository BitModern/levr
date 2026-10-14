import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import chalk from 'chalk';
import type { LocalContext } from '../../context.js';
import type {
  DeviceAuthorizationResponse,
  OAuthTokenResponse,
} from '../../types/auth-types.js';

/**
 * internal — `levr auth login --workspace <url_key|name>`.
 *
 * A url_key-shaped hint rides on the authorize request (PKCE: RFC 8707
 * `resource`; device: a `workspace` query on the verification URL) so
 * auth-web can skip its workspace picker for a member. After the token
 * arrives the hint is resolved by key or name, exactly as
 * `mcp add --workspace` resolves it, and becomes the CLI's selected
 * workspace. An unknown hint is fail-closed: nothing is written.
 */
const {
  mockWriteCredentials,
  mockSaveWorkspace,
  mockFetchSites,
  mockAutoSelect,
} = vi.hoisted(() => ({
  mockWriteCredentials: vi.fn(),
  mockSaveWorkspace: vi.fn(),
  mockFetchSites: vi.fn(),
  mockAutoSelect: vi.fn(),
}));
vi.mock('../../auth/credentials.js', () => ({
  readCredentials: vi.fn(() => null),
  writeCredentials: mockWriteCredentials,
}));
vi.mock('../../workspace/workspace-store.js', () => ({
  loadWorkspace: vi.fn(() => null),
  saveWorkspace: mockSaveWorkspace,
  clearWorkspace: vi.fn(),
}));
vi.mock('../../workspace/resolve-workspace.js', () => ({
  fetchSites: mockFetchSites,
  autoSelectWorkspace: mockAutoSelect,
}));
vi.mock('../../utils/sdk-client.js', () => ({ configureClient: vi.fn() }));

const { mockRequestDeviceCode, mockPollForDeviceToken } = vi.hoisted(() => ({
  mockRequestDeviceCode: vi.fn(),
  mockPollForDeviceToken: vi.fn(),
}));
vi.mock('../../auth/device-flow.js', () => ({
  requestDeviceCode: mockRequestDeviceCode,
  pollForDeviceToken: mockPollForDeviceToken,
}));
vi.mock('../../auth/localhost-server.js', () => ({
  startCallbackServer: () => ({
    port: Promise.resolve(4321),
    code: Promise.resolve({ code: 'auth-code' }),
    close: vi.fn(),
  }),
}));
vi.mock('open', () => ({ default: vi.fn() }));

import { performLogin } from './loginHandler.js';
import { resetSessionApiUrl } from '../../utils/env.js';

const TOKEN: OAuthTokenResponse = {
  access_token: 'at',
  token_type: 'Bearer',
  expires_in: 3600,
  refresh_token: 'rt',
  scope: 'read:own write:own',
  user: { id: 'acct-1', email: 'a@example.com', workspace_id: '' },
};
const DEVICE: DeviceAuthorizationResponse = {
  device_code: 'dc',
  user_code: 'ABCD-EFGH',
  verification_uri: 'http://localhost:3021/auth/device',
  verification_uri_complete: 'http://localhost:3021/auth/device?code=ABCD-EFGH',
  expires_in: 300,
  interval: 5,
};
const SITES = [
  {
    workspace_id: 'id-acme',
    workspace_name: 'Acme',
    workspace_url_key: 'acme',
  },
  {
    workspace_id: 'id-beta',
    workspace_name: 'Beta',
    workspace_url_key: 'beta',
  },
];

function createMockContext(): LocalContext & {
  output: string[];
  errors: string[];
} {
  const output: string[] = [];
  const errors: string[] = [];
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
      error: vi.fn((msg: string) => errors.push(msg)),
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      debug: vi.fn(),
      setVerbose: vi.fn(),
    },
    output,
    errors,
  } as unknown as LocalContext & { output: string[]; errors: string[] };
}

// Plain output: the URLs are matched verbatim below.
chalk.level = 0;

/** Everything written to stdout. */
function plainOutput(ctx: { output: string[] }): string {
  return ctx.output.join('');
}

/** The authorize URL the PKCE flow told the user to visit. */
function authorizeUrlOf(ctx: { output: string[] }): URL {
  const match = /(http:\/\/localhost:3021\/auth\/oauth\/authorize\?\S+)/.exec(
    plainOutput(ctx),
  );
  if (!match) throw new Error('no authorize URL printed');
  return new URL(match[1]!);
}

describe('performLogin --workspace (internal)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      LEVR_URL: 'http://localhost:9999',
      LEVR_AUTH_URL: 'http://localhost:3021',
    };
    delete process.env['LEVR_MCP_URL'];
    delete process.env['LEVR_TOKEN'];
    resetSessionApiUrl();
    vi.clearAllMocks();
    mockRequestDeviceCode.mockResolvedValue(DEVICE);
    mockPollForDeviceToken.mockResolvedValue(TOKEN);
    mockFetchSites.mockResolvedValue(SITES);
    mockAutoSelect.mockResolvedValue({ kind: 'multiple', count: 2 });
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(TOKEN) }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    resetSessionApiUrl();
  });

  describe('browser (PKCE)', () => {
    it('a url_key names the scoped MCP URL as the resource, so the picker is skipped', async () => {
      const ctx = createMockContext();
      const ok = await performLogin(ctx, {
        deviceCode: false,
        workspace: 'acme',
      });

      expect(ok).toBe(true);
      expect(authorizeUrlOf(ctx).searchParams.get('resource')).toBe(
        'http://localhost:9999/v1/mcp/w/acme',
      );
      expect(mockWriteCredentials).toHaveBeenCalledTimes(1);
      expect(mockSaveWorkspace).toHaveBeenCalledWith('id-acme');
      expect(plainOutput(ctx)).toContain('Acme');
      // The hint decided the selection; the single-workspace auto-select is
      // not consulted.
      expect(mockAutoSelect).not.toHaveBeenCalled();
    });

    it('a name cannot be looked up before login: no resource, resolved afterwards', async () => {
      const ctx = createMockContext();
      const ok = await performLogin(ctx, {
        deviceCode: false,
        workspace: 'Beta',
      });

      expect(ok).toBe(true);
      expect(authorizeUrlOf(ctx).searchParams.has('resource')).toBe(false);
      expect(mockWriteCredentials).toHaveBeenCalledTimes(1);
      expect(mockSaveWorkspace).toHaveBeenCalledWith('id-beta');
    });

    it('an unknown hint exits 1 and writes nothing (fail_closed)', async () => {
      const ctx = createMockContext();
      const ok = await performLogin(ctx, {
        deviceCode: false,
        workspace: 'nope',
      });

      expect(ok).toBe(false);
      expect(ctx.process.exitCode).toBe(1);
      expect(mockWriteCredentials).not.toHaveBeenCalled();
      expect(mockSaveWorkspace).not.toHaveBeenCalled();
      const errors = ctx.errors.join('\n');
      expect(errors).toContain('Acme (acme)');
      expect(errors).toContain('levr auth login --workspace');
    });

    it('a failed workspace lookup is reported as such, and still saves nothing', async () => {
      mockFetchSites.mockRejectedValue(
        new Error('Failed to list workspaces. Check your connection.'),
      );
      const ctx = createMockContext();
      const ok = await performLogin(ctx, {
        deviceCode: false,
        workspace: 'acme',
      });

      expect(ok).toBe(false);
      expect(ctx.process.exitCode).toBe(1);
      expect(mockWriteCredentials).not.toHaveBeenCalled();
      expect(mockSaveWorkspace).not.toHaveBeenCalled();
      const errors = ctx.errors.join('\n');
      expect(errors).toContain('Check your connection');
      expect(errors).not.toContain('No workspace');
    });

    it('an MCP URL already pinned to a workspace cannot carry the hint: the login goes on without it', async () => {
      process.env['LEVR_MCP_URL'] = 'http://localhost:9999/v1/mcp/w/other';
      const ctx = createMockContext();
      const ok = await performLogin(ctx, {
        deviceCode: false,
        workspace: 'acme',
      });

      expect(ok).toBe(true);
      expect(authorizeUrlOf(ctx).searchParams.has('resource')).toBe(false);
      expect(mockSaveWorkspace).toHaveBeenCalledWith('id-acme');
    });

    it('without a hint nothing changes: no resource, auto-select as before', async () => {
      const ctx = createMockContext();
      const ok = await performLogin(ctx, { deviceCode: false });

      expect(ok).toBe(true);
      expect(authorizeUrlOf(ctx).searchParams.has('resource')).toBe(false);
      expect(mockWriteCredentials).toHaveBeenCalledTimes(1);
      expect(mockAutoSelect).toHaveBeenCalledTimes(1);
      expect(mockSaveWorkspace).not.toHaveBeenCalled();
      expect(mockFetchSites).not.toHaveBeenCalled();
    });
  });

  describe('--device-code', () => {
    it('a url_key rides on the verification URL, so the picker is skipped', async () => {
      const ctx = createMockContext();
      const ok = await performLogin(ctx, {
        deviceCode: true,
        workspace: 'acme',
      });

      expect(ok).toBe(true);
      expect(plainOutput(ctx)).toContain(
        'http://localhost:3021/auth/device?workspace=acme',
      );
      expect(mockWriteCredentials).toHaveBeenCalledTimes(1);
      expect(mockSaveWorkspace).toHaveBeenCalledWith('id-acme');
    });

    it('a name is resolved after approval; the verification URL is unchanged', async () => {
      const ctx = createMockContext();
      const ok = await performLogin(ctx, {
        deviceCode: true,
        workspace: 'Beta',
      });

      expect(ok).toBe(true);
      expect(plainOutput(ctx)).toContain('http://localhost:3021/auth/device');
      expect(plainOutput(ctx)).not.toContain('workspace=');
      expect(mockSaveWorkspace).toHaveBeenCalledWith('id-beta');
    });

    it('an unknown hint exits 1 and writes nothing (fail_closed)', async () => {
      const ctx = createMockContext();
      const ok = await performLogin(ctx, {
        deviceCode: true,
        workspace: 'nope',
      });

      expect(ok).toBe(false);
      expect(ctx.process.exitCode).toBe(1);
      expect(mockWriteCredentials).not.toHaveBeenCalled();
      expect(mockSaveWorkspace).not.toHaveBeenCalled();
      expect(ctx.errors.join('\n')).toContain('Acme (acme)');
    });
  });
});
