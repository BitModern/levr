import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';

import { listWorkspaces, WorkspaceFetchError } from './workspaces.js';
import type { WorkspaceSite } from './workspaces.js';
import type { StoredTokens } from './types.js';

// --- Module mocks -----------------------------------------------------------
const mockLoadTokens = vi.fn<() => StoredTokens | null>();
const mockGetAccessToken = vi.fn<() => Promise<string>>();
const mockSetTokensFromStorage = vi.fn<(tokens: StoredTokens) => void>();

vi.mock('./token-store.js', () => ({
  loadTokens: () => mockLoadTokens(),
}));

vi.mock('./config.js', () => ({
  loadConfig: () => ({
    environment: 'staging',
    apiUrl: 'https://api.example.test',
    authUrl: 'https://auth.example.test',
    clientUrl: 'https://app.example.test',
    oauthClientId: 'test-client',
  }),
}));

vi.mock('./oauth-client.js', () => ({
  OAuthClient: class {
    setTokensFromStorage = mockSetTokensFromStorage;
    getAccessToken = () => mockGetAccessToken();
  },
}));

const FAKE_TOKENS = {
  accessToken: 'a',
  refreshToken: 'r',
  expiresAt: Date.now() + 60_000,
};

const SITE: WorkspaceSite = {
  workspace_id: '019f0000-0000-7000-8000-000000000001',
  workspace_name: 'Acme',
  workspace_url_key: 'acme',
  user_id: '019f0000-0000-7000-8000-0000000000aa',
  role: 'owner',
  is_primary: true,
  last_accessed_at: null,
};

describe('listWorkspaces', () => {
  let exitSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('access-token');
    // Guard: the library must NEVER terminate the caller's process (R2F1).
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('throws (does not process.exit) when not authenticated — R2F1', async () => {
    mockLoadTokens.mockReturnValue(null);

    await expect(listWorkspaces()).rejects.toBeInstanceOf(WorkspaceFetchError);
    await expect(listWorkspaces()).rejects.toMatchObject({
      code: 'not_authenticated',
    });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('throws token_refresh_failed (not exit) when the token cannot be obtained', async () => {
    mockLoadTokens.mockReturnValue(FAKE_TOKENS);
    mockGetAccessToken.mockRejectedValue(new Error('refresh failed'));

    await expect(listWorkspaces()).rejects.toMatchObject({
      code: 'token_refresh_failed',
    });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('throws http_error carrying status/body on a non-2xx response', async () => {
    mockLoadTokens.mockReturnValue(FAKE_TOKENS);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('forbidden'),
      }),
    );

    const err = await listWorkspaces().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkspaceFetchError);
    expect(err).toMatchObject({
      code: 'http_error',
      status: 403,
      body: 'forbidden',
    });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('unwraps the { sites } envelope and returns the corrected WorkspaceSite shape', async () => {
    mockLoadTokens.mockReturnValue(FAKE_TOKENS);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            sites: [SITE],
            current_workspace_id: SITE.workspace_id,
          }),
      }),
    );

    const sites = await listWorkspaces();
    expect(sites).toHaveLength(1);
    expect(sites[0]).toEqual(SITE);
    // H1: role/user_id/last_accessed_at are part of the typed surface.
    expect(sites[0].role).toBe('owner');
    expect(sites[0].user_id).toBeDefined();
  });

  it('tolerates a bare-array response for forward compat', async () => {
    mockLoadTokens.mockReturnValue(FAKE_TOKENS);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([SITE]),
      }),
    );

    const sites = await listWorkspaces();
    expect(sites).toEqual([SITE]);
  });
});
