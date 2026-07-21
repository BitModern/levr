import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock sleep to avoid real delays
vi.mock('../utils/sleep.js', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

// Mock env
vi.mock('../utils/env.js', () => ({
  getApiUrl: () => 'https://api.test.com',
  CLI_CLIENT_ID: '3',
}));

import { pollForDeviceToken } from './device-flow.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('pollForDeviceToken', () => {
  afterEach(() => {
    mockFetch.mockReset();
  });

  it('should return tokens on immediate success', async () => {
    const tokenResponse = {
      access_token: 'access-123',
      token_type: 'bearer',
      expires_in: 86400,
      refresh_token: 'refresh-456',
      scope: 'read:own write:own',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(tokenResponse),
    });

    const result = await pollForDeviceToken({
      deviceCode: 'device-123',
      interval: 5,
      expiresIn: 300,
    });

    expect(result).toEqual(tokenResponse);
  });

  it('should throw on access_denied', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'access_denied' }),
    });

    await expect(
      pollForDeviceToken({
        deviceCode: 'device-123',
        interval: 5,
        expiresIn: 300,
      }),
    ).rejects.toThrow('Authorization denied by user.');
  });

  it('should throw on expired_token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'expired_token' }),
    });

    await expect(
      pollForDeviceToken({
        deviceCode: 'device-123',
        interval: 5,
        expiresIn: 300,
      }),
    ).rejects.toThrow('Device code expired');
  });

  it('should continue polling on authorization_pending', async () => {
    const tokenResponse = {
      access_token: 'access-123',
      token_type: 'bearer',
      expires_in: 86400,
      refresh_token: 'refresh-456',
      scope: 'read:own write:own',
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'authorization_pending' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(tokenResponse),
      });

    const onPending = vi.fn();
    const result = await pollForDeviceToken({
      deviceCode: 'device-123',
      interval: 5,
      expiresIn: 300,
      onPending,
    });

    expect(result).toEqual(tokenResponse);
    expect(onPending).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should handle slow_down by continuing to poll', async () => {
    const tokenResponse = {
      access_token: 'access-123',
      token_type: 'bearer',
      expires_in: 86400,
      refresh_token: 'refresh-456',
      scope: 'read:own write:own',
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'slow_down' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(tokenResponse),
      });

    const result = await pollForDeviceToken({
      deviceCode: 'device-123',
      interval: 5,
      expiresIn: 300,
    });

    expect(result).toEqual(tokenResponse);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
