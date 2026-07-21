import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getApiUrl,
  getAuthUrl,
  getTeamId,
  getPatToken,
  getSourceOverride,
} from './env.js';

describe('env utilities', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getApiUrl', () => {
    it('should return default URL when LEVR_URL is not set', () => {
      delete process.env['LEVR_URL'];
      expect(getApiUrl()).toBe('https://api.levr.one');
    });

    it('should return LEVR_URL when set', () => {
      process.env['LEVR_URL'] = 'http://localhost:8080';
      expect(getApiUrl()).toBe('http://localhost:8080');
    });
  });

  describe('getAuthUrl', () => {
    it('should return default URL when LEVR_AUTH_URL is not set', () => {
      delete process.env['LEVR_AUTH_URL'];
      expect(getAuthUrl()).toBe('https://auth.levr.one');
    });

    it('should return LEVR_AUTH_URL when set', () => {
      process.env['LEVR_AUTH_URL'] = 'http://localhost:3021';
      expect(getAuthUrl()).toBe('http://localhost:3021');
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
