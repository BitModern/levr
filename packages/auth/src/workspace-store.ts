/**
 * Disk-backed workspace/identity state at ~/.tq/workspace.json
 *
 * Stored as a map keyed by backend URL — the SAME key space as
 * ~/.tq/oauth-tokens.json (see token-store.ts):
 * {
 *   "https://api.levr.now":  { workspace_id, user_id, user_email, ... },
 *   "http://localhost:8180": { ... }
 * }
 *
 * internal: this file used to hold a SINGLE global record with no note of
 * which backend it came from. A login or `select_workspace` against a local
 * backend (including a worktree's own backend on its assigned port)
 * overwrote it machine-globally, and the next `yarn setup:mcp` stamped that
 * local workspace id into the `Workspace-Id` header of a STAGING levr URL.
 * Keying by backend URL makes that structurally impossible: a local id lives
 * under a different key than the staging one, so it cannot be read back for
 * a staging endpoint.
 *
 * Backward-compatible: a legacy flat file (`{ workspace_id, ... }` at the top
 * level) is attributed to the currently-configured backend and migrated
 * in-place on first read — the same treatment `readTokenMap()` gives legacy
 * token files. Attribution is a best guess by construction; that is
 * acceptable because this file is a hint-only cache (see `IdentityCache`) and
 * a wrong guess costs one workspace re-selection, not a security decision.
 *
 * Follows the same atomic-write pattern as token-store.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getTqDir } from './token-store.js';
import { loadConfig } from './config.js';

const WORKSPACE_FILE = 'workspace.json';

function getWorkspacePath(): string {
  return path.join(getTqDir(), WORKSPACE_FILE);
}

/**
 * Identity cache shape. All fields are required for a complete identity
 * record — partial entries are treated as a cache miss.
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

/** The full identity map: backend URL -> partial or complete identity. */
type IdentityMap = Record<string, Partial<IdentityCache>>;

/** The only fields an identity record — or the mirror — may carry. */
const IDENTITY_FIELDS: Array<keyof IdentityCache> = [
  'workspace_id',
  'user_id',
  'user_email',
  'user_name',
  'role',
];

function isIdentityKey(key: string): boolean {
  return /^https?:\/\//i.test(key);
}

/**
 * Strip trailing slashes and reject anything that is not an http(s) origin.
 *
 * This is the SINGLE gate both sides use: `resolveKey` will not write under a
 * key that `readIdentityMap` would later discard. Without that agreement a
 * scheme-less `apiBaseUrl` (`localhost:8080`) wrote an entry to disk that
 * every subsequent read dropped — a silent, permanent loss of the pin with no
 * error anywhere.
 */
function normalizeKey(url: string | undefined): string | undefined {
  const trimmed = url?.trim().replace(/\/+$/, '');
  if (!trimmed || !isIdentityKey(trimmed)) return undefined;
  return trimmed;
}

/**
 * The backend the UNKEYED callers actually talk to.
 *
 * This MUST be `loadConfig()`, not `getCurrentApiUrl()`. The two disagree:
 * `getCurrentApiUrl()` has two tiers (`TQ_BACKEND_URL` > `~/.tq/config.json`)
 * while `loadConfig()` has four, and its third is the STORED TOKEN's
 * `apiBaseUrl`. With no `config.json` but a token for a local backend, the
 * two-tier version returns undefined and the old fallback guessed `staging` —
 * filing a LOCAL workspace id under the STAGING key, which `setup-mcp` then
 * stamped into the staging `Workspace-Id` header. That is internal reappearing
 * through its own fix.
 *
 * Using the same resolver the callers use makes the key correct by
 * construction: whatever backend they are about to talk to is the backend the
 * record is filed under, including when that resolution itself ends at the
 * staging default.
 */
function configuredBackend(): string {
  return normalizeKey(loadConfig().apiUrl) ?? 'https://api.levr.now';
}

/**
 * Resolve which backend URL an identity read/write belongs to.
 *
 * An explicit argument (the caller knows its backend) wins; otherwise the
 * configured backend. Callers that know their backend SHOULD pass it.
 * `setup-mcp.ts` in particular must pass the URL it is about to write into
 * `.mcp.json`, which is not necessarily the configured one — the levr MCP
 * host differs from the API host (`https://ai.levr.now/api/v1/mcp` is served
 * by the backend at `https://api.levr.now`), and stdio MCP servers resolve
 * their own backend independently of whatever the levr HTTP entry points at.
 *
 * An explicit-but-malformed key is ignored rather than written, with a log —
 * silently retargeting it at another backend would be the very leak this
 * module exists to prevent.
 */
function resolveKey(apiBaseUrl?: string): string {
  if (apiBaseUrl !== undefined) {
    const explicit = normalizeKey(apiBaseUrl);
    if (explicit) return explicit;
    console.error(
      `[levr-auth] Ignoring malformed backend url "${apiBaseUrl}" — ` +
        'expected an http(s) origin. Falling back to the configured backend.',
    );
  }
  return configuredBackend();
}

/**
 * Read the raw identity map from disk.
 * Handles migration from the legacy single-record format.
 */
function readIdentityMap(): IdentityMap {
  try {
    const filePath = getWorkspacePath();
    if (!fs.existsSync(filePath)) return {};
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as Record<string, unknown>;

    // `typeof [] === 'object'` — explicitly reject arrays so property access
    // on a parsed JSON array (`[0]`, `[1]`...) cannot accidentally satisfy
    // the per-field checks in loadIdentityCache().
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return {};
    }

    // Keep only URL-shaped keys. This also strips the back-compat mirror
    // fields (see writeIdentityMap) so they can never be mistaken for a
    // backend entry.
    const map: IdentityMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!isIdentityKey(key)) continue;
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }
      map[key] = value as Partial<IdentityCache>;
    }

    // Legacy flat shape — `{ workspace_id, ... }` and NOT ONE url key. The
    // test is the ABSENCE of url keys, never the presence of `workspace_id`:
    // a current file carries BOTH (the mirror), and treating that as legacy
    // would collapse every backend's entry into one on the next read.
    if (Object.keys(map).length === 0 && 'workspace_id' in parsed) {
      const key = configuredBackend();
      const migrated: IdentityMap = { [key]: parsed as Partial<IdentityCache> };
      writeIdentityMap(migrated);
      return migrated;
    }

    return map;
  } catch (error) {
    console.error('[levr-auth] Failed to load workspace:', error);
    return {};
  }
}

/**
 * Atomically write the identity map to `~/.tq/workspace.json`.
 * Ensures the ~/.tq directory exists with 0o700, writes to `*.tmp` with
 * 0o600, then renames over the target. Errors are logged, never thrown.
 *
 * ## TRANSITIONAL: the top-level mirror
 *
 * Alongside the url-keyed entries we also write the CONFIGURED backend's
 * record at the top level, in the pre-internal flat shape:
 *
 * {
 *   "https://api.levr.now":  { workspace_id: "A", ... },
 *   "http://localhost:8180": { workspace_id: "B", ... },
 *   "workspace_id": "A", "user_id": ..., ...   <-- mirror of the configured one
 * }
 *
 * ~/.tq is machine-global but every checkout runs its OWN
 * `plugins/<name>/dist/index.js` (the `.mcp.json` entries use relative
 * paths, so each worktree loads its own build), and
 * a worktree on a feature branch does not get this code until that branch
 * merges main — days or weeks. Without the mirror, an old stdio server in
 * such a worktree reads `.workspace_id`, gets undefined, falls through to
 * `ensureWorkspace()`, and its old `saveWorkspace()` REWRITES THE WHOLE FILE
 * FLAT — wiping every other backend's entry. Main then re-migrates it, and
 * the two ping-pong for as long as any stale checkout is in use.
 *
 * The mirror keeps those old readers resolving, so they never reach the
 * read-fallthrough that ends in a flattening write.
 *
 * It does NOT stop an old WRITER, and that is not only the deliberate case
 * (`tq:workspace` in a stale checkout). Observed live: `yarn tq:login`
 * rewrites oauth-tokens.json, the running qinetic-mcp server's token watcher
 * fires, and `qinetic-mcp/src/auth.ts` calls `saveIdentityCache()`
 * unconditionally after re-auth — flattening the file two seconds after the
 * login wrote it, with no user action at all.
 *
 * Note what decides that: a long-lived process holds whatever `@levr-one/auth`
 * it imported AT STARTUP, so a freshly rebuilt `dist/` on disk changes
 * nothing until the server is restarted (`/mcp` reconnect). Checkout
 * freshness is necessary but not sufficient.
 *
 * This is survivable rather than fixed: the flat file still carries the
 * correct id for the configured backend, and the next read by new code
 * re-migrates it. What is lost each time is OTHER backends' entries — local
 * worktree pins, which re-derive on their own since those backends
 * auto-select their single seeded workspace. Nothing new code writes can
 * prevent an old writer from overwriting the file.
 *
 * REMOVE once every checkout has rebuilt against this version — the mirror is
 * only meaningful for one backend and is pure carrying cost after that.
 */
function writeIdentityMap(map: IdentityMap): void {
  try {
    const tqDir = getTqDir();
    if (!fs.existsSync(tqDir)) {
      fs.mkdirSync(tqDir, { recursive: true, mode: 0o700 });
    }

    const filePath = getWorkspacePath();
    const tempPath = filePath + '.tmp';

    // Mirror ONLY the five IdentityCache fields. Spreading the entry wholesale
    // promoted any url-shaped field INSIDE it to a top-level entry, where the
    // next read would serve it as that backend's record — a hand-edited or
    // corrupted file could put an arbitrary workspace id under an arbitrary
    // backend.
    const mirrored = map[configuredBackend()];
    const payload: Record<string, unknown> = { ...map };
    if (mirrored) {
      for (const field of IDENTITY_FIELDS) {
        if (typeof mirrored[field] === 'string')
          payload[field] = mirrored[field];
      }
    }

    fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    console.error('[levr-auth] Failed to write workspace.json:', error);
  }
}

/**
 * Load the persisted workspace ID for a backend.
 *
 * @param apiBaseUrl Backend the id must belong to. Defaults to the currently
 *   configured backend — correct for stdio MCP servers and the CLI, which
 *   talk to whatever `~/.tq/config.json` points at.
 * @returns workspace_id, or null when this backend has no entry
 */
export function loadWorkspace(apiBaseUrl?: string): string | null {
  const entry = readIdentityMap()[resolveKey(apiBaseUrl)];
  const id = entry?.workspace_id;
  return typeof id === 'string' && id ? id : null;
}

/**
 * Save a workspace ID against a backend, leaving every other backend's entry
 * intact. Preserves any identity fields already cached for that backend.
 */
export function saveWorkspace(workspaceId: string, apiBaseUrl?: string): void {
  const map = readIdentityMap();
  const key = resolveKey(apiBaseUrl);
  map[key] = { ...map[key], workspace_id: workspaceId };
  writeIdentityMap(map);
}

/**
 * Load the full identity cache for a backend.
 *
 * Returns a typed `IdentityCache` only when all five fields are present and
 * are strings. Returns `null` for a missing file, malformed JSON, a backend
 * with no entry, a workspace-id-only entry, or any field that is not a
 * string.
 *
 * Never throws — graceful degradation is mandatory because callers wire this
 * into startup paths and watcher callbacks.
 */
export function loadIdentityCache(apiBaseUrl?: string): IdentityCache | null {
  const entry = readIdentityMap()[resolveKey(apiBaseUrl)];
  if (!entry) return null;

  const keys: Array<keyof IdentityCache> = [
    'workspace_id',
    'user_id',
    'user_email',
    'user_name',
    'role',
  ];
  for (const key of keys) {
    if (typeof entry[key] !== 'string') return null;
  }

  return {
    workspace_id: entry.workspace_id as string,
    user_id: entry.user_id as string,
    user_email: entry.user_email as string,
    user_name: entry.user_name as string,
    role: entry.role as string,
  };
}

/**
 * Save the full identity cache for a backend with an atomic write, leaving
 * every other backend's entry intact.
 */
export function saveIdentityCache(
  data: IdentityCache,
  apiBaseUrl?: string,
): void {
  const map = readIdentityMap();
  map[resolveKey(apiBaseUrl)] = {
    workspace_id: data.workspace_id,
    user_id: data.user_id,
    user_email: data.user_email,
    user_name: data.user_name,
    role: data.role,
  };
  writeIdentityMap(map);
}

/**
 * Clear the persisted identity for ONE backend (e.g. on logout).
 *
 * Mirrors `clearTokens()`: only the current backend's entry is removed, and
 * the file is deleted outright once the last entry is gone. An env switch
 * must NOT call this — under URL keying, switching environments already
 * selects a different entry, and clearing would throw away a still-valid
 * workspace pin the user would have to re-select.
 */
export function clearWorkspace(apiBaseUrl?: string): void {
  try {
    const filePath = getWorkspacePath();
    if (!fs.existsSync(filePath)) return;

    const map = readIdentityMap();
    const key = resolveKey(apiBaseUrl);
    if (!(key in map)) return;

    delete map[key];
    if (Object.keys(map).length === 0) {
      fs.unlinkSync(filePath);
    } else {
      writeIdentityMap(map);
    }
  } catch (error) {
    console.error('[levr-auth] Failed to clear workspace:', error);
  }
}

/**
 * Re-point the transitional top-level mirror at the CURRENTLY configured
 * backend, without touching any keyed entry. Call this after changing which
 * backend is configured (`tq:env`).
 *
 * The mirror is only recomputed on write, and an env switch writes nothing —
 * so without this the mirror keeps pointing at the PREVIOUS backend and an
 * old (pre-internal) client reads a pin for a backend it is no longer talking
 * to. That is strictly worse than what it replaced: before the file was
 * keyed, `tq:env` deleted the whole file, so an old client got nothing and
 * fell back to unpinned. Failing to unpinned is safe; failing to another
 * backend's workspace is not.
 *
 * No-op when the file does not exist. Remove alongside the mirror itself.
 */
export function refreshMirror(): void {
  if (!fs.existsSync(getWorkspacePath())) return;
  writeIdentityMap(readIdentityMap());
}

/**
 * Get workspace file path (for debugging)
 */
export function getWorkspaceFilePath(): string {
  return getWorkspacePath();
}
