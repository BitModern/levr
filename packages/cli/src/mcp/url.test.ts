import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../auth/credentials.js', () => ({
  readCredentials: vi.fn(() => null),
}));

import { resolveMcpUrl } from './url.js';
import { resetSessionApiUrl } from '../utils/env.js';

describe('resolveMcpUrl', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env['LEVR_URL'];
    delete process.env['LEVR_MCP_URL'];
    delete process.env['LEVR_TOKEN'];
    resetSessionApiUrl();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetSessionApiUrl();
  });

  it('derives the production MCP resource by default (app host, not api host)', () => {
    expect(resolveMcpUrl()).toEqual({
      url: 'https://ai.levr.one/api/v1/mcp',
      source: 'derived:https://api.levr.one',
    });
  });

  it('derives the staging MCP resource from LEVR_URL', () => {
    process.env['LEVR_URL'] = 'https://api.levr.now';
    expect(resolveMcpUrl().url).toBe('https://ai.levr.now/api/v1/mcp');
  });

  it('falls back to <api-url>/v1/mcp for unrecognized hosts (local dev)', () => {
    process.env['LEVR_URL'] = 'http://localhost:8080';
    expect(resolveMcpUrl().url).toBe('http://localhost:8080/v1/mcp');
  });

  it('LEVR_MCP_URL wins over derivation', () => {
    process.env['LEVR_URL'] = 'https://api.levr.one';
    process.env['LEVR_MCP_URL'] = 'https://custom/v1/mcp';
    expect(resolveMcpUrl()).toEqual({
      url: 'https://custom/v1/mcp',
      source: 'env:LEVR_MCP_URL',
    });
  });

  it('the --url flag wins over everything', () => {
    process.env['LEVR_MCP_URL'] = 'https://custom/v1/mcp';
    expect(resolveMcpUrl('https://flag/v1/mcp/')).toEqual({
      url: 'https://flag/v1/mcp',
      source: 'flag',
    });
  });
});
