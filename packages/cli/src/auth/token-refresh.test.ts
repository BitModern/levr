import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./credentials.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./credentials.js')>()),
  writeCredentials: vi.fn(),
  deleteCredentials: vi.fn(),
  readCredentials: vi.fn(),
}));

import {
  deleteCredentials,
  readCredentials,
  writeCredentials,
} from './credentials.js';
import { refreshToken } from './token-refresh.js';
import type { StoredCredentials } from '../types/auth-types.js';

const creds = {
  access_token: 'old-access',
  refresh_token: 'old-refresh',
  expires_at: new Date(0).toISOString(),
  api_url: 'https://api.example.test',
} as StoredCredentials;

const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

/**
 * internal: only a refusal of the refresh token deletes the stored login. A
 * server fault or a network error keeps it and throws, so the next command
 * retries instead of forcing `levr auth login`.
 */
describe('refreshToken (internal)', () => {
  beforeEach(() => {
    vi.mocked(deleteCredentials).mockClear();
    vi.mocked(writeCredentials).mockClear();
    vi.mocked(readCredentials).mockReset();
    // By default the file still holds the pair that was sent.
    vi.mocked(readCredentials).mockReturnValue(creds);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores and returns the new pair on success', async () => {
    vi.stubGlobal(
      'fetch',
      respond(200, {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      }),
    );
    const out = await refreshToken(creds);
    expect(out).toMatchObject({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
    });
    expect(writeCredentials).toHaveBeenCalledTimes(1);
    expect(deleteCredentials).not.toHaveBeenCalled();
  });

  it.each([
    [400, { error: 'invalid_grant' }],
    [401, { error: 'invalid_grant' }],
  ])(
    'deletes the login and returns null on a %i invalid_grant',
    async (status, body) => {
      vi.stubGlobal('fetch', respond(status, body));
      await expect(refreshToken(creds)).resolves.toBeNull();
      expect(deleteCredentials).toHaveBeenCalledTimes(1);
    },
  );

  it('returns the newer stored pair, not null, when another process rotated it', async () => {
    const rotated = { ...creds, refresh_token: 'rotated-by-another-process' };
    vi.mocked(readCredentials).mockReturnValue(rotated);
    vi.stubGlobal('fetch', respond(400, { error: 'invalid_grant' }));
    await expect(refreshToken(creds)).resolves.toBe(rotated);
    expect(deleteCredentials).not.toHaveBeenCalled();
  });

  it('neither uses nor deletes a newer login written for another server', async () => {
    vi.mocked(readCredentials).mockReturnValue({
      ...creds,
      api_url: 'https://other-server.example.test',
      refresh_token: 'someone-elses',
    });
    vi.stubGlobal('fetch', respond(400, { error: 'invalid_grant' }));
    await expect(refreshToken(creds)).resolves.toBeNull();
    expect(deleteCredentials).not.toHaveBeenCalled();
  });

  it.each([
    [503, { error: 'server_error' }],
    [500, 'not json'],
    [400, { error: 'server_error' }],
    [400, { error: 'QueryFailedError' }],
    [401, { error: 'invalid_client' }],
    [400, { error: 'invalid_request' }],
    [400, 'not json'],
    [403, '<html>blocked</html>'],
    [429, { error: 'too_many_requests' }],
  ])('keeps the login and throws on a %i %j', async (status, body) => {
    vi.stubGlobal('fetch', respond(status, body));
    await expect(refreshToken(creds)).rejects.toThrow(/login is kept/);
    expect(deleteCredentials).not.toHaveBeenCalled();
  });

  it.each([
    ['an HTML page', '<html>portal</html>'],
    ['a body without a refresh token', { access_token: 'a', expires_in: 3600 }],
    ['a body without expires_in', { access_token: 'a', refresh_token: 'r' }],
  ])('keeps the login and throws on a 200 with %s', async (_label, body) => {
    vi.stubGlobal('fetch', respond(200, body));
    await expect(refreshToken(creds)).rejects.toThrow(/unusable response/);
    expect(deleteCredentials).not.toHaveBeenCalled();
    expect(writeCredentials).not.toHaveBeenCalled();
  });

  it('keeps the login and throws on a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    );
    await expect(refreshToken(creds)).rejects.toThrow(/network error/);
    expect(deleteCredentials).not.toHaveBeenCalled();
  });
});
