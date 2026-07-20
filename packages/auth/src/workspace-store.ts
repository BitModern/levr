/**
 * Disk-backed workspace state at ~/.tq/workspace.json
 * Follows the same atomic-write pattern as token-store.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { getTqDir } from './token-store.js';

const WORKSPACE_FILE = 'workspace.json';

function getWorkspacePath(): string {
  return path.join(getTqDir(), WORKSPACE_FILE);
}

/**
 * Atomically write `payload` as JSON to `~/.tq/workspace.json`.
 * Ensures the ~/.tq directory exists with 0o700, writes to `*.tmp` with
 * 0o600, then renames over the target. Errors are logged, never thrown.
 */
function writeWorkspaceJsonAtomic(payload: object): void {
  try {
    const tqDir = getTqDir();
    if (!fs.existsSync(tqDir)) {
      fs.mkdirSync(tqDir, { recursive: true, mode: 0o700 });
    }

    const filePath = getWorkspacePath();
    const tempPath = filePath + '.tmp';

    fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), {
      mode: 0o600,
    });

    fs.renameSync(tempPath, filePath);
  } catch (error) {
    console.error('[levr-auth] Failed to write workspace.json:', error);
  }
}

/**
 * Identity cache shape. Persisted to ~/.tq/workspace.json alongside the
 * existing { workspace_id } single field. All fields are required for a
 * complete identity record — partial files are treated as a cache miss.
 *
 * Cache is hint-only: it is consumed for MCP `instructions` and for
 * `get_context` display. It MUST NOT be used in any security check.
 */
export interface IdentityCache {
  workspace_id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  role: string;
}

/**
 * Load persisted workspace ID from disk
 * @returns workspace_id or null if missing/corrupt
 */
export function loadWorkspace(): string | null {
  try {
    const filePath = getWorkspacePath();
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content) as { workspace_id?: string };
      if (data.workspace_id && typeof data.workspace_id === 'string') {
        return data.workspace_id;
      }
    }
  } catch (error) {
    console.error('[levr-auth] Failed to load workspace:', error);
  }
  return null;
}

/**
 * Save workspace ID to disk with atomic write
 */
export function saveWorkspace(workspaceId: string): void {
  writeWorkspaceJsonAtomic({ workspace_id: workspaceId });
}

/**
 * Load the full identity cache from disk.
 *
 * Reads ~/.tq/workspace.json and returns a typed `IdentityCache` only when
 * all five required fields are present and are strings. Returns `null` for:
 *  - missing file
 *  - malformed JSON
 *  - legacy single-field shape (`{ workspace_id }` only)
 *  - any field present but not a string
 *
 * Never throws — graceful degradation is mandatory because callers wire this
 * into startup paths and watcher callbacks.
 */
export function loadIdentityCache(): IdentityCache | null {
  try {
    const filePath = getWorkspacePath();
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content) as Record<string, unknown>;
    // `typeof [] === 'object'` — explicitly reject arrays so property
    // access on a parsed JSON array (`[0]`, `[1]`...) cannot accidentally
    // satisfy the per-field checks below.
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return null;
    }

    const keys: Array<keyof IdentityCache> = [
      'workspace_id',
      'user_id',
      'user_email',
      'user_name',
      'role',
    ];
    for (const key of keys) {
      const value = data[key];
      if (typeof value !== 'string') return null;
    }

    return {
      workspace_id: data.workspace_id as string,
      user_id: data.user_id as string,
      user_email: data.user_email as string,
      user_name: data.user_name as string,
      role: data.role as string,
    };
  } catch {
    return null;
  }
}

/**
 * Save the full identity cache to disk with atomic write.
 *
 * Single writer pattern: `saveWorkspace` writes only `{ workspace_id }`;
 * `saveIdentityCache` is the only path that writes the five-field shape.
 * After the first identity-aware save, the file always contains all five
 * fields. Same `.tmp` + `renameSync` pattern as `saveWorkspace`.
 */
export function saveIdentityCache(data: IdentityCache): void {
  writeWorkspaceJsonAtomic({
    workspace_id: data.workspace_id,
    user_id: data.user_id,
    user_email: data.user_email,
    user_name: data.user_name,
    role: data.role,
  });
}

/**
 * Clear persisted workspace (e.g. on env switch or login)
 */
export function clearWorkspace(): void {
  try {
    const filePath = getWorkspacePath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error('[levr-auth] Failed to clear workspace:', error);
  }
}

/**
 * Get workspace file path (for debugging)
 */
export function getWorkspaceFilePath(): string {
  return getWorkspacePath();
}
