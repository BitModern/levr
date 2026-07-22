import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

describe('resolveToken', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env['LEVR_TOKEN'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should throw when no auth is available', async () => {
    vi.doMock('./credentials.js', () => ({
      readCredentials: () => null,
    }));

    const { resolveToken } = await import('./resolve-token.js');

    await expect(resolveToken()).rejects.toThrow('Not authenticated');
  });

  it('should use LEVR_TOKEN env var when set', async () => {
    process.env['LEVR_TOKEN'] = 'tq_test123';

    vi.doMock('./credentials.js', () => ({
      readCredentials: () => null,
    }));

    const { resolveToken } = await import('./resolve-token.js');

    const result = await resolveToken();
    expect(result.type).toBe('pat');
    expect(result.token).toBe('tq_test123');
  });

  it('should prioritize LEVR_TOKEN over stored credentials', async () => {
    process.env['LEVR_TOKEN'] = 'tq_priority';

    vi.doMock('./credentials.js', () => ({
      readCredentials: () => ({
        version: 1,
        access_token: 'jwt-token',
        refresh_token: 'refresh',
        expires_at: Date.now() + 86400000,
      }),
    }));

    const { resolveToken } = await import('./resolve-token.js');

    const result = await resolveToken();
    expect(result.type).toBe('pat');
    expect(result.token).toBe('tq_priority');
  });

  it('rejects stored credentials when the command targets a different server', async () => {
    process.env['LEVR_URL'] = 'https://api.levr.now';

    vi.doMock('./credentials.js', () => ({
      readCredentials: () => ({
        version: 1,
        api_url: 'https://api.levr.one',
        access_token: 'jwt-token',
        refresh_token: 'refresh',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      }),
    }));

    const { resolveToken } = await import('./resolve-token.js');

    await expect(resolveToken()).rejects.toThrow(
      /Stored credentials are for https:\/\/api\.levr\.one.*api\.levr\.now/s,
    );
  });

  it('returns stored credentials when they match the active target', async () => {
    process.env['LEVR_URL'] = 'https://api.levr.now';

    vi.doMock('./credentials.js', () => ({
      readCredentials: () => ({
        version: 1,
        api_url: 'https://api.levr.now',
        access_token: 'jwt-token',
        refresh_token: 'refresh',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      }),
    }));

    const { resolveToken } = await import('./resolve-token.js');

    const result = await resolveToken();
    expect(result.type).toBe('jwt');
    expect(result.token).toBe('jwt-token');
  });

  it('accepts stored credentials when no explicit target is set (stored URL is the target)', async () => {
    delete process.env['LEVR_URL'];

    vi.doMock('./credentials.js', () => ({
      readCredentials: () => ({
        version: 1,
        api_url: 'https://api.levr.now',
        access_token: 'jwt-token',
        refresh_token: 'refresh',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      }),
    }));

    const { resolveToken } = await import('./resolve-token.js');

    const result = await resolveToken();
    expect(result.type).toBe('jwt');
    expect(result.token).toBe('jwt-token');
  });
});
