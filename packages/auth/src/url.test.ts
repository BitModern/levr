import { describe, it, expect } from 'vitest';

import { joinApiPath } from './url.js';

describe('joinApiPath', () => {
  describe('path-prefixed base (DEV_TLS local dev)', () => {
    // The regression this helper exists for: `tq:env local` resolves apiUrl
    // from apps/backender/.env's API_BASE_URL, which points at the SPA origin
    // plus the Vite `/api` proxy. `new URL('/v1/...', base)` dropped `/api`,
    // sending OAuth at the SPA — which answers 200 with its HTML fallback and
    // rewrites the path under the active workspace.
    const base = 'https://ai.levr.test:3020/api';

    it('preserves the base path prefix', () => {
      expect(joinApiPath(base, '/v1/oauth/authorize').toString()).toBe(
        'https://ai.levr.test:3020/api/v1/oauth/authorize',
      );
    });

    it('preserves it for every endpoint the auth client calls', () => {
      const paths = [
        '/v1/oauth/authorize',
        '/v1/oauth/device/authorize',
        '/v1/oauth/token',
        '/v1/auth/sites',
      ];
      for (const p of paths) {
        expect(joinApiPath(base, p).toString()).toBe(
          `https://ai.levr.test:3020/api${p}`,
        );
      }
    });

    it('does not regress to the bare-origin form', () => {
      // Guards the exact defect: the old join produced this.
      expect(joinApiPath(base, '/v1/oauth/token').toString()).not.toBe(
        'https://ai.levr.test:3020/v1/oauth/token',
      );
    });

    it('handles a base that already ends in a slash', () => {
      expect(joinApiPath(`${base}/`, '/v1/oauth/token').toString()).toBe(
        'https://ai.levr.test:3020/api/v1/oauth/token',
      );
    });

    it('preserves a multi-segment base path', () => {
      expect(
        joinApiPath('https://host/a/b', '/v1/oauth/token').toString(),
      ).toBe('https://host/a/b/v1/oauth/token');
    });
  });

  describe('bare-origin base (staging, production, non-TLS local)', () => {
    // Must stay byte-identical to what `new URL(path, base)` produced, or the
    // fix would break every environment that was working.
    it.each([
      ['https://api.levr.now', 'staging'],
      ['https://api.levr.one', 'production'],
      ['http://localhost:8080', 'local http'],
      ['https://api.levr.test:8080', 'local TLS'],
    ])('is a no-op for %s (%s)', (base) => {
      expect(joinApiPath(base, '/v1/oauth/authorize').toString()).toBe(
        new URL('/v1/oauth/authorize', base).toString(),
      );
    });

    it('normalizes a trailing slash on the origin', () => {
      expect(
        joinApiPath('https://api.levr.now/', '/v1/oauth/token').toString(),
      ).toBe('https://api.levr.now/v1/oauth/token');
    });
  });

  describe('input tolerance', () => {
    it('accepts a path with no leading slash', () => {
      expect(joinApiPath('https://host/api', 'v1/oauth/token').toString()).toBe(
        'https://host/api/v1/oauth/token',
      );
    });

    it('collapses redundant leading slashes rather than treating them as a host', () => {
      // '//v1/oauth/token' as a relative reference is protocol-relative and
      // would resolve `v1` as the HOST — silently pointing at another server.
      expect(
        joinApiPath('https://host/api', '//v1/oauth/token').toString(),
      ).toBe('https://host/api/v1/oauth/token');
    });

    it('keeps the port', () => {
      expect(joinApiPath('https://host:3020/api', '/v1/x').toString()).toBe(
        'https://host:3020/api/v1/x',
      );
    });

    it('returns a URL whose searchParams are usable by callers', () => {
      // authorize() builds its query via authUrl.searchParams.set(...).
      const url = joinApiPath('https://host/api', '/v1/oauth/authorize');
      url.searchParams.set('client_id', '2');
      expect(url.toString()).toBe(
        'https://host/api/v1/oauth/authorize?client_id=2',
      );
    });
  });
});
