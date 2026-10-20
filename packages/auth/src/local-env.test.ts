import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const state = vi.hoisted(() => ({ tmpDir: '' }));

// token-store's TQ_DIR is derived from os.homedir() at import time.
vi.mock('os', async (importOriginal) => {
  const original = await importOriginal<typeof import('os')>();
  return { ...original, homedir: () => state.tmpDir };
});

import { withNonTestEnv } from './test-utils.js';

let findLocalCheckoutRoot: typeof import('./local-env.js').findLocalCheckoutRoot;
let resolveLocalCheckout: typeof import('./local-env.js').resolveLocalCheckout;
let loadConfig: typeof import('./config.js').loadConfig;
let writeConfig: typeof import('./config.js').writeConfig;
let PRESETS: typeof import('./config.js').PRESETS;
let getCurrentApiUrl: typeof import('./token-store.js').getCurrentApiUrl;

/** A fake checkout: `<root>/apps/backender/<file>` for each entry. */
function makeCheckout(name: string, files: Record<string, string>): string {
  const root = path.join(state.tmpDir, name);
  const dir = path.join(root, 'apps', 'backender');
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), contents);
  }
  return root;
}

const WORKTREE_ENV =
  'API_BASE_URL=http://localhost:8380\n' +
  'AUTH_URL=http://localhost:3321\n' +
  'CLIENT_APP_URL=http://localhost:3320\n';

beforeEach(async () => {
  state.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tq-local-env-'));
  delete process.env.TQ_BACKEND_URL;
  vi.resetModules();
  ({ findLocalCheckoutRoot, resolveLocalCheckout } = await import(
    './local-env.js'
  ));
  ({ loadConfig, writeConfig, PRESETS } = await import('./config.js'));
  ({ getCurrentApiUrl } = await import('./token-store.js'));
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.TQ_BACKEND_URL;
  fs.rmSync(state.tmpDir, { recursive: true, force: true });
});

describe('findLocalCheckoutRoot', () => {
  it('walks up from a subdirectory to the checkout', () => {
    const root = makeCheckout('wt', { '.env': WORKTREE_ENV });
    const sub = path.join(root, 'plugins', 'qinetic-mcp');
    fs.mkdirSync(sub, { recursive: true });
    expect(findLocalCheckoutRoot(sub)).toBe(root);
  });

  it('is undefined outside any checkout', () => {
    const elsewhere = path.join(state.tmpDir, 'some-project');
    fs.mkdirSync(elsewhere, { recursive: true });
    expect(findLocalCheckoutRoot(elsewhere)).toBeUndefined();
  });
});

describe('resolveLocalCheckout', () => {
  it("reads all three URLs from the checkout's backender env", () => {
    const root = makeCheckout('wt', { '.env': WORKTREE_ENV });
    expect(resolveLocalCheckout(root)).toEqual({
      root,
      apiUrl: 'http://localhost:8380',
      authUrl: 'http://localhost:3321',
      clientUrl: 'http://localhost:3320',
    });
  });

  it('falls back to the local preset when the env names no origin', () => {
    const root = makeCheckout('main', { '.env': 'DB_DATABASE=tqaidb\n' });
    const local = resolveLocalCheckout(root);
    expect(local?.apiUrl).toBe('http://localhost:8080');
    expect(local?.authUrl).toBe('http://localhost:3021');
    expect(local?.clientUrl).toBe('http://localhost:3020');
  });

  it("rejects the SPA's /api proxy URL and uses the preset (internal)", () => {
    const root = makeCheckout('main', {
      '.env': 'API_BASE_URL=https://ai.levr.test:3020/api\n',
    });
    expect(resolveLocalCheckout(root)?.apiUrl).toBe('http://localhost:8080');
  });

  it('lets .env.worktree outrank .env, like the backender', () => {
    const root = makeCheckout('wt', {
      '.env.worktree': 'API_BASE_URL=http://localhost:9180\n',
      '.env': WORKTREE_ENV,
    });
    expect(resolveLocalCheckout(root)?.apiUrl).toBe('http://localhost:9180');
  });

  it('is undefined outside any checkout', () => {
    expect(resolveLocalCheckout(state.tmpDir)).toBeUndefined();
  });
});

// The internal acceptance case: ONE machine-global ~/.tq/config.json, written
// by `tq:env local` in a worktree, read from two different checkouts.
describe('one shared `local` config, two checkouts', () => {
  let main: string;
  let worktree: string;

  beforeEach(() => {
    main = makeCheckout('main', { '.env': 'DB_DATABASE=tqaidb\n' });
    worktree = makeCheckout('worktree', { '.env': WORKTREE_ENV });
    // What `tq:env local` run in the worktree writes.
    writeConfig({
      environment: 'local',
      apiUrl: 'http://localhost:8380',
      authUrl: 'http://localhost:3321',
      clientUrl: 'http://localhost:3320',
      oauthClientId: '2',
    });
  });

  const from = <T>(cwd: string, fn: () => T): T => {
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);
    return withNonTestEnv(fn);
  };

  it('loadConfig resolves each checkout to its own backend', () => {
    expect(from(main, () => loadConfig()).apiUrl).toBe('http://localhost:8080');
    expect(from(main, () => loadConfig()).authUrl).toBe(
      'http://localhost:3021',
    );
    expect(from(worktree, () => loadConfig()).apiUrl).toBe(
      'http://localhost:8380',
    );
  });

  it('getCurrentApiUrl agrees, so tokens are looked up per checkout', () => {
    expect(from(main, () => getCurrentApiUrl())).toBe('http://localhost:8080');
    expect(from(worktree, () => getCurrentApiUrl())).toBe(
      'http://localhost:8380',
    );
  });

  it('keeps the stored URLs outside any checkout', () => {
    const elsewhere = path.join(state.tmpDir, 'some-project');
    fs.mkdirSync(elsewhere, { recursive: true });
    expect(from(elsewhere, () => loadConfig()).apiUrl).toBe(
      'http://localhost:8380',
    );
    expect(from(elsewhere, () => getCurrentApiUrl())).toBe(
      'http://localhost:8380',
    );
  });

  it('TQ_BACKEND_URL still overrides both', () => {
    process.env.TQ_BACKEND_URL = 'http://localhost:8380';
    expect(from(main, () => loadConfig()).apiUrl).toBe('http://localhost:8380');
    expect(from(main, () => getCurrentApiUrl())).toBe('http://localhost:8380');
  });

  it('staging stays global: every checkout follows it', () => {
    writeConfig(PRESETS.staging);
    expect(from(main, () => loadConfig()).apiUrl).toBe('https://api.levr.now');
    expect(from(worktree, () => getCurrentApiUrl())).toBe(
      'https://api.levr.now',
    );
  });
});
