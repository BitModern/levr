import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import chalk from 'chalk';
import type { LocalContext } from '../../context.js';
import type {
  DeviceAuthorizationResponse,
  OAuthTokenResponse,
} from '../../types/auth-types.js';
import {
  generateCodeVerifier,
  generateCodeChallenge,
} from '../../auth/pkce.js';

const {
  mockWriteCredentials,
  mockRequestDeviceCode,
  mockPollForDeviceToken,
  mockOpen,
  callback,
} = vi.hoisted(() => ({
  mockWriteCredentials: vi.fn(),
  mockRequestDeviceCode: vi.fn(),
  mockPollForDeviceToken: vi.fn(),
  mockOpen: vi.fn(),
  // What the localhost callback server does in each test.
  callback: {
    code: (): Promise<{ code: string }> =>
      Promise.resolve({ code: 'auth-code' }),
    close: vi.fn(),
  },
}));

vi.mock('../../auth/credentials.js', () => ({
  readCredentials: vi.fn(() => null),
  writeCredentials: mockWriteCredentials,
}));
vi.mock('../../auth/device-flow.js', () => ({
  requestDeviceCode: mockRequestDeviceCode,
  pollForDeviceToken: mockPollForDeviceToken,
}));
vi.mock('../../auth/localhost-server.js', () => ({
  startCallbackServer: () => ({
    port: Promise.resolve(4321),
    code: callback.code(),
    close: callback.close,
  }),
}));
vi.mock('open', () => ({ default: mockOpen }));
vi.mock('../../utils/sdk-client.js', () => ({ configureClient: vi.fn() }));
vi.mock('../../workspace/resolve-workspace.js', () => ({
  fetchSites: vi.fn(() => Promise.resolve([])),
  autoSelectWorkspace: vi.fn(() => Promise.resolve({ kind: 'none' })),
}));

import { loginHandler, performLogin } from './loginHandler.js';
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

// Test the PKCE flow orchestration components individually.
// Full integration test (spawn CLI → mock server) is in __tests__/.
// Workspace auto-selection on login is tested via autoSelectWorkspace
// in workspace/resolve-workspace.test.ts.

describe('loginHandler PKCE flow', () => {
  it('generates a valid PKCE pair for the auth URL', () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);

    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    // Challenge should be ~43 chars (256-bit hash base64url)
    expect(challenge.length).toBe(43);
  });
});

describe('performLogin', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetSessionApiUrl();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetSessionApiUrl();
  });

  function createMockContext(): LocalContext & { errors: string[] } {
    const errors: string[] = [];
    return {
      process: {
        stdout: { write: vi.fn(() => true) },
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
      errors,
    } as unknown as LocalContext & { errors: string[] };
  }

  it('fails fast with a clear error when the auth URL cannot be derived from --url', async () => {
    delete process.env['LEVR_AUTH_URL'];

    const ctx = createMockContext();
    const ok = await performLogin(ctx, {
      deviceCode: false,
      url: 'http://localhost:9999',
    });

    expect(ok).toBe(false);
    expect(ctx.process.exitCode).toBe(1);
    expect(ctx.errors.join('\n')).toContain('LEVR_AUTH_URL');
  });
});

/**
 * internal (D8): signup and the browser flow's fallbacks. Device code is
 * never the first choice, but every path where the browser cannot work
 * reaches it: a headless host, `d` while waiting, a callback timeout.
 * Ctrl-C while waiting cancels (exit 130) with the terminal restored.
 */
describe('performLogin browser flow and device-code fallback (internal)', () => {
  const originalEnv = process.env;

  /** A raw-mode-capable terminal on stdin. */
  function fakeStdin() {
    const stdin = new EventEmitter() as EventEmitter & {
      isTTY: boolean;
      setRawMode: ReturnType<typeof vi.fn>;
      resume: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
    };
    stdin.isTTY = true;
    stdin.setRawMode = vi.fn();
    stdin.resume = vi.fn();
    stdin.pause = vi.fn();
    return stdin;
  }

  function createContext(stdin?: ReturnType<typeof fakeStdin>) {
    const output: string[] = [];
    const errors: string[] = [];
    const ctx = {
      process: {
        stdin,
        stdout: {
          isTTY: true,
          write: vi.fn((text: string) => {
            output.push(text);
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
    } as unknown as LocalContext;
    return { ctx, output, errors };
  }

  function authorizeUrlIn(output: string[]): URL {
    const match = /(http:\/\/localhost:3021\/auth\/oauth\/authorize\?\S+)/.exec(
      output.join(''),
    );
    if (!match) throw new Error('no authorize URL printed');
    return new URL(match[1]!);
  }

  beforeEach(() => {
    chalk.level = 0;
    process.env = {
      ...originalEnv,
      LEVR_URL: 'http://localhost:9999',
      LEVR_AUTH_URL: 'http://localhost:3021',
      DISPLAY: ':0',
    };
    delete process.env['SSH_CONNECTION'];
    delete process.env['LEVR_MCP_URL'];
    resetSessionApiUrl();
    vi.clearAllMocks();
    callback.code = () => Promise.resolve({ code: 'auth-code' });
    mockOpen.mockResolvedValue(undefined);
    mockRequestDeviceCode.mockResolvedValue(DEVICE);
    mockPollForDeviceToken.mockResolvedValue(TOKEN);
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(TOKEN) }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    resetSessionApiUrl();
  });

  it('signup opens the authorize URL with screen_hint=signup and prints the same URL', async () => {
    const { ctx, output } = createContext();
    const ok = await performLogin(ctx, {
      deviceCode: false,
      screenHint: 'signup',
    });

    expect(ok).toBe(true);
    const printed = authorizeUrlIn(output);
    expect(printed.searchParams.get('screen_hint')).toBe('signup');
    expect(mockOpen).toHaveBeenCalledWith(printed.toString());
    expect(mockRequestDeviceCode).not.toHaveBeenCalled();
    expect(mockWriteCredentials).toHaveBeenCalledTimes(1);
  });

  it('a plain login still uses PKCE with no screen hint', async () => {
    const { ctx, output } = createContext();
    const ok = await performLogin(ctx, { deviceCode: false });

    expect(ok).toBe(true);
    const printed = authorizeUrlIn(output);
    expect(printed.searchParams.has('screen_hint')).toBe(false);
    expect(printed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(mockRequestDeviceCode).not.toHaveBeenCalled();
  });

  it('a browser launch error falls back to device code and prints the link and the user code', async () => {
    mockOpen.mockRejectedValue(new Error('spawn xdg-open ENOENT'));
    const { ctx, output } = createContext();
    const ok = await performLogin(ctx, { deviceCode: false });

    expect(ok).toBe(true);
    expect(mockRequestDeviceCode).toHaveBeenCalledTimes(1);
    const text = output.join('');
    expect(authorizeUrlIn(output)).toBeTruthy();
    expect(text).toContain('ABCD-EFGH');
    expect(ctx.process.exitCode).not.toBe(1);
  });

  it('callback timeout falls back to device code', async () => {
    callback.code = () =>
      Promise.reject(
        new Error('Authentication timed out. No callback received.'),
      );
    const { ctx, output } = createContext();
    const ok = await performLogin(ctx, { deviceCode: false });

    expect(ok).toBe(true);
    expect(mockRequestDeviceCode).toHaveBeenCalledTimes(1);
    expect(ctx.process.exitCode).not.toBe(1);
    expect(output.join('')).toContain('ABCD-EFGH');
  });

  it('another callback error still fails with exit 1', async () => {
    callback.code = () =>
      Promise.reject(new Error('OAuth error: access_denied'));
    const { ctx, errors } = createContext();
    const ok = await performLogin(ctx, { deviceCode: false });

    expect(ok).toBe(false);
    expect(ctx.process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('access_denied');
    expect(mockRequestDeviceCode).not.toHaveBeenCalled();
  });

  it('pressing d switches to device code', async () => {
    callback.code = () => new Promise(() => {});
    const stdin = fakeStdin();
    const { ctx, output } = createContext(stdin);
    const run = performLogin(ctx, { deviceCode: false });

    await vi.waitFor(() => expect(stdin.listenerCount('data')).toBe(1));
    expect(output.join('')).toContain('Press d to use a device code instead');
    stdin.emit('data', Buffer.from('d'));

    expect(await run).toBe(true);
    expect(mockRequestDeviceCode).toHaveBeenCalledTimes(1);
    expect(ctx.process.exitCode).not.toBe(1);
    // The terminal is restored before the device flow.
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
    expect(stdin.listenerCount('data')).toBe(0);
    expect(callback.close).toHaveBeenCalled();
  });

  it('an arrow key (ESC [ D) does not switch to device code; a lone d still does', async () => {
    callback.code = () => new Promise(() => {});
    const stdin = fakeStdin();
    const { ctx } = createContext(stdin);
    const run = performLogin(ctx, { deviceCode: false });

    await vi.waitFor(() => expect(stdin.listenerCount('data')).toBe(1));
    // Left arrow: ESC [ D, built from bytes (no raw control bytes in source).
    stdin.emit('data', Buffer.from([0x1b, 0x5b, 0x44]));
    stdin.emit('data', Buffer.from('dd'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockRequestDeviceCode).not.toHaveBeenCalled();
    expect(stdin.listenerCount('data')).toBe(1);

    stdin.emit('data', Buffer.from('d'));
    expect(await run).toBe(true);
    expect(mockRequestDeviceCode).toHaveBeenCalledTimes(1);
  });

  it('ctrl-c during the wait exits 130', async () => {
    callback.code = () => new Promise(() => {});
    const stdin = fakeStdin();
    const { ctx } = createContext(stdin);
    const run = performLogin(ctx, { deviceCode: false });

    await vi.waitFor(() => expect(stdin.listenerCount('data')).toBe(1));
    expect(stdin.setRawMode).toHaveBeenCalledWith(true);
    stdin.emit('data', Buffer.from([0x03]));

    expect(await run).toBe(false);
    expect(ctx.process.exitCode).toBe(130);
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
    expect(stdin.listenerCount('data')).toBe(0);
    expect(mockRequestDeviceCode).not.toHaveBeenCalled();
    expect(mockWriteCredentials).not.toHaveBeenCalled();
  });

  it('on a terminal, a callback timeout says how long it waited and r opens the browser again', async () => {
    let calls = 0;
    callback.code = () =>
      ++calls === 1
        ? Promise.reject(
            new Error('Authentication timed out. No callback received.'),
          )
        : Promise.resolve({ code: 'auth-code' });
    const stdin = fakeStdin();
    const { ctx, output } = createContext(stdin);
    const run = performLogin(ctx, { deviceCode: false, screenHint: 'signup' });

    await vi.waitFor(() =>
      expect(output.join('')).toContain(
        'No response from the browser after 2 minutes.',
      ),
    );
    expect(output.join('')).toContain(
      'Press r to open the browser again, d to use a device code',
    );
    // Nothing is chosen for the user.
    expect(mockRequestDeviceCode).not.toHaveBeenCalled();
    stdin.emit('data', Buffer.from('r'));

    expect(await run).toBe(true);
    expect(calls).toBe(2);
    expect(mockOpen).toHaveBeenCalledTimes(2);
    expect(mockRequestDeviceCode).not.toHaveBeenCalled();
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
    expect(stdin.listenerCount('data')).toBe(0);
  });

  it('on a terminal, after a callback timeout d uses the device code', async () => {
    callback.code = () =>
      Promise.reject(
        new Error('Authentication timed out. No callback received.'),
      );
    const stdin = fakeStdin();
    const { ctx, output } = createContext(stdin);
    const run = performLogin(ctx, { deviceCode: false });

    await vi.waitFor(() =>
      expect(output.join('')).toContain('Press r to open the browser again'),
    );
    stdin.emit('data', Buffer.from('d'));

    expect(await run).toBe(true);
    expect(mockRequestDeviceCode).toHaveBeenCalledTimes(1);
    expect(output.join('')).toContain('ABCD-EFGH');
  });

  it('r during the first wait does nothing; only the timeout prompt offers it', async () => {
    callback.code = () => new Promise(() => {});
    const stdin = fakeStdin();
    const { ctx } = createContext(stdin);
    const run = performLogin(ctx, { deviceCode: false });

    await vi.waitFor(() => expect(stdin.listenerCount('data')).toBe(1));
    stdin.emit('data', Buffer.from('r'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(stdin.listenerCount('data')).toBe(1);

    stdin.emit('data', Buffer.from([0x03]));
    expect(await run).toBe(false);
  });

  it('a headless host (stdout not a terminal) goes straight to device code without opening a browser', async () => {
    const { ctx, output } = createContext();
    (ctx.process.stdout as { isTTY: boolean }).isTTY = false;
    const ok = await performLogin(ctx, { deviceCode: false });

    expect(ok).toBe(true);
    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockRequestDeviceCode).toHaveBeenCalledTimes(1);
    expect(callback.close).toHaveBeenCalled();
    // Both the link and the user code are printed.
    expect(authorizeUrlIn(output)).toBeTruthy();
    expect(output.join('')).toContain('ABCD-EFGH');
  });

  /**
   * internal: `--admin` adds `workspace:admin` on every path; without it
   * the requested scope is unchanged.
   */
  it('a plain login requests read:own write:own on both the browser and the device code', async () => {
    mockOpen.mockRejectedValue(new Error('spawn xdg-open ENOENT'));
    const { ctx, output } = createContext();
    await performLogin(ctx, { deviceCode: false });

    expect(authorizeUrlIn(output).searchParams.get('scope')).toBe(
      'read:own write:own',
    );
    expect(mockRequestDeviceCode).toHaveBeenCalledWith('read:own write:own');
  });

  it('--admin requests workspace:admin in the browser authorize URL', async () => {
    const { ctx, output } = createContext();
    const ok = await performLogin(ctx, { deviceCode: false, admin: true });

    expect(ok).toBe(true);
    expect(authorizeUrlIn(output).searchParams.get('scope')).toBe(
      'read:own write:own workspace:admin',
    );
  });

  it('the levr auth login --admin flag reaches the device flow', async () => {
    const { ctx } = createContext();
    await loginHandler.call(ctx, {
      'device-code': true,
      signup: false,
      admin: true,
    });

    expect(mockRequestDeviceCode).toHaveBeenCalledWith(
      'read:own write:own workspace:admin',
    );
  });

  it('--admin --device-code requests workspace:admin from the device flow', async () => {
    const { ctx } = createContext();
    const ok = await performLogin(ctx, { deviceCode: true, admin: true });

    expect(ok).toBe(true);
    expect(mockRequestDeviceCode).toHaveBeenCalledWith(
      'read:own write:own workspace:admin',
    );
  });

  it('--admin keeps workspace:admin when the browser falls back to a device code', async () => {
    mockOpen.mockRejectedValue(new Error('spawn xdg-open ENOENT'));
    const { ctx } = createContext();
    await performLogin(ctx, { deviceCode: false, admin: true });

    expect(mockRequestDeviceCode).toHaveBeenCalledWith(
      'read:own write:own workspace:admin',
    );
  });

  it('--admin keeps workspace:admin when r reopens the browser after a timeout', async () => {
    const stdin = fakeStdin();
    let calls = 0;
    callback.code = () =>
      ++calls === 1
        ? Promise.reject(new Error('Authentication timed out'))
        : Promise.resolve({ code: 'auth-code' });
    const { ctx, output } = createContext(stdin);
    const login = performLogin(ctx, { deviceCode: false, admin: true });
    await vi.waitFor(() =>
      expect(output.join('')).toContain('Press r to open the browser again'),
    );
    stdin.emit('data', Buffer.from('r'));
    expect(await login).toBe(true);

    const text = output.join('');
    const urls = text.match(
      /http:\/\/localhost:3021\/auth\/oauth\/authorize\?\S+/g,
    );
    expect(urls).toHaveLength(2);
    for (const u of urls!) {
      expect(new URL(u).searchParams.get('scope')).toBe(
        'read:own write:own workspace:admin',
      );
    }
  });
});
