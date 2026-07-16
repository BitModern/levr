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
let saveIdentityCache: typeof import('./workspace-store.js').saveIdentityCache;

beforeEach(async () => {
  state.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tq-ws-test-'));
  vi.resetModules();
  const mod = await import('./workspace-store.js');
  loadWorkspace = mod.loadWorkspace;
  saveWorkspace = mod.saveWorkspace;
  clearWorkspace = mod.clearWorkspace;
  getWorkspaceFilePath = mod.getWorkspaceFilePath;
  loadIdentityCache = mod.loadIdentityCache;
  saveIdentityCache = mod.saveIdentityCache;
});

afterEach(() => {
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
