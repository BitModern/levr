/**
 * @levr-one/auth - Shared OAuth 2.1 client with self-healing token management
 *
 * This package provides:
 * - OAuthClient: OAuth 2.1 with PKCE for authorization flow
 * - TokenWatcher: Self-healing token file watching
 * - Token storage utilities with atomic writes
 *
 * Usage in MCP servers:
 *
 * ```typescript
 * import { OAuthClient, TokenWatcher } from '@levr-one/auth';
 *
 * // Initialize OAuth client
 * const oauth = new OAuthClient({ clientId: 'my-client' });
 *
 * // Start token watcher for self-healing
 * const watcher = new TokenWatcher();
 * watcher.onTokenChange((tokens) => {
 *   if (tokens) {
 *     oauth.setTokensFromStorage(tokens);
 *   }
 * });
 * watcher.start();
 * ```
 */

// Types
export type {
  TokenResponse,
  StoredTokens,
  OAuthConfig,
  AuthStatus,
  TokenChangeCallback,
  DeviceAuthorizationResponse,
} from './types.js';

// Token storage (with atomic writes, map keyed by backend URL)
export {
  loadTokens,
  loadTokensForEnv,
  loadTokensForUrl,
  saveTokens,
  saveTokensForEnv,
  clearTokens,
  restoreTokensFromBackup,
  hasStoredTokens,
  getTokenFilePath,
  getTqDir,
  resolveEnvFromUrl,
  resolveUrlFromEnv,
} from './token-store.js';
export type { EnvName } from './token-store.js';

// Workspace storage
export {
  loadWorkspace,
  saveWorkspace,
  clearWorkspace,
  getWorkspaceFilePath,
  loadIdentityCache,
  saveIdentityCache,
} from './workspace-store.js';
export type { IdentityCache } from './workspace-store.js';

// Unified environment config
export {
  loadConfig,
  writeConfig,
  getConfigFilePath,
  resolveFromApiUrl,
  PRESETS,
} from './config.js';
export type { TqConfig } from './config.js';

// OAuth client
export { OAuthClient } from './oauth-client.js';

// Workspace listing (public library surface)
export { listWorkspaces, WorkspaceFetchError } from './workspaces.js';
export type { WorkspaceSite, WorkspaceFetchErrorCode } from './workspaces.js';

// File lock (cross-process refresh coordination)
export { acquireFileLock, getLockPath } from './file-lock.js';
export type { FileLockHandle } from './file-lock.js';

// Token watcher (self-healing core)
export { TokenWatcher } from './token-watcher.js';
export type { TokenWatcherOptions } from './token-watcher.js';

// Config watcher (environment change detection)
export { ConfigWatcher } from './config-watcher.js';
export type {
  ConfigWatcherOptions,
  ConfigChangeCallback,
} from './config-watcher.js';
