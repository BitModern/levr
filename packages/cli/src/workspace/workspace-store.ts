import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  renameSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const WORKSPACE_DIR = join(homedir(), '.config', 'levr');
const WORKSPACE_PATH = join(WORKSPACE_DIR, 'workspace.json');

export function getWorkspacePath(): string {
  return WORKSPACE_PATH;
}

export function loadWorkspace(): string | null {
  try {
    const raw = readFileSync(WORKSPACE_PATH, 'utf8');
    const data = JSON.parse(raw) as { workspace_id?: string };
    return typeof data.workspace_id === 'string' ? data.workspace_id : null;
  } catch {
    return null;
  }
}

export function saveWorkspace(workspaceId: string): void {
  mkdirSync(dirname(WORKSPACE_PATH), { recursive: true });
  const tmp = WORKSPACE_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify({ workspace_id: workspaceId }, null, 2), {
    mode: 0o600,
  });
  renameSync(tmp, WORKSPACE_PATH);
}

export function clearWorkspace(): void {
  try {
    unlinkSync(WORKSPACE_PATH);
  } catch {
    /* no-op */
  }
}
