import { describe, expect, it, vi } from 'vitest';
import {
  OIDC_JWKS_UNAVAILABLE,
  ciCommitSha,
  ciOidcAudience,
  ciRequestHeaders,
  requestActionsOidcToken,
  withOidcJwksRetry,
} from './ci-oidc.js';

describe('internal — Actions OIDC request', () => {
  it('requests a token with the workspace audience and keeps an existing query', async () => {
    const fetchImpl = vi.fn((url: URL) => {
      expect(String(url).startsWith('https://example.test/token?')).toBe(true);
      expect(url.searchParams.get('existing')).toBe('1');
      expect(url.searchParams.get('audience')).toBe('levr:ws-1');
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ value: 'tok' }),
      });
    });
    const token = await requestActionsOidcToken(
      ciOidcAudience('ws-1'),
      {
        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.test/token?existing=1',
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'req',
      },
      fetchImpl as unknown as typeof fetch,
    );
    expect(token).toBe('tok');
    expect(ciRequestHeaders(token)).toEqual({
      'X-Levr-CI-Declared': '1',
      'X-Levr-CI-OIDC': 'tok',
    });
  });

  it('returns null when the runner did not expose the env vars', async () => {
    expect(await requestActionsOidcToken('levr:ws-1', {})).toBeNull();
    expect(ciRequestHeaders(null)).toEqual({ 'X-Levr-CI-Declared': '1' });
  });

  it('gives up on a token endpoint that does not answer (review H7)', async () => {
    const fetchImpl = vi.fn(
      (_url: URL, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const token = await requestActionsOidcToken(
      'levr:ws-1',
      {
        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.test/token',
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'req',
      },
      fetchImpl as unknown as typeof fetch,
      20,
    );
    expect(token).toBeNull();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('reads the run commit from GITHUB_SHA only when it is a full sha', () => {
    expect(ciCommitSha({ GITHUB_SHA: 'a'.repeat(40) })).toBe('a'.repeat(40));
    expect(ciCommitSha({ GITHUB_SHA: 'main' })).toBeUndefined();
    expect(ciCommitSha({})).toBeUndefined();
  });

  it('retries OIDC_JWKS_UNAVAILABLE twice then returns the last 503', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const result = await withOidcJwksRetry(
      () => {
        calls += 1;
        return Promise.resolve({
          response: { status: 503 },
          error: { code: OIDC_JWKS_UNAVAILABLE },
        });
      },
      (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    );
    expect(calls).toBe(3);
    expect(sleeps).toEqual([250, 750]);
    expect(result.response?.status).toBe(503);
  });
});
