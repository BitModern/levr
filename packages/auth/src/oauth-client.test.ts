import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DeviceAuthorizationResponse, StoredTokens } from './types.js';

// Mock token-store so OAuthClient constructor doesn't hit disk
vi.mock('./token-store.js', () => ({
  loadTokens: () => null,
  saveTokens: vi.fn(),
  clearTokens: vi.fn(),
  restoreTokensFromBackup: () => false,
  getTqDir: () => '/tmp/.tq',
}));

// Mock workspace-store so setTokens() can exercise saveWorkspace() without disk
vi.mock('./workspace-store.js', () => ({
  saveWorkspace: vi.fn(),
  loadWorkspace: () => null,
  clearWorkspace: vi.fn(),
  getWorkspaceFilePath: () => '/tmp/.tq/workspace.json',
}));

// Mock config so loadConfig() returns a deterministic value
vi.mock('./config.js', () => ({
  loadConfig: () => ({
    environment: 'staging',
    apiUrl: 'https://api.test.com',
    authUrl: 'https://api.test.com',
    clientUrl: 'https://app.test.com',
    oauthClientId: '2',
  }),
}));

import { OAuthClient } from './oauth-client.js';
import { saveTokens } from './token-store.js';
import { saveWorkspace } from './workspace-store.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const deviceResponse: DeviceAuthorizationResponse = {
  device_code: 'dev-code-123',
  user_code: 'ABCD-1234',
  verification_uri: 'https://api.test.com/v1/oauth/device',
  verification_uri_complete:
    'https://api.test.com/v1/oauth/device?user_code=ABCD-1234',
  expires_in: 300,
  interval: 1,
};

const tokenResponse = {
  access_token: 'access-123',
  token_type: 'bearer',
  expires_in: 86400,
  refresh_token: 'refresh-456',
  scope: 'read:own write:own',
};

describe('OAuthClient.authorizeDevice', () => {
  let client: OAuthClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new OAuthClient({
      clientId: '2',
      authServerUrl: 'https://api.test.com',
    });
  });

  afterEach(() => {
    mockFetch.mockReset();
    vi.useRealTimers();
  });

  /**
   * Helper: start authorizeDevice(), advance fake timers until it resolves.
   * Each tick advances past the polling interval so setTimeout unblocks.
   */
  async function drainPolling(promise: Promise<void>): Promise<void> {
    // Advance in small increments, yielding to microtasks between each,
    // so fetch mocks resolve and the while-loop progresses.
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(6_000);
    }
    return promise;
  }

  it('should request device code and return tokens on immediate approval', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(deviceResponse),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(tokenResponse),
      });

    const p = client.authorizeDevice();
    await drainPolling(p);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [deviceUrl, deviceOpts] = mockFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(deviceUrl).toBe('https://api.test.com/v1/oauth/device/authorize');
    expect(deviceOpts.body).toBeDefined();
    expect((deviceOpts.body as URLSearchParams).toString()).toContain(
      'client_id=2',
    );

    const [tokenUrl, tokenOpts] = mockFetch.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(tokenUrl).toBe('https://api.test.com/v1/oauth/token');
    expect(tokenOpts.body).toBeDefined();
    expect((tokenOpts.body as URLSearchParams).toString()).toContain(
      'device_code=dev-code-123',
    );

    expect(saveTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
      }),
    );
  });

  it('should poll on authorization_pending then succeed', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(deviceResponse),
      })
      .mockResolvedValueOnce({
        ok: false,
        text: () =>
          Promise.resolve(JSON.stringify({ error: 'authorization_pending' })),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(tokenResponse),
      });

    const p = client.authorizeDevice();
    await drainPolling(p);

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(saveTokens).toHaveBeenCalled();
  });

  it('should increase interval on slow_down then succeed', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(deviceResponse),
      })
      .mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve(JSON.stringify({ error: 'slow_down' })),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(tokenResponse),
      });

    const p = client.authorizeDevice();
    await drainPolling(p);

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('should throw on access_denied', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(deviceResponse),
      })
      .mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve(JSON.stringify({ error: 'access_denied' })),
      });

    const p = client.authorizeDevice();
    // Attach rejection handler before advancing timers to avoid unhandled rejection
    const assertion = expect(p).rejects.toThrow(
      'Authorization denied by user.',
    );
    await drainPolling(p).catch(() => {});
    await assertion;
  });

  it('should throw on expired_token', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(deviceResponse),
      })
      .mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve(JSON.stringify({ error: 'expired_token' })),
      });

    const p = client.authorizeDevice();
    const assertion = expect(p).rejects.toThrow('Device code expired');
    await drainPolling(p).catch(() => {});
    await assertion;
  });

  it('should handle non-JSON error response', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(deviceResponse),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: () => Promise.resolve('Bad Gateway'),
      });

    const p = client.authorizeDevice();
    const assertion = expect(p).rejects.toThrow('Device flow polling failed');
    await drainPolling(p).catch(() => {});
    await assertion;
  });

  it('should throw when device authorize request fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Bad Request'),
    });

    await expect(client.authorizeDevice()).rejects.toThrow(
      'Device authorization request failed (400): Bad Request',
    );
  });
});

describe('OAuthClient.setTokens workspace persistence', () => {
  let client: OAuthClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(saveWorkspace).mockClear();
    client = new OAuthClient({
      clientId: '2',
      authServerUrl: 'https://api.test.com',
    });
  });

  afterEach(() => {
    mockFetch.mockReset();
    vi.useRealTimers();
  });

  it('persists workspace when device grant carries user.workspace_id', async () => {
    const wsId = 'ws-device-abc';
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(deviceResponse),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            ...tokenResponse,
            user: { workspace_id: wsId },
            // Backend includes workspaces[] in the grant response but
            // tq-oauth does not cache it locally — left here to simulate
            // the full payload without asserting anything on it.
            workspaces: [
              {
                id: wsId,
                name: 'My Workspace',
                url_key: 'my-ws',
                is_primary: true,
              },
            ],
          }),
      });

    const p = client.authorizeDevice();
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(6_000);
    }
    await p;

    expect(saveWorkspace).toHaveBeenCalledTimes(1);
    // The backend URL is not optional here (internal): workspace.json is keyed
    // by it, so a grant that persists an id without saying which backend it
    // came from is exactly how a local workspace ended up pinned to staging.
    expect(saveWorkspace).toHaveBeenCalledWith(wsId, 'https://api.test.com');
  });

  it('does NOT persist workspace when grant omits user.workspace_id (refresh-like)', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(deviceResponse),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(tokenResponse),
      });

    const p = client.authorizeDevice();
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(6_000);
    }
    await p;

    expect(saveWorkspace).not.toHaveBeenCalled();
  });
});

describe('OAuthClient.refresh workspace behavior', () => {
  let client: OAuthClient;

  beforeEach(() => {
    vi.mocked(saveWorkspace).mockClear();
    client = new OAuthClient({
      clientId: '2',
      authServerUrl: 'https://api.test.com',
    });
    // Seed a refresh token so refresh() proceeds to the fetch call
    client.setTokensFromStorage({
      accessToken: 'expired-access',
      refreshToken: 'refresh-seed',
      expiresAt: Date.now() - 1000,
      apiBaseUrl: 'https://api.test.com',
    });
  });

  afterEach(() => {
    mockFetch.mockReset();
  });

  it('refresh response without user field does NOT save workspace', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'new-access',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'new-refresh',
          scope: 'read:own',
        }),
    });

    await client.refresh();

    expect(saveWorkspace).not.toHaveBeenCalled();
  });
});

/**
 * internal D15.12 (R3 C8 + C13): an isolated `tokenStore` never reads,
 * locks, refreshes from, restores or writes the shared `~/.tq` store, and
 * the default (no `tokenStore`) path is unchanged.
 *
 * These cases run the REAL token, workspace and lock modules under a
 * temporary HOME (`mkdtempSync`) seeded with a shared token, so "never
 * touches" is checked on disk (byte-identical afterwards) and on the wire
 * (the seeded token is never sent), not only on mocks.
 */
describe('OAuthClient isolated tokenStore (temporary HOME)', () => {
  const BACKEND = 'https://api.test.com';
  const SHARED_ACCESS = 'shared-seeded-access-token';
  const SHARED_REFRESH = 'shared-seeded-refresh-token';
  const saved = {
    HOME: process.env.HOME,
    TQ_BACKEND_URL: process.env.TQ_BACKEND_URL,
  };
  let home: string;
  let RealOAuthClient: typeof OAuthClient;

  type Snapshot = Map<string, string>;
  function snapshotTq(): Snapshot {
    const out: Snapshot = new Map();
    const walk = (dir: string): void => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else out.set(full, fs.readFileSync(full).toString('base64'));
      }
    };
    walk(path.join(home, '.tq'));
    return out;
  }

  function memoryStore(initial: StoredTokens | null): {
    load: ReturnType<typeof vi.fn<() => StoredTokens | null>>;
    save: ReturnType<typeof vi.fn<(tokens: StoredTokens) => void>>;
    clear: ReturnType<typeof vi.fn<() => void>>;
  } {
    let current = initial;
    return {
      load: vi.fn(() => current),
      save: vi.fn((tokens: StoredTokens) => {
        current = tokens;
      }),
      clear: vi.fn(() => {
        current = null;
      }),
    };
  }

  /** Every request body and Authorization header sent, as one string. */
  function everythingSent(): string {
    return mockFetch.mock.calls
      .map((call: unknown[]) => {
        const init = (call[1] ?? {}) as RequestInit;
        const body =
          typeof init.body === 'string'
            ? init.body
            : init.body instanceof URLSearchParams
              ? init.body.toString()
              : '';
        return `${String(call[0])} ${JSON.stringify(init.headers ?? {})} ${body}`;
      })
      .join('\n');
  }

  beforeEach(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-isolated-home-'));
    process.env.HOME = home;
    process.env.TQ_BACKEND_URL = BACKEND;
    vi.resetModules();
    vi.doUnmock('./token-store.js');
    vi.doUnmock('./workspace-store.js');
    // Real modules, resolved against the temporary HOME.
    const tokenStore = await import('./token-store.js');
    const workspaceStore = await import('./workspace-store.js');
    expect(tokenStore.getTqDir()).toBe(path.join(home, '.tq'));
    tokenStore.saveTokens({
      accessToken: SHARED_ACCESS,
      refreshToken: SHARED_REFRESH,
      expiresAt: Date.now() + 3_600_000,
      apiBaseUrl: BACKEND,
    });
    workspaceStore.saveWorkspace('ws-shared', BACKEND);
    ({ OAuthClient: RealOAuthClient } = await import('./oauth-client.js'));
  });

  afterEach(() => {
    mockFetch.mockReset();
    // The top-level imports keep their mocked stores; only the modules
    // imported above for the temporary HOME are dropped.
    vi.resetModules();
    if (saved.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = saved.HOME;
    if (saved.TQ_BACKEND_URL === undefined) delete process.env.TQ_BACKEND_URL;
    else process.env.TQ_BACKEND_URL = saved.TQ_BACKEND_URL;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('default path (no tokenStore) still loads the shared token: the seed is real', () => {
    const client = new RealOAuthClient({
      clientId: '2',
      authServerUrl: BACKEND,
    });
    expect(client.getAccessTokenSync()).toBe(SHARED_ACCESS);
  });

  it('never reads the shared token: an empty isolated store means authorization required', async () => {
    const before = snapshotTq();
    const store = memoryStore(null);
    const client = new RealOAuthClient({
      clientId: '2',
      authServerUrl: BACKEND,
      scopes: ['media:publish'],
      tokenStore: store,
    });
    expect(store.load).toHaveBeenCalledTimes(1);
    expect(client.getAccessTokenSync()).toBeNull();
    await expect(client.getAccessToken()).rejects.toThrow(
      /authorization required/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(snapshotTq()).toEqual(before);
  });

  it('an expired isolated token with no refresh token fails without restoring the shared backup or locking', async () => {
    // A backup with a refresh token and no live token file: the shared
    // store's restoreTokensFromBackup() would recreate oauth-tokens.json.
    const tqDir = path.join(home, '.tq');
    const tokenFile = path.join(tqDir, 'oauth-tokens.json');
    fs.copyFileSync(tokenFile, `${tokenFile}.bak`);
    fs.unlinkSync(tokenFile);
    const before = snapshotTq();
    const store = memoryStore({
      accessToken: 'isolated-expired',
      refreshToken: '',
      expiresAt: Date.now() - 1_000,
      apiBaseUrl: BACKEND,
    });
    const client = new RealOAuthClient({
      clientId: '2',
      authServerUrl: BACKEND,
      tokenStore: store,
    });
    await expect(client.getAccessToken()).rejects.toThrow(
      /authorization required/,
    );
    expect(fs.existsSync(tokenFile)).toBe(false);
    expect(fs.existsSync(path.join(tqDir, 'locks'))).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(snapshotTq()).toEqual(before);
  });

  it('refreshes from the isolated store only, saves only to it, and never sends the shared token', async () => {
    const before = snapshotTq();
    const store = memoryStore({
      accessToken: 'isolated-expired',
      refreshToken: 'isolated-refresh',
      expiresAt: Date.now() - 1_000,
      apiBaseUrl: BACKEND,
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'isolated-new-access',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'isolated-new-refresh',
          scope: 'media:publish',
          user: { workspace_id: 'ws-never-pinned' },
        }),
    });
    const client = new RealOAuthClient({
      clientId: '2',
      authServerUrl: BACKEND,
      tokenStore: store,
    });

    expect(await client.getAccessToken()).toBe('isolated-new-access');

    expect(store.save).toHaveBeenCalledTimes(1);
    expect(store.save.mock.calls[0][0]).toMatchObject({
      accessToken: 'isolated-new-access',
      apiBaseUrl: BACKEND,
    });
    const sent = everythingSent();
    expect(sent).toContain('isolated-refresh');
    expect(sent).not.toContain(SHARED_ACCESS);
    expect(sent).not.toContain(SHARED_REFRESH);
    expect(fs.existsSync(path.join(home, '.tq', 'locks'))).toBe(false);
    expect(snapshotTq()).toEqual(before);
  });

  it('refuses an isolated store without an explicit server URL (never reads ~/.tq/config.json)', () => {
    expect(
      () =>
        new RealOAuthClient({ clientId: '2', tokenStore: memoryStore(null) }),
    ).toThrow(/explicit authServerUrl/);
  });

  it('logout clears only the isolated store', () => {
    const before = snapshotTq();
    const store = memoryStore({
      accessToken: 'isolated-access',
      refreshToken: '',
      expiresAt: Date.now() + 60_000,
      apiBaseUrl: BACKEND,
    });
    const client = new RealOAuthClient({
      clientId: '2',
      authServerUrl: BACKEND,
      tokenStore: store,
    });
    expect(client.getAccessTokenSync()).toBe('isolated-access');
    client.clearTokens();
    expect(store.clear).toHaveBeenCalledTimes(1);
    expect(client.getAccessTokenSync()).toBeNull();
    expect(snapshotTq()).toEqual(before);
  });

  it('default path writes the shared store and the workspace pin exactly as before', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'default-new-access',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'default-new-refresh',
          scope: 'read:own',
        }),
    });
    const client = new RealOAuthClient({
      clientId: '2',
      authServerUrl: BACKEND,
    });
    client.setTokensFromStorage({
      accessToken: SHARED_ACCESS,
      refreshToken: SHARED_REFRESH,
      expiresAt: Date.now() - 1_000,
      apiBaseUrl: BACKEND,
    });
    expect(await client.getAccessToken()).toBe('default-new-access');
    const tokenStore = await import('./token-store.js');
    expect(tokenStore.loadTokensForUrl(BACKEND)?.accessToken).toBe(
      'default-new-access',
    );
  });
});

describe('OAuthClient default path keeps saveTokens and saveWorkspace (mocked stores)', () => {
  afterEach(() => {
    mockFetch.mockReset();
    vi.useRealTimers();
  });

  it('a grant with a workspace calls saveTokens and saveWorkspace exactly as before', async () => {
    vi.useFakeTimers();
    vi.mocked(saveTokens).mockClear();
    vi.mocked(saveWorkspace).mockClear();
    const client = new OAuthClient({
      clientId: '2',
      authServerUrl: 'https://api.test.com',
    });
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(deviceResponse),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ ...tokenResponse, user: { workspace_id: 'ws-1' } }),
      });
    const p = client.authorizeDevice();
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(6_000);
    }
    await p;
    expect(saveTokens).toHaveBeenCalledTimes(1);
    expect(saveTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        apiBaseUrl: 'https://api.test.com',
      }),
    );
    expect(saveWorkspace).toHaveBeenCalledWith('ws-1', 'https://api.test.com');
  });

  it('a tokenStore client never calls the shared saveTokens or saveWorkspace', async () => {
    vi.useFakeTimers();
    vi.mocked(saveTokens).mockClear();
    vi.mocked(saveWorkspace).mockClear();
    const store = { load: vi.fn(() => null), save: vi.fn(), clear: vi.fn() };
    const client = new OAuthClient({
      clientId: '2',
      authServerUrl: 'https://api.test.com',
      tokenStore: store,
    });
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(deviceResponse),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ ...tokenResponse, user: { workspace_id: 'ws-1' } }),
      });
    const p = client.authorizeDevice();
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(6_000);
    }
    await p;
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(saveTokens).not.toHaveBeenCalled();
    expect(saveWorkspace).not.toHaveBeenCalled();
  });
});
