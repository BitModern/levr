import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DeviceAuthorizationResponse } from './types.js';

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
    expect(saveWorkspace).toHaveBeenCalledWith(wsId);
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
