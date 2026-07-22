import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../auth/credentials.js', () => ({
  readCredentials: vi.fn(),
}));

import {
  getApiUrl,
  getAuthUrl,
  setSessionApiUrl,
  resetSessionApiUrl,
  getTeamId,
  getPatToken,
  getSourceOverride,
} from './env.js';
import { readCredentials } from '../auth/credentials.js';
import type { StoredCredentials } from '../types/auth-types.js';

const mockReadCredentials = vi.mocked(readCredentials);

function storedCreds(apiUrl: string): StoredCredentials {
  return {
    version: 1,
    api_url: apiUrl,
    access_token: 'at',
    refresh_token: 'rt',
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    user: { id: 'u-1', email: 'u@example.com', workspace_id: 'ws-1' },
  };
}

describe('env utilities', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
    mockReadCredentials.mockReturnValue(null);
    resetSessionApiUrl();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetSessionApiUrl();
  });

  describe('getApiUrl', () => {
    it('should return default URL when nothing else is configured', () => {
      delete process.env['LEVR_URL'];
      expect(getApiUrl()).toBe('https://api.levr.one');
    });

    it('should return LEVR_URL when set', () => {
      process.env['LEVR_URL'] = 'http://localhost:8080';
      expect(getApiUrl()).toBe('http://localhost:8080');
    });

    it('falls back to the api_url stored at login when env is unset', () => {
      delete process.env['LEVR_URL'];
      mockReadCredentials.mockReturnValue(storedCreds('https://api.levr.now'));
      expect(getApiUrl()).toBe('https://api.levr.now');
    });

    it('LEVR_URL wins over stored credentials', () => {
      process.env['LEVR_URL'] = 'https://api.levr.one';
      mockReadCredentials.mockReturnValue(storedCreds('https://api.levr.now'));
      expect(getApiUrl()).toBe('https://api.levr.one');
    });

    it('the --url session override wins over LEVR_URL', () => {
      process.env['LEVR_URL'] = 'https://api.levr.one';
      setSessionApiUrl('https://api.levr.now');
      expect(getApiUrl()).toBe('https://api.levr.now');
    });

    it('ignores stored credentials when LEVR_TOKEN (PAT) is set', () => {
      delete process.env['LEVR_URL'];
      process.env['LEVR_TOKEN'] = 'tq_pat123';
      mockReadCredentials.mockReturnValue(storedCreds('https://api.levr.now'));
      expect(getApiUrl()).toBe('https://api.levr.one');
    });

    it('strips trailing slashes', () => {
      process.env['LEVR_URL'] = 'https://api.levr.now/';
      expect(getApiUrl()).toBe('https://api.levr.now');
    });
  });

  describe('getAuthUrl', () => {
    it('derives the production auth host when nothing is configured', () => {
      delete process.env['LEVR_AUTH_URL'];
      delete process.env['LEVR_URL'];
      expect(getAuthUrl()).toBe('https://auth.levr.one');
    });

    it('should return LEVR_AUTH_URL when set', () => {
      process.env['LEVR_AUTH_URL'] = 'http://localhost:3021';
      expect(getAuthUrl()).toBe('http://localhost:3021');
    });

    it('derives the staging auth host from a staging API URL', () => {
      delete process.env['LEVR_AUTH_URL'];
      process.env['LEVR_URL'] = 'https://api.levr.now';
      expect(getAuthUrl()).toBe('https://auth.levr.now');
    });

    it('derives from a --url session override', () => {
      delete process.env['LEVR_AUTH_URL'];
      setSessionApiUrl('https://api.levr.now');
      expect(getAuthUrl()).toBe('https://auth.levr.now');
    });

    it('derives from the api_url stored at login', () => {
      delete process.env['LEVR_AUTH_URL'];
      delete process.env['LEVR_URL'];
      mockReadCredentials.mockReturnValue(storedCreds('https://api.levr.now'));
      expect(getAuthUrl()).toBe('https://auth.levr.now');
    });

    it('throws a clear error for an unrecognized host with no LEVR_AUTH_URL', () => {
      delete process.env['LEVR_AUTH_URL'];
      process.env['LEVR_URL'] = 'http://localhost:8180';
      expect(() => getAuthUrl()).toThrow(/LEVR_AUTH_URL/);
    });
  });

  describe('getTeamId', () => {
    it('should return flag value when provided', () => {
      expect(getTeamId('flag-id')).toBe('flag-id');
    });

    it('should return LEVR_TEAM_ID when flag is undefined', () => {
      process.env['LEVR_TEAM_ID'] = 'env-id';
      expect(getTeamId()).toBe('env-id');
    });

    it('should return undefined when neither flag nor env is set', () => {
      delete process.env['LEVR_TEAM_ID'];
      expect(getTeamId()).toBeUndefined();
    });
  });

  describe('getPatToken', () => {
    it('should return undefined when LEVR_TOKEN is not set', () => {
      delete process.env['LEVR_TOKEN'];
      expect(getPatToken()).toBeUndefined();
    });

    it('should return LEVR_TOKEN when set', () => {
      process.env['LEVR_TOKEN'] = 'tq_abc123';
      expect(getPatToken()).toBe('tq_abc123');
    });
  });

  describe('getSourceOverride', () => {
    it('should return undefined when LEVR_SOURCE is not set', () => {
      delete process.env['LEVR_SOURCE'];
      expect(getSourceOverride()).toBeUndefined();
    });

    it('should return LEVR_SOURCE when set', () => {
      process.env['LEVR_SOURCE'] = 'unit-tests';
      expect(getSourceOverride()).toBe('unit-tests');
    });
  });
});
