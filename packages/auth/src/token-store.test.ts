import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { StoredTokens } from './types.js';

// Mutable ref so the mock can read the current tmpDir
const state = vi.hoisted(() => ({ tmpDir: '' }));

// Mock os.homedir() so token-store's module-level TQ_DIR uses our temp dir
vi.mock('os', async (importOriginal) => {
  const original = await importOriginal<typeof import('os')>();
  return { ...original, homedir: () => state.tmpDir };
});

// Re-import the module each test so module-level constants re-evaluate
let loadTokens: typeof import('./token-store.js').loadTokens;
let loadTokensForEnv: typeof import('./token-store.js').loadTokensForEnv;
let saveTokens: typeof import('./token-store.js').saveTokens;
let saveTokensForEnv: typeof import('./token-store.js').saveTokensForEnv;
let clearTokens: typeof import('./token-store.js').clearTokens;
let hasStoredTokens: typeof import('./token-store.js').hasStoredTokens;
let getTqDir: typeof import('./token-store.js').getTqDir;
let getTokenFilePath: typeof import('./token-store.js').getTokenFilePath;
let resolveEnvFromUrl: typeof import('./token-store.js').resolveEnvFromUrl;
let resolveUrlFromEnv: typeof import('./token-store.js').resolveUrlFromEnv;
let listTokenEntries: typeof import('./token-store.js').listTokenEntries;
let clearTokensForUrl: typeof import('./token-store.js').clearTokensForUrl;
let clearAllTokens: typeof import('./token-store.js').clearAllTokens;

const stagingTokens: StoredTokens = {
  accessToken: 'staging-access',
  refreshToken: 'staging-refresh',
  expiresAt: Date.now() + 3600000,
  apiBaseUrl: 'https://api.levr.now',
};

const localTokens: StoredTokens = {
  accessToken: 'local-access',
  refreshToken: 'local-refresh',
  expiresAt: Date.now() + 3600000,
  apiBaseUrl: 'http://localhost:8080',
};

beforeEach(async () => {
  state.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tq-oauth-test-'));
  // Reset module cache so TQ_DIR re-evaluates with the new homedir mock
  vi.resetModules();
  const mod = await import('./token-store.js');
  loadTokens = mod.loadTokens;
  loadTokensForEnv = mod.loadTokensForEnv;
  saveTokens = mod.saveTokens;
  saveTokensForEnv = mod.saveTokensForEnv;
  clearTokens = mod.clearTokens;
  hasStoredTokens = mod.hasStoredTokens;
  getTqDir = mod.getTqDir;
  getTokenFilePath = mod.getTokenFilePath;
  resolveEnvFromUrl = mod.resolveEnvFromUrl;
  resolveUrlFromEnv = mod.resolveUrlFromEnv;
  listTokenEntries = mod.listTokenEntries;
  clearTokensForUrl = mod.clearTokensForUrl;
  clearAllTokens = mod.clearAllTokens;
});

afterEach(() => {
  delete process.env.TQ_BACKEND_URL;
  fs.rmSync(state.tmpDir, { recursive: true, force: true });
});

describe('getTqDir', () => {
  it('returns ~/.tq path based on homedir', () => {
    expect(getTqDir()).toBe(path.join(state.tmpDir, '.tq'));
  });
});

describe('getTokenFilePath', () => {
  it('returns path to oauth-tokens.json', () => {
    expect(getTokenFilePath()).toBe(
      path.join(state.tmpDir, '.tq', 'oauth-tokens.json'),
    );
  });
});

describe('resolveEnvFromUrl', () => {
  it('resolves local URL', () => {
    expect(resolveEnvFromUrl('http://localhost:8080')).toBe('local');
  });

  it('resolves staging URL', () => {
    expect(resolveEnvFromUrl('https://api.levr.now')).toBe('staging');
  });

  it('resolves production URL', () => {
    expect(resolveEnvFromUrl('https://api.levr.one')).toBe('production');
  });

  it('strips trailing slashes', () => {
    expect(resolveEnvFromUrl('http://localhost:8080/')).toBe('local');
  });

  it('returns undefined for unknown URLs', () => {
    expect(resolveEnvFromUrl('https://custom.example.com')).toBeUndefined();
  });
});

describe('resolveUrlFromEnv', () => {
  it('returns correct URL for each env', () => {
    expect(resolveUrlFromEnv('local')).toBe('http://localhost:8080');
    expect(resolveUrlFromEnv('staging')).toBe('https://api.levr.now');
    expect(resolveUrlFromEnv('production')).toBe('https://api.levr.one');
  });
});

describe('saveTokens + loadTokens roundtrip', () => {
  it('saves and loads tokens correctly', () => {
    saveTokens(stagingTokens);
    // loadTokens reads the entry matching the current env;
    // without config.json it falls back to first entry
    const loaded = loadTokens();
    expect(loaded).toEqual(stagingTokens);
  });

  it('creates ~/.tq directory if missing', () => {
    expect(fs.existsSync(path.join(state.tmpDir, '.tq'))).toBe(false);
    saveTokens(stagingTokens);
    expect(fs.existsSync(path.join(state.tmpDir, '.tq'))).toBe(true);
  });

  it('overwrites existing tokens for the same env', () => {
    saveTokens(stagingTokens);
    const updated: StoredTokens = {
      ...stagingTokens,
      accessToken: 'new-token',
    };
    saveTokens(updated);
    const loaded = loadTokensForEnv('staging');
    expect(loaded?.accessToken).toBe('new-token');
  });
});

describe('token map: multiple environments', () => {
  it('stores tokens for multiple environments in one file', () => {
    saveTokens(stagingTokens);
    saveTokens(localTokens);

    expect(loadTokensForEnv('staging')?.accessToken).toBe('staging-access');
    expect(loadTokensForEnv('local')?.accessToken).toBe('local-access');
    expect(loadTokensForEnv('production')).toBeNull();
  });

  it('loadTokens returns entry matching current env via TQ_BACKEND_URL', () => {
    saveTokens(stagingTokens);
    saveTokens(localTokens);

    process.env.TQ_BACKEND_URL = 'http://localhost:8080';
    const loaded = loadTokens();
    expect(loaded?.accessToken).toBe('local-access');
  });

  it('loadTokens returns entry matching config.json', () => {
    saveTokens(stagingTokens);
    saveTokens(localTokens);

    // Write a config.json pointing to staging
    const tqDir = path.join(state.tmpDir, '.tq');
    fs.writeFileSync(
      path.join(tqDir, 'config.json'),
      JSON.stringify({ apiUrl: 'https://api.levr.now' }),
    );

    const loaded = loadTokens();
    expect(loaded?.accessToken).toBe('staging-access');
  });

  it('loadTokens falls back to first entry when no config', () => {
    saveTokens(stagingTokens);
    const loaded = loadTokens();
    expect(loaded?.accessToken).toBe('staging-access');
  });
});

describe('backward compatibility: legacy single-token format', () => {
  it('migrates legacy format on first read', () => {
    const tqDir = path.join(state.tmpDir, '.tq');
    fs.mkdirSync(tqDir, { recursive: true });
    // Write legacy format (flat object)
    fs.writeFileSync(
      path.join(tqDir, 'oauth-tokens.json'),
      JSON.stringify(stagingTokens),
    );

    const loaded = loadTokens();
    expect(loaded?.accessToken).toBe('staging-access');

    // File should now be in map format
    const raw = JSON.parse(
      fs.readFileSync(path.join(tqDir, 'oauth-tokens.json'), 'utf-8'),
    ) as Record<string, StoredTokens>;
    expect(raw['https://api.levr.now']).toBeDefined();
    expect(raw['https://api.levr.now'].accessToken).toBe('staging-access');
  });

  it('migrates legacy format without apiBaseUrl using staging default', () => {
    const tqDir = path.join(state.tmpDir, '.tq');
    fs.mkdirSync(tqDir, { recursive: true });
    const legacy: StoredTokens = {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 9999999999999,
    };
    fs.writeFileSync(
      path.join(tqDir, 'oauth-tokens.json'),
      JSON.stringify(legacy),
    );

    const loaded = loadTokens();
    expect(loaded?.accessToken).toBe('a');
  });
});

describe('loadTokens', () => {
  it('returns null when no token file exists', () => {
    expect(loadTokens()).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const tqDir = path.join(state.tmpDir, '.tq');
    fs.mkdirSync(tqDir, { recursive: true });
    fs.writeFileSync(path.join(tqDir, 'oauth-tokens.json'), 'not-json');
    expect(loadTokens()).toBeNull();
  });
});

describe('loadTokensForEnv', () => {
  it('returns null when no matching token exists', () => {
    saveTokens(stagingTokens);
    expect(loadTokensForEnv('local')).toBeNull();
  });

  it('returns the correct env token', () => {
    saveTokens(stagingTokens);
    saveTokens(localTokens);
    expect(loadTokensForEnv('staging')?.accessToken).toBe('staging-access');
    expect(loadTokensForEnv('local')?.accessToken).toBe('local-access');
  });
});

describe('clearTokens', () => {
  it('removes the token for the current environment', () => {
    saveTokens(stagingTokens);
    saveTokens(localTokens);

    // Clear staging (current env via TQ_BACKEND_URL)
    process.env.TQ_BACKEND_URL = 'https://api.levr.now';
    clearTokens();

    expect(loadTokensForEnv('staging')).toBeNull();
    expect(loadTokensForEnv('local')?.accessToken).toBe('local-access');
  });

  it('removes entire file when last token cleared', () => {
    saveTokens(stagingTokens);
    process.env.TQ_BACKEND_URL = 'https://api.levr.now';
    clearTokens();
    expect(hasStoredTokens()).toBe(false);
  });

  it('does not throw when no token file exists', () => {
    expect(() => clearTokens()).not.toThrow();
  });

  // internal D2. This used to unlink the WHOLE file: an absent config.json
  // with no TQ_BACKEND_URL destroyed every backend's credentials while the
  // operator believed they were logging out of one.
  it('refuses, and keeps every token, when no backend can be resolved', () => {
    saveTokens(stagingTokens);
    saveTokens({ ...localTokens, apiBaseUrl: 'http://localhost:9480' });
    fs.rmSync(path.join(state.tmpDir, '.tq', 'config.json'), { force: true });
    delete process.env.TQ_BACKEND_URL;

    expect(clearTokens()).toBe(false);
    expect(
      listTokenEntries()
        .map((e) => e.url)
        .sort(),
    ).toEqual(['http://localhost:9480', 'https://api.levr.now']);
  });

  it('creates a backup before clearing', () => {
    saveTokens(stagingTokens);
    process.env.TQ_BACKEND_URL = 'https://api.levr.now';
    clearTokens();
    const backupPath = getTokenFilePath() + '.bak';
    expect(fs.existsSync(backupPath)).toBe(true);
  });
});

describe('hasStoredTokens', () => {
  it('returns false when no file exists', () => {
    expect(hasStoredTokens()).toBe(false);
  });

  it('returns true after saving tokens', () => {
    saveTokens(stagingTokens);
    expect(hasStoredTokens()).toBe(true);
  });
});

describe('saveTokensForEnv', () => {
  it('saves and retrieves by env name', () => {
    saveTokensForEnv('production', {
      ...stagingTokens,
      accessToken: 'prod-access',
      apiBaseUrl: 'https://api.levr.one',
    });
    const loaded = loadTokensForEnv('production');
    expect(loaded?.accessToken).toBe('prod-access');
  });
});

describe('listTokenEntries', () => {
  it('returns every stored backend, including ones absent from ENV_URLS', () => {
    // A worktree-offset local. `loadTokensForEnv('local')` cannot see this —
    // it only ever looks at the hardcoded `http://localhost:8080`. (internal)
    saveTokens({ ...localTokens, apiBaseUrl: 'http://localhost:9480' });
    saveTokens(stagingTokens);

    const urls = listTokenEntries().map((e) => e.url);
    expect(urls).toContain('http://localhost:9480');
    expect(urls).toContain('https://api.levr.now');
    expect(loadTokensForEnv('local')).toBeNull();
  });

  it('returns an empty array when nothing is stored', () => {
    expect(listTokenEntries()).toEqual([]);
  });

  it('pairs each url with its own tokens', () => {
    saveTokens({ ...localTokens, apiBaseUrl: 'http://localhost:9480' });
    const entry = listTokenEntries().find(
      (e) => e.url === 'http://localhost:9480',
    );
    expect(entry?.tokens.accessToken).toBe('local-access');
  });

  it('drops malformed entries rather than surfacing them as tokens', () => {
    saveTokens(stagingTokens);
    const file = getTokenFilePath();
    const map = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<
      string,
      unknown
    >;
    map['http://localhost:9480'] = { accessToken: 'no-refresh-no-expiry' };
    fs.writeFileSync(file, JSON.stringify(map));

    const urls = listTokenEntries().map((e) => e.url);
    expect(urls).toEqual(['https://api.levr.now']);
  });

  it('normalizes a trailing-slash key so one backend yields one row', () => {
    saveTokens({ ...stagingTokens, apiBaseUrl: 'https://api.levr.now/' });
    expect(listTokenEntries().map((e) => e.url)).toEqual([
      'https://api.levr.now',
    ]);
  });
});

describe('clearTokensForUrl', () => {
  it('removes exactly one backend and leaves the rest', () => {
    saveTokens(stagingTokens);
    saveTokens({ ...localTokens, apiBaseUrl: 'http://localhost:8180' });
    saveTokens({ ...localTokens, apiBaseUrl: 'http://localhost:9480' });

    expect(clearTokensForUrl('http://localhost:8180')).toBe(true);
    expect(
      listTokenEntries()
        .map((e) => e.url)
        .sort(),
    ).toEqual(['http://localhost:9480', 'https://api.levr.now']);
  });

  it('reports false for a backend it has no token for', () => {
    saveTokens(stagingTokens);
    expect(clearTokensForUrl('http://localhost:8180')).toBe(false);
    expect(listTokenEntries()).toHaveLength(1);
  });

  it('matches a trailing-slash url to the canonical entry', () => {
    saveTokens(stagingTokens);
    expect(clearTokensForUrl('https://api.levr.now/')).toBe(true);
    expect(hasStoredTokens()).toBe(false);
  });

  it('ignores a url that is not a usable key', () => {
    saveTokens(stagingTokens);
    expect(clearTokensForUrl('   ')).toBe(false);
    expect(listTokenEntries()).toHaveLength(1);
  });

  it('backs the file up before removing an entry', () => {
    saveTokens(stagingTokens);
    saveTokens({ ...localTokens, apiBaseUrl: 'http://localhost:8180' });
    clearTokensForUrl('http://localhost:8180');
    expect(fs.existsSync(getTokenFilePath() + '.bak')).toBe(true);
  });

  it('does not write a backup when there was nothing to remove', () => {
    saveTokens(stagingTokens);
    clearTokensForUrl('http://localhost:8180');
    // A no-op must not burn the single backup slot — that backup is the only
    // thing standing between a mistyped url and a lost credential.
    expect(fs.existsSync(getTokenFilePath() + '.bak')).toBe(false);
  });

  it('removes the file when the last entry goes', () => {
    saveTokens(stagingTokens);
    expect(clearTokensForUrl('https://api.levr.now')).toBe(true);
    expect(hasStoredTokens()).toBe(false);
  });
});

describe('clearAllTokens', () => {
  it('removes every backend', () => {
    saveTokens(stagingTokens);
    saveTokens({ ...localTokens, apiBaseUrl: 'http://localhost:9480' });

    clearAllTokens();

    expect(hasStoredTokens()).toBe(false);
    expect(listTokenEntries()).toEqual([]);
  });

  it('backs up first', () => {
    saveTokens(stagingTokens);
    const backup = getTokenFilePath() + '.bak';
    clearAllTokens();
    expect(fs.existsSync(backup)).toBe(true);
  });

  it('does not throw when there is no token file', () => {
    expect(() => clearAllTokens()).not.toThrow();
  });
});
