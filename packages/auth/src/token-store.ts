/**
 * Secure token storage for OAuth tokens
 *
 * Stores tokens in ~/.tq/oauth-tokens.json as a map keyed by backend URL:
 * {
 *   "https://api.levr.now": { accessToken, refreshToken, expiresAt, apiBaseUrl },
 *   "http://localhost:8080": { ... }
 * }
 *
 * Backward-compatible: if the file contains the legacy single-token format
 * (flat object with accessToken at the top level), it is migrated in-place
 * to the new map format on first read.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { StoredTokens } from './types.js';

export type EnvName = 'local' | 'staging' | 'production';

/**
 * Token storage directory and file path
 */
const TQ_DIR = path.join(os.homedir(), '.tq');
const TOKEN_FILE = path.join(TQ_DIR, 'oauth-tokens.json');

/**
 * Map of environment names to their backend URLs.
 */
// internal D15: unified levr.* origins. Legacy testquality.* URLs are
// retired during the DEC-11 7-day window; tokens minted under the
// legacy URLs are migrated by the legacy-key fallback in readTokenMap()
// (the apiBaseUrl on the StoredTokens itself was set when the token
// was originally issued, so old token files keep working transparently).
const ENV_URLS: Record<EnvName, string> = {
  local: 'http://localhost:8080',
  staging: 'https://api.levr.now',
  production: 'https://api.levr.one',
};

/** The full token map: backend URL -> StoredTokens */
type TokenMap = Record<string, StoredTokens>;

/**
 * Resolve an environment name from a backend URL.
 * Returns undefined if the URL doesn't match any known preset.
 */
export function resolveEnvFromUrl(url: string): EnvName | undefined {
  const normalized = url.replace(/\/+$/, '');
  for (const [env, envUrl] of Object.entries(ENV_URLS)) {
    if (envUrl === normalized) return env as EnvName;
  }
  return undefined;
}

/**
 * Resolve a backend URL from an environment name.
 */
export function resolveUrlFromEnv(env: EnvName): string {
  return ENV_URLS[env];
}

// ---------------------------------------------------------------------------
// Internal: read/write the token map
// ---------------------------------------------------------------------------

/**
 * Read the raw token map from disk.
 * Handles migration from legacy single-token format.
 */
function readTokenMap(): TokenMap {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return {};
    const content = fs.readFileSync(TOKEN_FILE, 'utf-8');
    const parsed = JSON.parse(content) as Record<string, unknown>;

    // Detect legacy single-token format (has accessToken at top level)
    if ('accessToken' in parsed && 'refreshToken' in parsed) {
      const legacy = parsed as unknown as StoredTokens;
      const key = legacy.apiBaseUrl ?? 'https://api.levr.now';
      const map: TokenMap = { [key]: legacy };
      // Migrate in place
      writeTokenMap(map);
      return map;
    }

    return parsed as unknown as TokenMap;
  } catch (error) {
    console.error('[tq-oauth] Failed to load stored tokens:', error);
    return {};
  }
}

/**
 * Write the full token map to disk with atomic write.
 */
function writeTokenMap(map: TokenMap): void {
  if (!fs.existsSync(TQ_DIR)) {
    fs.mkdirSync(TQ_DIR, { recursive: true, mode: 0o700 });
  }
  const tempPath = TOKEN_FILE + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(map, null, 2), {
    mode: 0o600,
  });
  fs.renameSync(tempPath, TOKEN_FILE);
}

function isValidToken(t: unknown): t is StoredTokens {
  const obj = t as Record<string, unknown>;
  return !!(obj?.accessToken && obj?.refreshToken && obj?.expiresAt);
}

// ---------------------------------------------------------------------------
// Public API — drop-in compatible with the old single-token interface
// ---------------------------------------------------------------------------

/**
 * Load the token for the current environment.
 * Reads the config to determine which backend URL is active,
 * then returns the matching entry from the token map.
 *
 * Falls back to first token in the map ONLY when no config exists
 * (backward compat for first-time migration). When the user has
 * explicitly set an environment, only that environment's token is returned.
 */
export function loadTokens(): StoredTokens | null {
  const map = readTokenMap();
  const keys = Object.keys(map);
  if (keys.length === 0) return null;

  // Try to match the current environment
  const currentUrl = getCurrentApiUrl();
  if (currentUrl) {
    const entry = map[currentUrl];
    if (entry && isValidToken(entry)) return entry;
    // Config is set but no token for this env — don't fall back
    return null;
  }

  // No config at all — fall back to first valid entry (backward compat)
  for (const key of keys) {
    if (isValidToken(map[key])) return map[key];
  }
  return null;
}

/**
 * Load tokens for a specific environment by name.
 */
export function loadTokensForEnv(env: EnvName): StoredTokens | null {
  const map = readTokenMap();
  const url = ENV_URLS[env];
  const entry = map[url];
  if (entry && isValidToken(entry)) return entry;
  return null;
}

/**
 * Load tokens for an arbitrary backend URL (custom URL not in ENV_URLS).
 *
 * Used by the qinetic sync setup command, which needs to talk to a remote
 * backend that may not be one of the named presets — the operator passes
 * `--target <url>` and the CLI fetches the matching token entry by URL.
 */
export function loadTokensForUrl(url: string): StoredTokens | null {
  const map = readTokenMap();
  const normalized = url.replace(/\/$/, '');
  // Try exact match first, then trailing-slash variant.
  const entry = map[url] ?? map[normalized] ?? map[`${normalized}/`];
  if (entry && isValidToken(entry)) return entry;
  return null;
}

/**
 * Save tokens for the current environment.
 * Upserts the entry keyed by the token's apiBaseUrl.
 */
export function saveTokens(tokens: StoredTokens): void {
  try {
    const map = readTokenMap();
    const key = tokens.apiBaseUrl ?? getCurrentApiUrl() ?? ENV_URLS.staging;
    map[key] = tokens;
    writeTokenMap(map);
  } catch (error) {
    console.error('[tq-oauth] Failed to save tokens:', error);
    throw error;
  }
}

/**
 * Save tokens for a specific environment by name.
 */
export function saveTokensForEnv(env: EnvName, tokens: StoredTokens): void {
  const map = readTokenMap();
  map[ENV_URLS[env]] = tokens;
  writeTokenMap(map);
}

/**
 * Clear stored tokens for the current environment.
 * Moves the entire file to .bak before removing the entry.
 */
export function clearTokens(): void {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return;

    // Backup entire file before modifying
    const backupPath = TOKEN_FILE + '.bak';
    try {
      fs.copyFileSync(TOKEN_FILE, backupPath);
      fs.chmodSync(backupPath, 0o600);
    } catch {
      // Backup failed — still proceed with clear
    }

    const map = readTokenMap();
    const currentUrl = getCurrentApiUrl();
    if (currentUrl && map[currentUrl]) {
      delete map[currentUrl];
      if (Object.keys(map).length === 0) {
        fs.unlinkSync(TOKEN_FILE);
      } else {
        writeTokenMap(map);
      }
    } else if (!currentUrl) {
      // No current URL known — clear entire file (legacy behavior)
      fs.unlinkSync(TOKEN_FILE);
    }
  } catch (error) {
    console.error('[tq-oauth] Failed to clear tokens:', error);
  }
}

/**
 * Attempt to restore tokens from backup (.bak file)
 * Returns true if backup was restored successfully.
 */
export function restoreTokensFromBackup(): boolean {
  const backupPath = TOKEN_FILE + '.bak';
  try {
    if (fs.existsSync(backupPath) && !fs.existsSync(TOKEN_FILE)) {
      const content = fs.readFileSync(backupPath, 'utf-8');
      const parsed = JSON.parse(content) as TokenMap | StoredTokens;

      // Handle both legacy and map format in backup
      if ('accessToken' in parsed && (parsed as StoredTokens).refreshToken) {
        const legacy = parsed as StoredTokens;
        const key = legacy.apiBaseUrl ?? ENV_URLS.staging;
        writeTokenMap({ [key]: legacy });
        console.error(
          '[tq-oauth] Restored tokens from backup — refresh token recovered',
        );
        return true;
      }

      // Map format — write as-is if it has any entry with a refresh token
      const map = parsed as TokenMap;
      const hasRefresh = Object.values(map).some((t) => t.refreshToken);
      if (hasRefresh) {
        writeTokenMap(map);
        console.error(
          '[tq-oauth] Restored tokens from backup — refresh token recovered',
        );
        return true;
      }
    }
  } catch (error) {
    console.error('[tq-oauth] Failed to restore tokens from backup:', error);
  }
  return false;
}

/**
 * Check if token file exists and has any entries
 */
export function hasStoredTokens(): boolean {
  if (!fs.existsSync(TOKEN_FILE)) return false;
  const map = readTokenMap();
  return Object.keys(map).length > 0;
}

/**
 * Get token file path (for debugging and watching)
 */
export function getTokenFilePath(): string {
  return TOKEN_FILE;
}

/**
 * Get TQ directory path
 */
export function getTqDir(): string {
  return TQ_DIR;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read the current API URL from ~/.tq/config.json without importing
 * config.ts (avoids circular dependency since config.ts imports us).
 */
function getCurrentApiUrl(): string | undefined {
  try {
    // Env var takes precedence
    if (process.env.TQ_BACKEND_URL) {
      return process.env.TQ_BACKEND_URL.replace(/\/+$/, '');
    }
    const configPath = path.join(TQ_DIR, 'config.json');
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
        apiUrl?: string;
      };
      if (raw.apiUrl) return raw.apiUrl.replace(/\/+$/, '');
    }
  } catch {
    // Fall through
  }
  return undefined;
}
