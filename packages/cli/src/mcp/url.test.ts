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

describe('resolveMcpUrl validation (internal)', () => {
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

  it('rejects a value with no scheme, which claude mcp add would read as a flag', () => {
    // The argument-injection shape: since internal this value becomes argv for
    // `claude mcp add`, where a leading `-` is a flag, not the URL operand.
    expect(() => resolveMcpUrl('--transport')).toThrow(/is not a URL/);
    expect(() => resolveMcpUrl('ai.levr.one/api/v1/mcp')).toThrow(
      /is not a URL/,
    );
  });

  it('rejects a non-http(s) scheme', () => {
    expect(() => resolveMcpUrl('file:///etc/passwd')).toThrow(
      /only http and https/i,
    );
    expect(() => resolveMcpUrl('javascript:alert(1)')).toThrow(
      /only http and https/i,
    );
    expect(() => resolveMcpUrl('ftp://example.com/mcp')).toThrow(
      /only http and https/i,
    );
  });

  it('rejects embedded credentials, which project scope would commit to git', () => {
    expect(() =>
      resolveMcpUrl('https://user:secret@example.com/v1/mcp'),
    ).toThrow(/embeds credentials/);
  });

  it('names the input the user has to change', () => {
    expect(() => resolveMcpUrl('nonsense')).toThrow(/from --url/);

    process.env['LEVR_MCP_URL'] = 'nonsense';
    expect(() => resolveMcpUrl()).toThrow(/from LEVR_MCP_URL/);
  });

  it('validates the DERIVED url too, not just user-supplied ones', () => {
    // getApiUrl() honours LEVR_URL and the URL stored at login; neither is
    // guaranteed to be a URL, and the derived value lands in configs all the same.
    process.env['LEVR_URL'] = 'not-a-url';
    expect(() => resolveMcpUrl()).toThrow(/Invalid MCP URL/);
  });

  it('still accepts every shape the installer actually uses', () => {
    expect(resolveMcpUrl('https://ai.levr.one/api/v1/mcp').url).toBe(
      'https://ai.levr.one/api/v1/mcp',
    );
    // localhost dev stack, http and a port
    expect(resolveMcpUrl('http://localhost:8080/v1/mcp').url).toBe(
      'http://localhost:8080/v1/mcp',
    );
    // single-label host, as the pre-existing tests use
    expect(resolveMcpUrl('https://custom/v1/mcp').url).toBe(
      'https://custom/v1/mcp',
    );
    // trailing slash is still stripped before validation
    expect(resolveMcpUrl('https://flag/v1/mcp/').url).toBe(
      'https://flag/v1/mcp',
    );
  });
});
