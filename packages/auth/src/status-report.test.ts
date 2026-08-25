import { describe, it, expect } from 'vitest';
import { PRESETS } from './config.js';
import {
  backendUrlForLevrMcp,
  buildTokenRows,
  formatExpiry,
  labelForBackend,
  levrEntryFrom,
} from './status-report.js';

const NOW = 1_700_000_000_000;
const at = (minutes: number) => ({ expiresAt: NOW + minutes * 60_000 });

describe('buildTokenRows', () => {
  // The regression this whole module exists for: the old block rendered the
  // three hardcoded ENV_URLS presets, so a worktree-offset local was invisible
  // and the `:8080` row it printed instead could never be refreshed.
  it('lists a backend that is not one of the three presets', () => {
    const rows = buildTokenRows(
      [{ url: 'http://localhost:9480', tokens: at(60) }],
      'http://localhost:9480',
      NOW,
    );
    expect(rows.map((r) => r.url)).toEqual(['http://localhost:9480']);
  });

  it('decides "active" by url, not by environment name', () => {
    const rows = buildTokenRows(
      [
        { url: 'http://localhost:8080', tokens: at(-99999) },
        { url: 'http://localhost:9480', tokens: at(60) },
      ],
      'http://localhost:9480',
      NOW,
    );
    // Both are "local" by name. Only the configured URL is active — marking
    // the :8080 preset active is exactly the old bug.
    expect(rows.filter((r) => r.active).map((r) => r.url)).toEqual([
      'http://localhost:9480',
    ]);
    expect(rows.every((r) => r.label === 'local')).toBe(true);
  });

  it('puts the active row first, then sorts the rest alphabetically', () => {
    const rows = buildTokenRows(
      [
        { url: 'https://api.levr.now', tokens: at(60) },
        { url: 'http://localhost:8080', tokens: at(60) },
        { url: 'http://localhost:9480', tokens: at(60) },
      ],
      'http://localhost:9480',
      NOW,
    );
    expect(rows.map((r) => r.url)).toEqual([
      'http://localhost:9480',
      'http://localhost:8080',
      'https://api.levr.now',
    ]);
  });

  it('marks nothing active when the configured backend has no token', () => {
    const rows = buildTokenRows(
      [{ url: 'https://api.levr.now', tokens: at(60) }],
      'http://localhost:9480',
      NOW,
    );
    expect(rows.some((r) => r.active)).toBe(false);
  });

  it('marks nothing active when there is no configured backend', () => {
    const rows = buildTokenRows(
      [{ url: 'https://api.levr.now', tokens: at(60) }],
      undefined,
      NOW,
    );
    expect(rows.some((r) => r.active)).toBe(false);
  });
});

describe('formatExpiry', () => {
  it('reports remaining minutes while valid', () => {
    expect(formatExpiry(NOW + 90 * 60_000, NOW)).toBe('valid 90m');
  });

  it('reports elapsed minutes once expired', () => {
    expect(formatExpiry(NOW - 12 * 60_000, NOW)).toBe('expired 12m ago');
  });

  it('treats the exact expiry instant as expired', () => {
    expect(formatExpiry(NOW, NOW)).toBe('expired 0m ago');
  });
});

describe('labelForBackend', () => {
  it('names the presets', () => {
    expect(labelForBackend('https://api.levr.now')).toBe('staging');
    expect(labelForBackend('https://api.levr.one')).toBe('production');
    expect(labelForBackend('http://localhost:8080')).toBe('local');
  });

  it('names a worktree-offset loopback backend local', () => {
    expect(labelForBackend('http://localhost:9480')).toBe('local');
    expect(labelForBackend('http://127.0.0.1:9480')).toBe('local');
  });

  it('names the DEV_TLS dev domain local', () => {
    expect(labelForBackend('https://ai.levr.test:3020/api')).toBe('local');
    expect(labelForBackend('https://api.levr.test:8080')).toBe('local');
  });

  it('names the levr.test apex local, not just its subdomains', () => {
    expect(labelForBackend('https://levr.test:3020')).toBe('local');
  });

  it('falls back to custom for a remote backend', () => {
    expect(labelForBackend('https://backend.testquality.net')).toBe('custom');
  });

  it('falls back to custom for an unparseable url', () => {
    expect(labelForBackend('not a url')).toBe('custom');
  });

  it('does not treat a lookalike host as local', () => {
    // `.endsWith('.levr.test')` must not match an attacker-ish suffix host.
    expect(labelForBackend('https://evil-levr.test.example.com')).toBe(
      'custom',
    );
  });
});

describe('backendUrlForLevrMcp', () => {
  it('maps the hosted staging MCP url to the api host it is keyed by', () => {
    expect(backendUrlForLevrMcp('https://ai.levr.now/api/v1/mcp')).toBe(
      'https://api.levr.now',
    );
  });

  it('maps the hosted production MCP url to the api host it is keyed by', () => {
    expect(backendUrlForLevrMcp('https://ai.levr.one/api/v1/mcp')).toBe(
      'https://api.levr.one',
    );
  });

  it('keys a worktree local verbatim', () => {
    expect(backendUrlForLevrMcp('http://localhost:9780/v1/mcp')).toBe(
      'http://localhost:9780',
    );
  });

  it('keys a DEV_TLS local verbatim, keeping the /api prefix', () => {
    // This exact string is a real key in the token map — rewriting it would
    // make the entry unreachable.
    expect(backendUrlForLevrMcp('https://ai.levr.test:3020/api/v1/mcp')).toBe(
      'https://ai.levr.test:3020/api',
    );
  });

  it('keeps two different worktree ports distinct', () => {
    expect(backendUrlForLevrMcp('http://localhost:8180/v1/mcp')).not.toBe(
      backendUrlForLevrMcp('http://localhost:8580/v1/mcp'),
    );
  });

  // review F-006. `PRESETS.local` must never join the alias loop: under
  // DEV_TLS its clientUrl+/api is `https://ai.levr.test:3020/api`, a real key
  // in the token map that has to resolve verbatim. Asserting against
  // PRESETS.local itself pins the exclusion in BOTH modes — a hardcoded
  // DEV_TLS string cannot, because isTestEnv() forces the plain-HTTP preset
  // and the assertion would pass over a broken function.
  it('never aliases the local preset, whichever variant is active', () => {
    const localMcp = `${PRESETS.local.clientUrl}/api/v1/mcp`;

    expect(backendUrlForLevrMcp(localMcp)).toBe(
      `${PRESETS.local.clientUrl}/api`,
    );
    expect(backendUrlForLevrMcp(localMcp)).not.toBe(PRESETS.local.apiUrl);
  });

  it('tolerates a trailing slash', () => {
    expect(backendUrlForLevrMcp('https://ai.levr.now/api/v1/mcp/')).toBe(
      'https://api.levr.now',
    );
  });
});

describe('levrEntryFrom', () => {
  const config = {
    mcpServers: {
      levr: {
        type: 'http',
        url: 'https://ai.levr.now/api/v1/mcp',
        headers: { 'Workspace-Id': 'ws-1' },
      },
      'qinetic-mcp': { type: 'stdio' },
    },
  };

  it('extracts the url and the Workspace-Id header', () => {
    expect(levrEntryFrom(config)).toEqual({
      url: 'https://ai.levr.now/api/v1/mcp',
      workspaceId: 'ws-1',
    });
  });

  it('returns the url alone when no Workspace-Id is pinned', () => {
    expect(
      levrEntryFrom({ mcpServers: { levr: { url: 'http://x/v1/mcp' } } }),
    ).toEqual({ url: 'http://x/v1/mcp', workspaceId: undefined });
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'nope'],
    ['no mcpServers', {}],
    ['no levr server', { mcpServers: { 'qinetic-mcp': { type: 'stdio' } } }],
    ['a levr server with no url', { mcpServers: { levr: { type: 'http' } } }],
    ['a non-string url', { mcpServers: { levr: { url: 42 } } }],
    ['an empty url', { mcpServers: { levr: { url: '' } } }],
  ])('returns undefined for %s', (_label, input) => {
    expect(levrEntryFrom(input)).toBeUndefined();
  });

  it('ignores a non-string Workspace-Id rather than rendering it', () => {
    expect(
      levrEntryFrom({
        mcpServers: {
          levr: { url: 'http://x/v1/mcp', headers: { 'Workspace-Id': 7 } },
        },
      }),
    ).toEqual({ url: 'http://x/v1/mcp', workspaceId: undefined });
  });
});
