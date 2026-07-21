import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We test the functions by temporarily overriding homedir.
// Since workspace-store uses homedir() at module load, we mock it.
import { vi } from 'vitest';

let testDir: string;

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => testDir,
  };
});

// Re-import after mock
let loadWorkspace: typeof import('./workspace-store.js').loadWorkspace;
let saveWorkspace: typeof import('./workspace-store.js').saveWorkspace;
let clearWorkspace: typeof import('./workspace-store.js').clearWorkspace;
let getWorkspacePath: typeof import('./workspace-store.js').getWorkspacePath;

beforeEach(async () => {
  testDir = join(tmpdir(), `levr-ws-test-${Date.now()}`);
  mkdirSync(join(testDir, '.config', 'levr'), { recursive: true });

  // Re-import to pick up new testDir
  vi.resetModules();
  const mod = await import('./workspace-store.js');
  loadWorkspace = mod.loadWorkspace;
  saveWorkspace = mod.saveWorkspace;
  clearWorkspace = mod.clearWorkspace;
  getWorkspacePath = mod.getWorkspacePath;
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

describe('workspace-store', () => {
  describe('getWorkspacePath', () => {
    it('returns path under .config/levr', () => {
      const p = getWorkspacePath();
      expect(p).toContain('.config');
      expect(p).toContain('levr');
      expect(p).toContain('workspace.json');
    });
  });

  describe('loadWorkspace', () => {
    it('returns null when file does not exist', () => {
      expect(loadWorkspace()).toBeNull();
    });

    it('returns workspace_id from valid file', () => {
      const p = getWorkspacePath();
      writeFileSync(p, JSON.stringify({ workspace_id: 'ws-abc' }));
      expect(loadWorkspace()).toBe('ws-abc');
    });

    it('returns null for corrupt JSON', () => {
      const p = getWorkspacePath();
      writeFileSync(p, 'not json');
      expect(loadWorkspace()).toBeNull();
    });

    it('returns null when workspace_id is not a string', () => {
      const p = getWorkspacePath();
      writeFileSync(p, JSON.stringify({ workspace_id: 123 }));
      expect(loadWorkspace()).toBeNull();
    });
  });

  describe('saveWorkspace', () => {
    it('writes workspace_id to disk with correct content', () => {
      saveWorkspace('ws-xyz');
      const p = getWorkspacePath();
      const raw = readFileSync(p, 'utf8');
      const data = JSON.parse(raw) as { workspace_id: string };
      expect(data.workspace_id).toBe('ws-xyz');
    });

    it('creates directory if missing', () => {
      rmSync(testDir, { recursive: true, force: true });
      saveWorkspace('ws-new');
      const p = getWorkspacePath();
      expect(existsSync(p)).toBe(true);
    });
  });

  describe('clearWorkspace', () => {
    it('removes workspace file', () => {
      saveWorkspace('ws-del');
      const p = getWorkspacePath();
      expect(existsSync(p)).toBe(true);
      clearWorkspace();
      expect(existsSync(p)).toBe(false);
    });

    it('does not throw when file does not exist', () => {
      expect(() => clearWorkspace()).not.toThrow();
    });
  });
});
