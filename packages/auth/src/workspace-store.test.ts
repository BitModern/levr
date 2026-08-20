import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mutable ref so the mock can read the current tmpDir
const state = vi.hoisted(() => ({ tmpDir: '' }));

// Mock os.homedir() so token-store's module-level TQ_DIR uses our temp dir
vi.mock('os', async (importOriginal) => {
  const original = await importOriginal<typeof import('os')>();
  return { ...original, homedir: () => state.tmpDir };
});

// Re-import each test so module-level constants re-evaluate
let loadWorkspace: typeof import('./workspace-store.js').loadWorkspace;
let saveWorkspace: typeof import('./workspace-store.js').saveWorkspace;
let clearWorkspace: typeof import('./workspace-store.js').clearWorkspace;
let getWorkspaceFilePath: typeof import('./workspace-store.js').getWorkspaceFilePath;
let loadIdentityCache: typeof import('./workspace-store.js').loadIdentityCache;
let refreshMirror: typeof import('./workspace-store.js').refreshMirror;
let saveIdentityCache: typeof import('./workspace-store.js').saveIdentityCache;

beforeEach(async () => {
  state.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tq-ws-test-'));
  // The backend resolver reads TQ_BACKEND_URL, so a developer or CI runner
  // with it exported would silently re-key every expectation here (8 of these
  // failed that way before this line existed).
  vi.stubEnv('TQ_BACKEND_URL', '');
  vi.resetModules();
  const mod = await import('./workspace-store.js');
  loadWorkspace = mod.loadWorkspace;
  saveWorkspace = mod.saveWorkspace;
  clearWorkspace = mod.clearWorkspace;
  getWorkspaceFilePath = mod.getWorkspaceFilePath;
  loadIdentityCache = mod.loadIdentityCache;
  refreshMirror = mod.refreshMirror;
  saveIdentityCache = mod.saveIdentityCache;
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(state.tmpDir, { recursive: true, force: true });
});

describe('getWorkspaceFilePath', () => {
  it('returns path to workspace.json', () => {
    expect(getWorkspaceFilePath()).toBe(
      path.join(state.tmpDir, '.tq', 'workspace.json'),
    );
  });
});

describe('loadWorkspace', () => {
  it('returns null when no file exists', () => {
    expect(loadWorkspace()).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const tqDir = path.join(state.tmpDir, '.tq');
    fs.mkdirSync(tqDir, { recursive: true });
    fs.writeFileSync(path.join(tqDir, 'workspace.json'), 'not-json');
    expect(loadWorkspace()).toBeNull();
  });

  it('returns null for missing workspace_id field', () => {
    const tqDir = path.join(state.tmpDir, '.tq');
    fs.mkdirSync(tqDir, { recursive: true });
    fs.writeFileSync(
      path.join(tqDir, 'workspace.json'),
      JSON.stringify({ other: 'field' }),
    );
    expect(loadWorkspace()).toBeNull();
  });
});

describe('saveWorkspace + loadWorkspace roundtrip', () => {
  it('saves and loads workspace_id correctly', () => {
    saveWorkspace('ws-123');
    const loaded = loadWorkspace();
    expect(loaded).toBe('ws-123');
  });

  it('creates ~/.tq directory if missing', () => {
    expect(fs.existsSync(path.join(state.tmpDir, '.tq'))).toBe(false);
    saveWorkspace('ws-123');
    expect(fs.existsSync(path.join(state.tmpDir, '.tq'))).toBe(true);
  });

  it('overwrites existing workspace', () => {
    saveWorkspace('ws-123');
    saveWorkspace('ws-456');
    const loaded = loadWorkspace();
    expect(loaded).toBe('ws-456');
  });

  it('uses atomic write (temp file + rename)', () => {
    saveWorkspace('ws-123');
    // Verify the temp file was cleaned up (renamed to final)
    const tmpFile = getWorkspaceFilePath() + '.tmp';
    expect(fs.existsSync(tmpFile)).toBe(false);
    expect(fs.existsSync(getWorkspaceFilePath())).toBe(true);
  });
});

describe('clearWorkspace', () => {
  it('removes the workspace file', () => {
    saveWorkspace('ws-123');
    expect(loadWorkspace()).toBe('ws-123');
    clearWorkspace();
    expect(loadWorkspace()).toBeNull();
  });

  it('does not throw when no file exists', () => {
    expect(() => clearWorkspace()).not.toThrow();
  });
});

describe('saveIdentityCache + loadIdentityCache roundtrip', () => {
  const sample = {
    workspace_id: 'ws-1',
    user_id: 'u-1',
    user_email: 'james@bitmodern.com',
    user_name: 'James Pitts',
    role: 'owner',
  };

  it('saves and loads all 5 fields', () => {
    saveIdentityCache(sample);
    expect(loadIdentityCache()).toEqual(sample);
  });

  it('overwrites prior identity cache', () => {
    saveIdentityCache(sample);
    saveIdentityCache({ ...sample, workspace_id: 'ws-2', role: 'admin' });
    expect(loadIdentityCache()).toEqual({
      ...sample,
      workspace_id: 'ws-2',
      role: 'admin',
    });
  });

  it('uses atomic write (temp file cleaned up)', () => {
    saveIdentityCache(sample);
    const tmpFile = getWorkspaceFilePath() + '.tmp';
    expect(fs.existsSync(tmpFile)).toBe(false);
    expect(fs.existsSync(getWorkspaceFilePath())).toBe(true);
  });

  it('saveWorkspace remains backward-compatible: still loads via loadWorkspace', () => {
    saveIdentityCache(sample);
    expect(loadWorkspace()).toBe('ws-1');
  });
});

describe('loadIdentityCache', () => {
  it('returns null when file does not exist', () => {
    expect(loadIdentityCache()).toBeNull();
  });

  it('returns null for legacy single-field shape (workspace_id only)', () => {
    saveWorkspace('ws-legacy');
    // saveWorkspace writes only { workspace_id } — identity fields missing
    expect(loadIdentityCache()).toBeNull();
  });

  it('returns null when any identity field is missing', () => {
    const tqDir = path.join(state.tmpDir, '.tq');
    fs.mkdirSync(tqDir, { recursive: true });
    fs.writeFileSync(
      path.join(tqDir, 'workspace.json'),
      JSON.stringify({
        workspace_id: 'ws-1',
        user_id: 'u-1',
        user_email: 'a@b.com',
        // user_name missing
        role: 'owner',
      }),
    );
    expect(loadIdentityCache()).toBeNull();
  });

  it('returns null when a field is present but not a string', () => {
    const tqDir = path.join(state.tmpDir, '.tq');
    fs.mkdirSync(tqDir, { recursive: true });
    fs.writeFileSync(
      path.join(tqDir, 'workspace.json'),
      JSON.stringify({
        workspace_id: 'ws-1',
        user_id: 'u-1',
        user_email: 'a@b.com',
        user_name: null,
        role: 'owner',
      }),
    );
    expect(loadIdentityCache()).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const tqDir = path.join(state.tmpDir, '.tq');
    fs.mkdirSync(tqDir, { recursive: true });
    fs.writeFileSync(path.join(tqDir, 'workspace.json'), 'not-json');
    expect(loadIdentityCache()).toBeNull();
  });

  it('returns null when the JSON root is an array (not an object)', () => {
    const tqDir = path.join(state.tmpDir, '.tq');
    fs.mkdirSync(tqDir, { recursive: true });
    fs.writeFileSync(
      path.join(tqDir, 'workspace.json'),
      JSON.stringify(['workspace_id', 'user_id', 'a@b.com', 'A', 'owner']),
    );
    expect(loadIdentityCache()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// internal — per-backend keying
// ---------------------------------------------------------------------------
//
// The file is keyed by backend URL, same key space as oauth-tokens.json. The
// load-bearing assertions are the NEGATIVE ones: an id saved against one
// backend must never be readable for another. Before this, a login against a
// local/worktree backend overwrote a single global slot, and the next
// `yarn setup:mcp` stamped that local id into a STAGING Workspace-Id header.

const STAGING = 'https://api.levr.now';
const WORKTREE = 'http://localhost:9780';

describe('per-backend keying', () => {
  it('does not return a worktree workspace id for staging', () => {
    saveWorkspace('ws-local', WORKTREE);
    expect(loadWorkspace(STAGING)).toBeNull();
  });

  it('does not return a staging workspace id for a worktree', () => {
    saveWorkspace('ws-staging', STAGING);
    expect(loadWorkspace(WORKTREE)).toBeNull();
  });

  it('keeps both backends independently readable', () => {
    saveWorkspace('ws-staging', STAGING);
    saveWorkspace('ws-local', WORKTREE);
    expect(loadWorkspace(STAGING)).toBe('ws-staging');
    expect(loadWorkspace(WORKTREE)).toBe('ws-local');
  });

  it('saving one backend does not clobber another', () => {
    saveWorkspace('ws-staging', STAGING);
    saveWorkspace('ws-local', WORKTREE);
    saveWorkspace('ws-staging-2', STAGING);
    expect(loadWorkspace(WORKTREE)).toBe('ws-local');
  });

  it('treats two worktrees on different ports as different backends', () => {
    saveWorkspace('ws-a', 'http://localhost:8180');
    saveWorkspace('ws-b', 'http://localhost:8580');
    expect(loadWorkspace('http://localhost:8180')).toBe('ws-a');
    expect(loadWorkspace('http://localhost:8580')).toBe('ws-b');
  });

  it('normalizes trailing slashes so one backend is one key', () => {
    saveWorkspace('ws-staging', `${STAGING}/`);
    expect(loadWorkspace(STAGING)).toBe('ws-staging');
  });

  it('saveWorkspace preserves the identity fields already cached for that backend', () => {
    saveIdentityCache(
      {
        workspace_id: 'ws-1',
        user_id: 'u-1',
        user_email: 'a@b.com',
        user_name: 'A',
        role: 'owner',
      },
      STAGING,
    );
    saveWorkspace('ws-2', STAGING);
    expect(loadIdentityCache(STAGING)).toEqual({
      workspace_id: 'ws-2',
      user_id: 'u-1',
      user_email: 'a@b.com',
      user_name: 'A',
      role: 'owner',
    });
  });

  it('scopes the identity cache per backend', () => {
    saveIdentityCache(
      {
        workspace_id: 'ws-1',
        user_id: 'u-1',
        user_email: 'a@b.com',
        user_name: 'A',
        role: 'owner',
      },
      STAGING,
    );
    expect(loadIdentityCache(WORKTREE)).toBeNull();
  });
});

describe('clearWorkspace is per-backend', () => {
  it('clears only the named backend', () => {
    saveWorkspace('ws-staging', STAGING);
    saveWorkspace('ws-local', WORKTREE);
    clearWorkspace(WORKTREE);
    expect(loadWorkspace(WORKTREE)).toBeNull();
    expect(loadWorkspace(STAGING)).toBe('ws-staging');
  });

  it('removes the file once the last backend is cleared', () => {
    saveWorkspace('ws-staging', STAGING);
    clearWorkspace(STAGING);
    expect(fs.existsSync(getWorkspaceFilePath())).toBe(false);
  });

  it('is a no-op for a backend with no entry', () => {
    saveWorkspace('ws-staging', STAGING);
    clearWorkspace(WORKTREE);
    expect(loadWorkspace(STAGING)).toBe('ws-staging');
  });
});

describe('legacy flat-file migration', () => {
  const legacy = {
    workspace_id: 'ws-legacy',
    user_id: 'u-1',
    user_email: 'a@b.com',
    user_name: 'A',
    role: 'owner',
  };

  function writeLegacy(): void {
    const tqDir = path.join(state.tmpDir, '.tq');
    fs.mkdirSync(tqDir, { recursive: true });
    fs.writeFileSync(
      path.join(tqDir, 'workspace.json'),
      JSON.stringify(legacy),
    );
  }

  it('attributes a legacy record to the configured backend and rewrites the file keyed', () => {
    writeLegacy();
    // No ~/.tq/config.json in the temp home, so the configured backend falls
    // back to staging — the same attribution readTokenMap() uses.
    expect(loadWorkspace(STAGING)).toBe('ws-legacy');

    const onDisk = JSON.parse(
      fs.readFileSync(getWorkspaceFilePath(), 'utf-8'),
    ) as Record<string, unknown>;
    // Exactly one url key — the record is attributed, not duplicated across
    // backends. The remaining top-level fields are the transitional mirror
    // (see the back-compat describe below), which old clients read.
    expect(Object.keys(onDisk).filter((k) => k.startsWith('http'))).toEqual([
      STAGING,
    ]);
    expect(onDisk[STAGING]).toEqual(legacy);
  });

  it('does not serve a migrated legacy record to a different backend', () => {
    writeLegacy();
    expect(loadWorkspace(WORKTREE)).toBeNull();
  });

  it('preserves the identity fields through migration', () => {
    writeLegacy();
    expect(loadIdentityCache(STAGING)).toEqual(legacy);
  });
});

// ---------------------------------------------------------------------------
// internal — transitional top-level mirror
// ---------------------------------------------------------------------------
//
// ~/.tq is machine-global but every checkout runs its own plugins/*/dist, and
// a worktree on a feature branch does not get this code until it merges main.
// An OLD reader that finds no `.workspace_id` falls through to
// ensureWorkspace(), whose old saveWorkspace() rewrites the file FLAT and
// wipes every other backend. The mirror keeps those readers resolving so they
// never reach that write.

/** Exactly what a pre-internal loadWorkspace() did. */
function readAsOldClient(): string | null {
  const raw = fs.readFileSync(getWorkspaceFilePath(), 'utf-8');
  const data = JSON.parse(raw) as { workspace_id?: string };
  return typeof data.workspace_id === 'string' ? data.workspace_id : null;
}

describe('back-compat mirror', () => {
  it('an old client still resolves the configured backend after a keyed write', () => {
    saveWorkspace('ws-staging', STAGING);
    expect(readAsOldClient()).toBe('ws-staging');
  });

  it('mirrors the CONFIGURED backend, not whichever was written last', () => {
    // No config.json in the temp home, so the configured backend is staging.
    saveWorkspace('ws-staging', STAGING);
    saveWorkspace('ws-local', WORKTREE);
    expect(readAsOldClient()).toBe('ws-staging');
  });

  it('mirrors the full identity, not just the id', () => {
    saveIdentityCache(
      {
        workspace_id: 'ws-1',
        user_id: 'u-1',
        user_email: 'a@b.com',
        user_name: 'A',
        role: 'owner',
      },
      STAGING,
    );
    const raw = JSON.parse(
      fs.readFileSync(getWorkspaceFilePath(), 'utf-8'),
    ) as Record<string, unknown>;
    expect(raw.user_email).toBe('a@b.com');
    expect(raw.role).toBe('owner');
  });

  it('keeps the url-keyed entries alongside the mirror', () => {
    saveWorkspace('ws-staging', STAGING);
    saveWorkspace('ws-local', WORKTREE);
    const raw = JSON.parse(
      fs.readFileSync(getWorkspaceFilePath(), 'utf-8'),
    ) as Record<string, { workspace_id?: string }>;
    expect(raw[STAGING].workspace_id).toBe('ws-staging');
    expect(raw[WORKTREE].workspace_id).toBe('ws-local');
  });

  it('writes NO mirror when the configured backend has no entry', () => {
    saveWorkspace('ws-local', WORKTREE);
    expect(readAsOldClient()).toBeNull();
  });

  it('does not treat a mirrored file as legacy on re-read (the collapse trap)', () => {
    // The legacy test must be "no url keys", never "has workspace_id" — a
    // current file has both, and reading it as legacy would collapse every
    // backend into the configured one.
    saveWorkspace('ws-staging', STAGING);
    saveWorkspace('ws-local', WORKTREE);
    expect(loadWorkspace(WORKTREE)).toBe('ws-local');
    expect(loadWorkspace(STAGING)).toBe('ws-staging');
  });

  it('survives repeated read-write cycles without collapsing backends', () => {
    saveWorkspace('ws-staging', STAGING);
    saveWorkspace('ws-local', WORKTREE);
    for (let i = 0; i < 3; i++) {
      loadWorkspace(STAGING);
      saveWorkspace(`ws-staging-${i}`, STAGING);
    }
    expect(loadWorkspace(WORKTREE)).toBe('ws-local');
  });

  it('the mirror never resurrects a cleared backend', () => {
    saveWorkspace('ws-staging', STAGING);
    clearWorkspace(STAGING);
    expect(fs.existsSync(getWorkspaceFilePath())).toBe(false);
  });

  it('drops the mirror when the configured backend is cleared but others remain', () => {
    saveWorkspace('ws-staging', STAGING);
    saveWorkspace('ws-local', WORKTREE);
    clearWorkspace(STAGING);
    expect(readAsOldClient()).toBeNull();
    expect(loadWorkspace(WORKTREE)).toBe('ws-local');
  });
});

// ---------------------------------------------------------------------------
// Code-review regressions (internal F-001, F-002, F-004, F-005)
// ---------------------------------------------------------------------------

function writeTqFile(name: string, body: unknown): void {
  const tqDir = path.join(state.tmpDir, '.tq');
  fs.mkdirSync(tqDir, { recursive: true });
  fs.writeFileSync(path.join(tqDir, name), JSON.stringify(body));
}

/**
 * Run `fn` with the test-env flags lifted, so `loadConfig()` uses its REAL
 * precedence. Both `config.json` (tier 2) and the stored token (tier 3) are
 * deliberately skipped under vitest for determinism (`config.ts:187,216`), so
 * without this the backend resolver always returns the staging default and
 * the F-001 regression is unreachable from a test.
 */
async function withProductionConfigResolution(
  fn: (mod: typeof import('./workspace-store.js')) => void,
): Promise<void> {
  const savedVitest = process.env.VITEST;
  const savedNodeEnv = process.env.NODE_ENV;
  delete process.env.VITEST;
  delete process.env.NODE_ENV;
  try {
    vi.resetModules();
    fn(await import('./workspace-store.js'));
  } finally {
    if (savedVitest !== undefined) process.env.VITEST = savedVitest;
    if (savedNodeEnv !== undefined) process.env.NODE_ENV = savedNodeEnv;
  }
}

describe('F-001 — the write key follows the backend callers actually use', () => {
  it('keys an unkeyed save to config.json, not to a hardcoded staging', async () => {
    writeTqFile('config.json', {
      environment: 'custom',
      apiUrl: WORKTREE,
      authUrl: WORKTREE,
      clientUrl: WORKTREE,
      oauthClientId: '2',
    });
    await withProductionConfigResolution((mod) => {
      mod.saveWorkspace('ws-local');
      expect(mod.loadWorkspace(WORKTREE)).toBe('ws-local');
      expect(mod.loadWorkspace(STAGING)).toBeNull();
    });
  });

  it('keys to the STORED TOKEN backend when config.json is absent', async () => {
    // The decisive tier. `getCurrentApiUrl()` (the old resolver) knows only
    // TQ_BACKEND_URL and config.json, so with neither it returned undefined
    // and the fallback guessed staging — filing a LOCAL id under the STAGING
    // key, which is internal reappearing through its own fix.
    writeTqFile('oauth-tokens.json', {
      [WORKTREE]: {
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: Date.now() + 3_600_000,
        apiBaseUrl: WORKTREE,
      },
    });
    await withProductionConfigResolution((mod) => {
      mod.saveWorkspace('ws-from-worktree');
      expect(mod.loadWorkspace(WORKTREE)).toBe('ws-from-worktree');
      expect(mod.loadWorkspace(STAGING)).toBeNull();
    });
  });
});

describe('F-002 — refreshMirror re-points the mirror after an env switch', () => {
  it('leaves an old client reading the NEW configured backend', async () => {
    const cfg = (apiUrl: string) => ({
      environment: 'custom',
      apiUrl,
      authUrl: apiUrl,
      clientUrl: apiUrl,
      oauthClientId: '2',
    });

    writeTqFile('config.json', cfg(WORKTREE));
    await withProductionConfigResolution((mod) => {
      mod.saveWorkspace('ws-local', WORKTREE);
      mod.saveWorkspace('ws-staging', STAGING);
      expect(readAsOldClient()).toBe('ws-local');
    });

    // `tq:env staging` — rewrites config.json and touches nothing else.
    writeTqFile('config.json', cfg(STAGING));
    await withProductionConfigResolution((mod) => {
      // Stale: the mirror still points at the backend we switched AWAY from,
      // so an old client would pin the wrong workspace. Before the file was
      // keyed, tq:env deleted it outright and they fell back to unpinned.
      expect(readAsOldClient()).toBe('ws-local');
      mod.refreshMirror();
      expect(readAsOldClient()).toBe('ws-staging');
      // ...and no keyed entry was disturbed.
      expect(mod.loadWorkspace(WORKTREE)).toBe('ws-local');
    });
  });

  it('is a no-op when no file exists', () => {
    expect(() => refreshMirror()).not.toThrow();
    expect(fs.existsSync(getWorkspaceFilePath())).toBe(false);
  });
});

describe('F-004 — the mirror never promotes a url-shaped field to an entry', () => {
  it('ignores a url-shaped field nested inside an entry', () => {
    writeTqFile('workspace.json', {
      [STAGING]: {
        workspace_id: 'ws-staging',
        [WORKTREE]: { workspace_id: 'ws-EVIL' },
      },
    });
    saveWorkspace('ws-staging-2', STAGING);
    expect(loadWorkspace(WORKTREE)).toBeNull();
    const raw = JSON.parse(
      fs.readFileSync(getWorkspaceFilePath(), 'utf-8'),
    ) as Record<string, unknown>;
    expect(raw[WORKTREE]).toBeUndefined();
  });

  it('mirrors only the five identity fields', () => {
    writeTqFile('workspace.json', {
      [STAGING]: { workspace_id: 'ws-1', junk: 'nope' },
    });
    saveWorkspace('ws-2', STAGING);
    const raw = JSON.parse(
      fs.readFileSync(getWorkspaceFilePath(), 'utf-8'),
    ) as Record<string, unknown>;
    expect(raw.junk).toBeUndefined();
    expect(raw.workspace_id).toBe('ws-2');
  });
});

describe('F-005 — write and read agree on what is a valid key', () => {
  it('does not silently lose a pin given a scheme-less backend url', () => {
    // Previously written to disk under a key every read then discarded — a
    // permanent, silent loss with no error anywhere.
    saveWorkspace('ws-x', 'localhost:8080');
    expect(loadWorkspace()).toBe('ws-x'); // landed on the configured backend
    expect(loadWorkspace(STAGING)).toBe('ws-x');
  });

  it('treats an empty backend url as "unspecified"', () => {
    saveWorkspace('ws-y', '');
    expect(loadWorkspace(STAGING)).toBe('ws-y');
  });
});
