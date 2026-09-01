import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mutable ref so the mock factory can read the current tmpDir
const state = vi.hoisted(() => ({ tmpDir: '' }));

// Mock token-store — config.ts imports getTqDir and loadTokens from it
vi.mock('./token-store.js', () => ({
  getTqDir: () => path.join(state.tmpDir, '.tq'),
  loadTokens: () => null,
}));

import {
  loadConfig,
  writeConfig,
  resolveFromApiUrl,
  getConfigFilePath,
  PRESETS,
  parseDevTls,
  parseLocalBackenderOrigin,
  extractEnvValue,
  resolveOriginFromEnvFiles,
  type TqConfig,
} from './config.js';

/**
 * Temporarily simulate a non-test environment so loadConfig()
 * exercises the config-file reading path.
 */
function withNonTestEnv<T>(fn: () => T): T {
  const saved = {
    VITEST: process.env.VITEST,
    NODE_ENV: process.env.NODE_ENV,
    JEST_WORKER_ID: process.env.JEST_WORKER_ID,
  };
  delete process.env.VITEST;
  process.env.NODE_ENV = 'development';
  delete process.env.JEST_WORKER_ID;
  try {
    return fn();
  } finally {
    if (saved.VITEST !== undefined) process.env.VITEST = saved.VITEST;
    else delete process.env.VITEST;
    if (saved.NODE_ENV !== undefined) process.env.NODE_ENV = saved.NODE_ENV;
    else delete process.env.NODE_ENV;
    if (saved.JEST_WORKER_ID !== undefined)
      process.env.JEST_WORKER_ID = saved.JEST_WORKER_ID;
    else delete process.env.JEST_WORKER_ID;
  }
}

beforeEach(() => {
  state.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tq-oauth-test-'));
  // Clear relevant env vars
  delete process.env.TQ_BACKEND_URL;
  delete process.env.TQ_OAUTH_CLIENT_ID;
});

afterEach(() => {
  fs.rmSync(state.tmpDir, { recursive: true, force: true });
  delete process.env.TQ_BACKEND_URL;
  delete process.env.TQ_OAUTH_CLIENT_ID;
});

// ---------- resolveFromApiUrl ----------

describe('resolveFromApiUrl', () => {
  it('returns staging preset for staging URL', () => {
    const config = resolveFromApiUrl('https://api.levr.now');
    expect(config.environment).toBe('staging');
    expect(config.apiUrl).toBe('https://api.levr.now');
    expect(config.authUrl).toBe('https://auth.levr.now');
    expect(config.clientUrl).toBe('https://ai.levr.now');
  });

  it('returns local preset for localhost URL', () => {
    const config = resolveFromApiUrl('http://localhost:8080');
    expect(config.environment).toBe('local');
    expect(config.authUrl).toBe('http://localhost:3021');
  });

  it('returns local preset for canonical TLS URL (api.levr.test)', () => {
    const config = resolveFromApiUrl('https://api.levr.test:8080');
    expect(config.environment).toBe('local');
    expect(config.apiUrl).toBe('https://api.levr.test:8080');
    expect(config.authUrl).toBe('https://auth.levr.test:3021');
    expect(config.clientUrl).toBe('https://ai.levr.test:3020');
  });

  it('treats legacy https://localhost:8080 as an alias of LOCAL_HTTPS', () => {
    // Tokens issued before LOCAL_HTTPS adopted *.levr.test still need to
    // resolve to 'local' so users don't fall through to 'custom' on
    // upgrade. The alias maps to the NEW canonical URLs.
    const config = resolveFromApiUrl('https://localhost:8080');
    expect(config.environment).toBe('local');
    expect(config.apiUrl).toBe('https://api.levr.test:8080');
    expect(config.authUrl).toBe('https://auth.levr.test:3021');
    expect(config.clientUrl).toBe('https://ai.levr.test:3020');
  });

  it('returns production preset for production URL', () => {
    const config = resolveFromApiUrl('https://api.levr.one');
    expect(config.environment).toBe('production');
    expect(config.authUrl).toBe('https://auth.levr.one');
  });

  it('strips trailing slashes before matching', () => {
    const config = resolveFromApiUrl('http://localhost:8080///');
    expect(config.environment).toBe('local');
  });

  it('returns custom environment for unknown URLs', () => {
    const config = resolveFromApiUrl('https://my-backend.example.com');
    expect(config.environment).toBe('custom');
    expect(config.apiUrl).toBe('https://my-backend.example.com');
    expect(config.oauthClientId).toBe('2');
  });

  it('returns a fresh copy for each call', () => {
    const a = resolveFromApiUrl('http://localhost:8080');
    const b = resolveFromApiUrl('http://localhost:8080');
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ---------- loadConfig ----------

describe('loadConfig', () => {
  it('defaults to staging when no env var and no config file', () => {
    const config = loadConfig();
    expect(config).toEqual(PRESETS.staging);
  });

  it('uses TQ_BACKEND_URL env var when set', () => {
    process.env.TQ_BACKEND_URL = 'http://localhost:8080';
    const config = loadConfig();
    expect(config.environment).toBe('local');
    expect(config.apiUrl).toBe('http://localhost:8080');
  });

  it('env var takes precedence over config file', () => {
    const tqDir = path.join(state.tmpDir, '.tq');
    fs.mkdirSync(tqDir, { recursive: true });
    fs.writeFileSync(
      path.join(tqDir, 'config.json'),
      JSON.stringify(PRESETS.staging),
    );

    process.env.TQ_BACKEND_URL = 'http://localhost:8080';
    const config = loadConfig();
    expect(config.environment).toBe('local');
  });

  it('reads config from ~/.tq/config.json when no env var (non-test env)', () => {
    const tqDir = path.join(state.tmpDir, '.tq');
    fs.mkdirSync(tqDir, { recursive: true });
    fs.writeFileSync(
      path.join(tqDir, 'config.json'),
      JSON.stringify(PRESETS.production),
    );

    const config = withNonTestEnv(() => loadConfig());
    expect(config.environment).toBe('production');
    expect(config.apiUrl).toBe('https://api.levr.one');
  });

  it('skips config file in test environments and defaults to staging', () => {
    const tqDir = path.join(state.tmpDir, '.tq');
    fs.mkdirSync(tqDir, { recursive: true });
    fs.writeFileSync(
      path.join(tqDir, 'config.json'),
      JSON.stringify(PRESETS.production),
    );

    // VITEST env var is set by vitest — loadConfig should skip the file
    const config = loadConfig();
    expect(config).toEqual(PRESETS.staging);
  });

  it('falls back to staging on malformed config.json (non-test env)', () => {
    const tqDir = path.join(state.tmpDir, '.tq');
    fs.mkdirSync(tqDir, { recursive: true });
    fs.writeFileSync(path.join(tqDir, 'config.json'), 'not json{{{');

    const config = withNonTestEnv(() => loadConfig());
    expect(config).toEqual(PRESETS.staging);
  });

  it('applies TQ_OAUTH_CLIENT_ID override with env var source', () => {
    process.env.TQ_BACKEND_URL = 'http://localhost:8080';
    process.env.TQ_OAUTH_CLIENT_ID = '99';
    const config = loadConfig();
    expect(config.oauthClientId).toBe('99');
  });

  it('applies TQ_OAUTH_CLIENT_ID override with config file source (non-test env)', () => {
    const tqDir = path.join(state.tmpDir, '.tq');
    fs.mkdirSync(tqDir, { recursive: true });
    fs.writeFileSync(
      path.join(tqDir, 'config.json'),
      JSON.stringify(PRESETS.local),
    );
    process.env.TQ_OAUTH_CLIENT_ID = '42';
    const config = withNonTestEnv(() => loadConfig());
    expect(config.oauthClientId).toBe('42');
  });

  it('applies TQ_OAUTH_CLIENT_ID override with default source', () => {
    process.env.TQ_OAUTH_CLIENT_ID = '7';
    const config = loadConfig();
    expect(config.oauthClientId).toBe('7');
    expect(config.environment).toBe('staging');
  });

  it('defaults oauthClientId to 2 when missing from config file (non-test env)', () => {
    const tqDir = path.join(state.tmpDir, '.tq');
    fs.mkdirSync(tqDir, { recursive: true });
    fs.writeFileSync(
      path.join(tqDir, 'config.json'),
      JSON.stringify({
        environment: 'local',
        apiUrl: 'http://localhost:8080',
        authUrl: 'http://localhost:3021',
        clientUrl: 'http://localhost:3020',
      }),
    );
    const config = withNonTestEnv(() => loadConfig());
    expect(config.oauthClientId).toBe('2');
  });
});

// ---------- writeConfig ----------

describe('writeConfig', () => {
  it('creates ~/.tq directory and writes config.json', () => {
    writeConfig(PRESETS.local);

    const configPath = getConfigFilePath();
    expect(fs.existsSync(configPath)).toBe(true);

    const written = JSON.parse(
      fs.readFileSync(configPath, 'utf-8'),
    ) as TqConfig;
    expect(written.environment).toBe('local');
    expect(written.apiUrl).toBe('http://localhost:8080');
  });

  it('overwrites existing config', () => {
    writeConfig(PRESETS.local);
    writeConfig(PRESETS.staging);

    const configPath = getConfigFilePath();
    const written = JSON.parse(
      fs.readFileSync(configPath, 'utf-8'),
    ) as TqConfig;
    expect(written.environment).toBe('staging');
  });

  it('does not leave temp files after write', () => {
    writeConfig(PRESETS.local);

    const tqDir = path.join(state.tmpDir, '.tq');
    const files = fs.readdirSync(tqDir);
    expect(files).not.toContain('config.json.tmp');
    expect(files).toContain('config.json');
  });

  it('round-trips through writeConfig and loadConfig (non-test env)', () => {
    writeConfig(PRESETS.production);
    const loaded = withNonTestEnv(() => loadConfig());
    expect(loaded).toEqual(PRESETS.production);
  });
});

// ---------- getConfigFilePath ----------

/**
 * `parseDevTls` — the DEV_TLS reader, duplicated verbatim from
 * `apps/sync-server/src/auth.ts`. It had NO coverage here, while this package
 * is inlined into the published `@levr-one/cli` bundle, so a divergence would
 * ship to npm.
 *
 * These pin PARITY WITH DOTENV, because dotenv is what actually decides the
 * backender's TLS mode (apps/backender/src/env.ts). Every case below once
 * diverged and every divergence failed CLOSED — it missed a real
 * `DEV_TLS=true` and so dialled http:// at a TLS backender, which is this
 * file's own bug mirrored.
 *
 * The surrounding fs walk-up (and `.env.worktree` precedence) is covered in
 * apps/sync-server/src/__tests__/auth.test.ts: this package imports fs as a
 * namespace (`import * as fs`), which ESM makes non-spyable, and mocking `fs`
 * wholesale would break the sibling tests that write real temp files.
 */
describe('parseDevTls', () => {
  it('reads the plain and quoted forms', () => {
    expect(parseDevTls('DEV_TLS=true')).toBe(true);
    expect(parseDevTls('DEV_TLS=false')).toBe(false);
    expect(parseDevTls('DEV_TLS="true"')).toBe(true);
    expect(parseDevTls("DEV_TLS='true'")).toBe(true);
    expect(parseDevTls('DEV_TLS=true\r\n')).toBe(true);
  });

  it('accepts the `export ` prefix — the form dev-tls-setup.md prints', () => {
    expect(parseDevTls('export DEV_TLS=true')).toBe(true);
    expect(parseDevTls('export DEV_TLS=false')).toBe(false);
  });

  it('strips a trailing comment on an unquoted value', () => {
    expect(parseDevTls('DEV_TLS=true # mkcert on')).toBe(true);
    expect(parseDevTls('DEV_TLS=false # off')).toBe(false);
  });

  it('takes the LAST assignment when the key repeats, as dotenv does', () => {
    expect(parseDevTls('DEV_TLS=false\nDEV_TLS=true')).toBe(true);
    expect(parseDevTls('DEV_TLS=true\nDEV_TLS=false')).toBe(false);
  });

  it('returns undefined when the key is absent, so the caller keeps looking', () => {
    expect(parseDevTls('PORT=8080\n')).toBeUndefined();
    expect(parseDevTls('# DEV_TLS=true')).toBeUndefined();
    expect(parseDevTls('MY_DEV_TLS=true')).toBeUndefined();
    expect(parseDevTls('DEV_TLS_PORT=1')).toBeUndefined();
  });

  it('is case-sensitive on the value — only exactly `true` enables TLS', () => {
    expect(parseDevTls('DEV_TLS=TRUE')).toBe(false);
    expect(parseDevTls('DEV_TLS=1')).toBe(false);
    expect(parseDevTls('DEV_TLS=yes')).toBe(false);
  });
});

describe('getConfigFilePath', () => {
  it('returns path under ~/.tq/', () => {
    const p = getConfigFilePath();
    expect(p).toBe(path.join(state.tmpDir, '.tq', 'config.json'));
  });
});

/**
 * internal and its review follow-ups (internal…internal).
 *
 * `tq:env local` overrode a correctly-computed preset with
 * `apps/backender/.env`'s `API_BASE_URL` — a key that does NOT mean the same
 * thing in every env file. The original guard was `/^https?:\/\//`, which the
 * client SPA's proxy URL passed.
 *
 * The values below are the REAL ones from the real checkouts, so the
 * regression is pinned to observed data rather than an invented shape.
 */
describe('parseLocalBackenderOrigin', () => {
  it('accepts a worktree backender origin — the value the override exists for', () => {
    expect(parseLocalBackenderOrigin('http://localhost:8580')).toBe(
      'http://localhost:8580',
    );
    expect(parseLocalBackenderOrigin('https://api.levr.test:8080')).toBe(
      'https://api.levr.test:8080',
    );
  });

  it('REJECTS the client SPA proxy URL that caused internal', () => {
    expect(
      parseLocalBackenderOrigin('https://ai.levr.test:3020/api'),
    ).toBeUndefined();
  });

  /**
   * internal. The first cut validated the PARSED url and returned the RAW
   * string, so every shape WHATWG normalises during parsing slipped through
   * and came back unnormalised. These are the exact escapes it allowed.
   */
  it('rejects shapes that only normalise away during parsing', () => {
    // `search`/`hash` are EMPTY strings here, so a parsed-only check is blind.
    expect(parseLocalBackenderOrigin('http://localhost:8080?')).toBeUndefined();
    expect(parseLocalBackenderOrigin('http://localhost:8080#')).toBeUndefined();
    // `/foo/..` collapses to `/`, so pathname looks clean.
    expect(
      parseLocalBackenderOrigin('http://localhost:8080/foo/..'),
    ).toBeUndefined();
  });

  it('never returns the raw text — the parsed origin is what comes back', () => {
    // Token and workspace stores are keyed BY URL, so casing must not vary.
    expect(parseLocalBackenderOrigin('HTTP://LocalHost:8580')).toBe(
      'http://localhost:8580',
    );
  });

  it('rejects credentials rather than silently stripping them', () => {
    expect(
      parseLocalBackenderOrigin('http://user:pass@localhost:8080'),
    ).toBeUndefined();
  });

  it('rejects any path, query or fragment', () => {
    expect(parseLocalBackenderOrigin('http://localhost:8080/')).toBe(
      'http://localhost:8080',
    );
    expect(
      parseLocalBackenderOrigin('http://localhost:8080/v1'),
    ).toBeUndefined();
    expect(
      parseLocalBackenderOrigin('http://localhost:8080?x=1'),
    ).toBeUndefined();
    expect(
      parseLocalBackenderOrigin('http://localhost:8080#f'),
    ).toBeUndefined();
  });

  it('rejects non-http(s) schemes and unparseable values', () => {
    expect(parseLocalBackenderOrigin('ftp://localhost:8080')).toBeUndefined();
    expect(parseLocalBackenderOrigin('file:///tmp/x')).toBeUndefined();
    expect(parseLocalBackenderOrigin(undefined)).toBeUndefined();
    expect(parseLocalBackenderOrigin('')).toBeUndefined();
    expect(parseLocalBackenderOrigin('   ')).toBeUndefined();
    expect(parseLocalBackenderOrigin('not a url')).toBeUndefined();
  });
});

/**
 * internal / internal — the dotenv shapes `parseDevTls` already handles.
 * The repo has ALREADY been bitten by the `export ` form on this very key:
 * see `scripts/worktree-delete.test.ts:319`.
 */
describe('extractEnvValue', () => {
  const KEY = 'API_BASE_URL';

  it('reads the plain and quoted forms', () => {
    expect(extractEnvValue('API_BASE_URL=http://localhost:8580', KEY)).toBe(
      'http://localhost:8580',
    );
    expect(extractEnvValue('API_BASE_URL="http://localhost:8580"', KEY)).toBe(
      'http://localhost:8580',
    );
    expect(extractEnvValue("API_BASE_URL='http://localhost:8580'", KEY)).toBe(
      'http://localhost:8580',
    );
  });

  it('accepts the `export ` prefix', () => {
    expect(
      extractEnvValue('export API_BASE_URL=http://localhost:8580', KEY),
    ).toBe('http://localhost:8580');
  });

  it('strips a trailing comment on an unquoted value', () => {
    expect(
      extractEnvValue('API_BASE_URL=http://localhost:8580 # worktree', KEY),
    ).toBe('http://localhost:8580');
  });

  it('takes the LAST assignment when the key repeats, as dotenv does', () => {
    expect(
      extractEnvValue(
        'API_BASE_URL=http://localhost:1111\nAPI_BASE_URL=http://localhost:8580',
        KEY,
      ),
    ).toBe('http://localhost:8580');
  });

  it('leaves an UNPAIRED quote intact rather than half-stripping it', () => {
    expect(extractEnvValue('API_BASE_URL="http://localhost:8580', KEY)).toBe(
      '"http://localhost:8580',
    );
  });

  it('returns undefined when the key is absent, so the caller keeps looking', () => {
    expect(extractEnvValue('PORT=8580\n', KEY)).toBeUndefined();
    expect(extractEnvValue('# API_BASE_URL=http://x', KEY)).toBeUndefined();
  });
});

/**
 * internal. The precedence rule, which had ZERO coverage before this — a
 * mutation reverting the whole `.env.worktree` change left 250/250 tests
 * passing.
 *
 * The load-bearing property: the first file that CONTAINS the key decides,
 * even when its value is unusable. Falling through to a lower-precedence file
 * would let the CLI and the backender resolve different URLs for one key.
 */
describe('resolveOriginFromEnvFiles', () => {
  const KEY = 'API_BASE_URL';

  it('prefers the first file, matching apps/backender/src/env.ts load order', () => {
    expect(
      resolveOriginFromEnvFiles(KEY, [
        'API_BASE_URL=http://localhost:9999',
        'API_BASE_URL=http://localhost:8580',
      ]),
    ).toBe('http://localhost:9999');
  });

  it('falls through only when the key is ABSENT from the earlier file', () => {
    expect(
      resolveOriginFromEnvFiles(KEY, [
        'PORT=9999',
        'API_BASE_URL=http://localhost:8580',
      ]),
    ).toBe('http://localhost:8580');
    expect(
      resolveOriginFromEnvFiles(KEY, [
        undefined,
        'API_BASE_URL=http://localhost:8580',
      ]),
    ).toBe('http://localhost:8580');
  });

  it('STOPS at an unusable value instead of falling to a lower file', () => {
    // The whole point: the backender would use the proxy URL from the first
    // file, so the CLI must not silently resolve the second one.
    expect(
      resolveOriginFromEnvFiles(KEY, [
        'API_BASE_URL=https://ai.levr.test:3020/api',
        'API_BASE_URL=http://localhost:8580',
      ]),
    ).toBeUndefined();
  });

  it('returns undefined when no file carries the key', () => {
    expect(
      resolveOriginFromEnvFiles(KEY, [undefined, undefined]),
    ).toBeUndefined();
    expect(
      resolveOriginFromEnvFiles(KEY, ['PORT=1', 'PORT=2']),
    ).toBeUndefined();
  });
});
