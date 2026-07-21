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
});
