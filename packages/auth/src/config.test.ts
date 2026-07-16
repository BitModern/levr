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

describe('getConfigFilePath', () => {
  it('returns path under ~/.tq/', () => {
    const p = getConfigFilePath();
    expect(p).toBe(path.join(state.tmpDir, '.tq', 'config.json'));
  });
});
