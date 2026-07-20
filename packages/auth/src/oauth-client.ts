/**
 * OAuth 2.0 client for TQ MCP servers
 * Implements authorization code flow with PKCE (RFC 7636)
 */

import * as crypto from 'crypto';
import * as http from 'http';
import { URL } from 'url';
import {
  loadTokens,
  saveTokens,
  clearTokens,
  restoreTokensFromBackup,
} from './token-store.js';
import { acquireFileLock, getLockPath } from './file-lock.js';
import { saveWorkspace, clearWorkspace } from './workspace-store.js';
import { loadConfig } from './config.js';
import type {
  TokenResponse,
  OAuthConfig,
  StoredTokens,
  DeviceAuthorizationResponse,
} from './types.js';

/**
 * OAuth 2.0 client with PKCE support
 */
/**
 * Number of consecutive 400/401 refresh failures before clearing tokens.
 * A single transient backend error (restart, DB hiccup) returns 400 but the
 * refresh token may still be valid. Only clear after repeated failures.
 */
const CLEAR_TOKENS_AFTER_FAILURES = 3;

export class OAuthClient {
  private config: OAuthConfig;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private expiresAt: number = 0;
  private consecutiveRefreshFailures: number = 0;
  /**
   * Set when refresh is definitively rejected (400/401).
   * Prevents further network refresh attempts until re-authorization
   * or fresh tokens are loaded via setTokensFromStorage/authorize.
   */
  private refreshRejected: boolean = false;
  /**
   * Deduplicates concurrent refresh calls. When multiple callers invoke
   * refresh() simultaneously (e.g., parallel MCP tool requests), they
   * all await the same in-flight promise instead of each firing a
   * separate token rotation request — which would cause the second
   * request to fail with invalid_grant (token already revoked by first).
   */
  private refreshPromise: Promise<void> | null = null;

  constructor(config: Partial<OAuthConfig> & { clientId: string }) {
    // Resolve defaults from unified config (staging default)
    const tqConfig = loadConfig();
    const defaults: Partial<OAuthConfig> = {
      authServerUrl: tqConfig.apiUrl,
      redirectPort: 6274,
      scopes: ['read:own', 'write:own'],
    };

    this.config = {
      ...defaults,
      ...config,
    } as OAuthConfig;

    // Try to load stored tokens on initialization
    this.loadStoredTokens();
  }

  /**
   * Load tokens from persistent storage
   */
  private loadStoredTokens(): void {
    const stored = loadTokens();
    if (stored) {
      this.accessToken = stored.accessToken;
      this.refreshToken = stored.refreshToken;
      this.expiresAt = stored.expiresAt;
    }
  }

  /**
   * Set tokens from external storage (used during initialization)
   */
  setTokensFromStorage(tokens: StoredTokens): void {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    this.expiresAt = tokens.expiresAt;
    // Fresh tokens from external source clear the rejection flag
    this.refreshRejected = false;
  }

  /**
   * Generate PKCE code verifier and challenge
   * @see https://datatracker.ietf.org/doc/html/rfc7636
   */
  private generatePKCE(): { verifier: string; challenge: string } {
    // Code verifier: 43-128 character random string
    const verifier = crypto.randomBytes(32).toString('base64url');

    // Code challenge: base64url(SHA256(verifier))
    const challenge = crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64url');

    return { verifier, challenge };
  }

  /**
   * Start local HTTP server to receive OAuth callback
   */
  private async waitForCallback(
    port: number,
    expectedState: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url!, `http://localhost:${port}`);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        const state = url.searchParams.get('state');

        // Validate state parameter to prevent CSRF
        if (state !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>Authorization Failed</h1>
                <p>Invalid state parameter. This may be a security issue.</p>
              </body>
            </html>
          `);
          server.close();
          reject(new Error('Invalid state parameter'));
          return;
        }

        if (error) {
          const errorDescription = url.searchParams.get('error_description');
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>Authorization Failed</h1>
                <p>${errorDescription || error}</p>
              </body>
            </html>
          `);
          server.close();
          reject(new Error(errorDescription || error));
          return;
        }

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>Authorization Successful!</h1>
                <p>You can close this window and return to your terminal.</p>
                <script>setTimeout(() => window.close(), 2000);</script>
              </body>
            </html>
          `);
          server.close();
          resolve(code);
          return;
        }

        // Unknown request
        res.writeHead(404);
        res.end('Not found');
      });

      server.listen(port, () => {
        console.log(
          `[levr-auth] OAuth callback server listening on port ${port}`,
        );
      });

      // Timeout after 2 minutes
      const timeout = setTimeout(() => {
        server.close();
        reject(new Error('Authorization timeout - no response received'));
      }, 120000);

      server.on('close', () => {
        clearTimeout(timeout);
      });
    });
  }

  /**
   * Perform full OAuth authorization flow
   * Opens browser for user to authorize, waits for callback
   */
  async authorize(): Promise<void> {
    const { verifier, challenge } = this.generatePKCE();
    const state = crypto.randomBytes(16).toString('hex');
    const redirectUri = `http://localhost:${this.config.redirectPort}/oauth/callback`;

    // Build authorization URL (uses versioned API route)
    const authUrl = new URL('/v1/oauth/authorize', this.config.authServerUrl);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', this.config.clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', this.config.scopes.join(' '));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    // Open browser for user authorization
    console.log('[levr-auth] Opening browser for authorization...');
    console.log(
      `[levr-auth] If browser doesn't open, visit: ${authUrl.toString()}`,
    );

    // Dynamic import of 'open' package (ESM)
    // unref() the child process so it doesn't keep the event loop alive
    const open = (await import('open')).default;
    const cp = await open(authUrl.toString());
    cp.unref();

    // Wait for callback with authorization code
    const code = await this.waitForCallback(this.config.redirectPort, state);

    // Exchange code for tokens
    await this.exchangeCode(code, verifier, redirectUri);

    // Fresh authorization clears any prior rejection
    this.refreshRejected = false;
    console.log('[levr-auth] Authorization successful!');
  }

  /**
   * Perform OAuth 2.0 Device Authorization Grant (RFC 8628).
   * Works in headless/remote terminals — no browser redirect needed.
   * Displays a URL and code for the user to authorize on any device.
   */
  async authorizeDevice(): Promise<void> {
    // 1. Request device code
    const deviceUrl = new URL(
      '/v1/oauth/device/authorize',
      this.config.authServerUrl,
    );

    const deviceRes = await fetch(deviceUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        scope: this.config.scopes.join(' '),
      }),
    });

    if (!deviceRes.ok) {
      const body = await deviceRes.text();
      throw new Error(
        `Device authorization request failed (${deviceRes.status}): ${body}`,
      );
    }

    const device = (await deviceRes.json()) as DeviceAuthorizationResponse;

    // 2. Display code and URL (stderr to keep stdout clean for piped output)
    console.error(`\nVisit:      ${device.verification_uri}`);
    console.error(`Enter code: ${device.user_code}\n`);

    // 3. Poll for token
    let interval = device.interval;
    const deadline = Date.now() + device.expires_in * 1000;
    const tokenUrl = new URL('/v1/oauth/token', this.config.authServerUrl);

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval * 1000));

      const res = await fetch(tokenUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: device.device_code,
          client_id: this.config.clientId,
        }),
      });

      if (res.ok) {
        const tokens = (await res.json()) as TokenResponse;
        this.setTokens(tokens);
        this.refreshRejected = false;
        return;
      }

      const bodyText = await res.text();
      let error: string;
      try {
        error = (JSON.parse(bodyText) as { error: string }).error;
      } catch {
        throw new Error(
          `Device flow polling failed (${res.status}): ${bodyText}`,
        );
      }

      switch (error) {
        case 'authorization_pending':
          continue;
        case 'slow_down':
          interval += 5;
          continue;
        case 'expired_token':
          throw new Error('Device code expired. Please try again.');
        case 'access_denied':
          throw new Error('Authorization denied by user.');
        default:
          throw new Error(`Device flow error: ${error}`);
      }
    }

    throw new Error('Device code expired. Please try again.');
  }

  /**
   * Exchange authorization code for access and refresh tokens
   */
  private async exchangeCode(
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<void> {
    const tokenUrl = new URL('/v1/oauth/token', this.config.authServerUrl);

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: this.config.clientId,
      code_verifier: codeVerifier,
    });

    const response = await fetch(tokenUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Token exchange failed: ${response.status} ${response.statusText} - ${errorBody}`,
      );
    }

    const tokens = (await response.json()) as TokenResponse;
    this.setTokens(tokens);
  }

  /**
   * Refresh access token using refresh token.
   *
   * Two layers of coordination:
   *   1. In-process: `refreshPromise` dedups concurrent callers within
   *      this OAuthClient instance.
   *   2. Cross-process: a file lock keyed on apiBaseUrl serializes
   *      refreshes across MCP server processes. On lock acquire, we
   *      re-read the on-disk token — if another process already
   *      refreshed while we waited, adopt their tokens and skip the
   *      network call. This avoids the "N processes all POST with the
   *      same refresh_token, all but one get invalid_grant" race that
   *      would otherwise exhaust consecutiveRefreshFailures and trigger
   *      clearTokens().
   */
  async refresh(): Promise<void> {
    // If a refresh is already in flight in THIS process, piggyback on it
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // Pre-flight checks (synchronous — safe before dedup)
    if (!this.refreshToken) {
      // Last resort: try restoring from backup before giving up
      if (restoreTokensFromBackup()) {
        this.loadStoredTokens();
        if (this.refreshToken) {
          console.error(
            '[levr-auth] Recovered refresh token from backup, retrying...',
          );
          return this.refresh();
        }
      }
      throw new Error('No refresh token available - authorization required');
    }

    if (this.refreshRejected) {
      throw new Error('Refresh token was rejected - re-authorization required');
    }

    // Create the deduplication promise — wraps lock acquire + conditional
    // refresh + release in a single await-able unit.
    this.refreshPromise = this.refreshWithLock().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  /**
   * Acquire the cross-process refresh lock, re-check disk state, and
   * either adopt freshly-rotated tokens from disk or call the refresh
   * endpoint. Always releases the lock.
   */
  private async refreshWithLock(): Promise<void> {
    const lockPath = getLockPath(this.config.authServerUrl);
    const tokenBeforeLock = this.accessToken;
    const lock = await acquireFileLock(lockPath).catch((err: unknown) => {
      // Lock acquisition failed outright — fall back to unlocked refresh.
      // Better to race than to block indefinitely if the lock subsystem
      // itself is broken (e.g. disk full, permissions, etc.).
      console.error(
        '[levr-auth] File lock acquire failed; proceeding without lock:',
        err instanceof Error ? err.message : String(err),
      );
      return null;
    });

    if (lock?.brokeStaleLock) {
      console.error(
        '[levr-auth] Broke stale refresh lock (previous holder likely crashed)',
      );
    }

    try {
      // Check if another process refreshed while we waited for the lock
      const onDisk = loadTokens();
      if (
        onDisk &&
        onDisk.accessToken &&
        onDisk.accessToken !== tokenBeforeLock &&
        onDisk.expiresAt > Date.now()
      ) {
        // Another process won the race — adopt their tokens instead of
        // rotating ours (which would now 400 with invalid_grant since
        // our refresh_token was already consumed by the winner).
        this.accessToken = onDisk.accessToken;
        this.refreshToken = onDisk.refreshToken;
        this.expiresAt = onDisk.expiresAt;
        this.refreshRejected = false;
        this.consecutiveRefreshFailures = 0;
        return;
      }

      // Nobody else refreshed — do it ourselves
      await this.refreshInternal();
    } finally {
      lock?.release();
    }
  }

  /**
   * Internal refresh implementation — called only once per dedup window.
   * All concurrent callers share the same promise via refresh().
   */
  private async refreshInternal(): Promise<void> {
    const tokenUrl = new URL('/v1/oauth/token', this.config.authServerUrl);

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken!,
      client_id: this.config.clientId,
    });

    let response: Response;
    try {
      response = await fetch(tokenUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (fetchError) {
      // Network error — backend is unreachable. NEVER clear tokens for this.
      throw new Error(
        `Token refresh failed (network error: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}) - will retry`,
      );
    }

    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        this.consecutiveRefreshFailures++;

        console.error(
          `[levr-auth] Refresh rejected (${response.status}), ` +
            `failure ${this.consecutiveRefreshFailures}/${CLEAR_TOKENS_AFTER_FAILURES}`,
        );

        // Only clear tokens after CLEAR_TOKENS_AFTER_FAILURES consecutive
        // 400/401 responses. A single failure could be a transient backend
        // issue (restart, DB connection drop) where the refresh token is
        // still valid.
        if (this.consecutiveRefreshFailures >= CLEAR_TOKENS_AFTER_FAILURES) {
          console.error(
            '[levr-auth] Clearing tokens after ' +
              `${this.consecutiveRefreshFailures} consecutive failures`,
          );
          this.accessToken = null;
          this.refreshToken = null;
          this.expiresAt = 0;
          this.refreshRejected = true;
          clearTokens();
          this.consecutiveRefreshFailures = 0;
          throw new Error(
            'Refresh token rejected by server after multiple attempts - re-authorization required',
          );
        }

        // Not enough consecutive failures yet — clear in-memory access token
        // but keep the file on disk so next retry uses the same refresh token.
        this.accessToken = null;
        this.expiresAt = 0;
        throw new Error(
          `Token refresh failed (${response.status}) - will retry ` +
            `(${CLEAR_TOKENS_AFTER_FAILURES - this.consecutiveRefreshFailures} attempts remaining)`,
        );
      }

      // 5xx or other non-auth errors — transient, don't count as rejections
      throw new Error(`Token refresh failed (${response.status}) - will retry`);
    }

    // Success — reset failure counter and rejected flag
    this.consecutiveRefreshFailures = 0;
    this.refreshRejected = false;
    const tokens = (await response.json()) as TokenResponse;
    this.setTokens(tokens);
  }

  /**
   * Store tokens in memory and persist to disk.
   *
   * Non-refresh grants (authorization_code, device_code, password) carry
   * `tokens.user.workspace_id` — the workspace the user just logged into.
   * Refresh grants omit it. When present we persist it to ~/.tq/workspace.json
   * so MCP clients pick up the selected workspace without a separate round-trip.
   */
  private setTokens(tokens: TokenResponse): void {
    this.accessToken = tokens.access_token;
    this.refreshToken = tokens.refresh_token;
    // Expire 1 minute early to avoid edge cases
    this.expiresAt = Date.now() + tokens.expires_in * 1000 - 60000;

    // Persist to disk (keyed by apiBaseUrl in the token map)
    saveTokens({
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      expiresAt: this.expiresAt,
      apiBaseUrl: this.config.authServerUrl,
    });

    if (tokens.user?.workspace_id) {
      try {
        saveWorkspace(tokens.user.workspace_id);
      } catch (err) {
        console.error('[levr-auth] Failed to persist workspace:', err);
      }
    }
  }

  /**
   * Get a valid access token, refreshing if needed
   * Note: Does NOT auto-authorize - throws if no tokens available
   */
  async getAccessToken(): Promise<string> {
    // No access token but refresh token available — try refresh
    if (!this.accessToken && this.refreshToken) {
      await this.refresh();
      return this.accessToken!;
    }

    // No token at all - need to authorize
    if (!this.accessToken) {
      throw new Error('No access token available - authorization required');
    }

    // Token expired - try to refresh
    if (Date.now() >= this.expiresAt) {
      await this.refresh();
    }

    return this.accessToken;
  }

  /**
   * Get access token without auto-refresh (for checking current state)
   */
  getAccessTokenSync(): string | null {
    return this.accessToken;
  }

  /**
   * Check if client has valid tokens
   */
  isAuthorized(): boolean {
    return this.accessToken !== null && Date.now() < this.expiresAt;
  }

  /**
   * Check if tokens exist (may be expired)
   */
  hasTokens(): boolean {
    return this.accessToken !== null;
  }

  /**
   * Attempt a proactive (background) refresh without accumulating toward
   * the nuclear clearTokens() threshold. If refresh fails, the failure
   * counter is reset so background timer ticks can never delete the
   * token file. Only critical-path refreshes (from getAccessToken /
   * ensureAuth) should count toward the threshold.
   *
   * @returns true if refresh succeeded, false otherwise
   */
  async refreshProactive(): Promise<boolean> {
    try {
      await this.refresh();
      return true;
    } catch {
      // Reset counter — proactive failures must never accumulate toward
      // the CLEAR_TOKENS_AFTER_FAILURES threshold that deletes the file.
      this.consecutiveRefreshFailures = 0;
      return false;
    }
  }

  /**
   * Clear all tokens (logout). Also clears the persisted workspace selection
   * so the next login starts from a clean state on shared machines.
   */
  clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = 0;
    clearTokens();
    clearWorkspace();
  }

  /**
   * Get token expiration time
   */
  getExpiresAt(): number {
    return this.expiresAt;
  }

  /**
   * Get current refresh token (for storage)
   */
  getRefreshToken(): string | null {
    return this.refreshToken;
  }

  /**
   * Get time until expiration in milliseconds
   */
  getTimeUntilExpiry(): number {
    return this.expiresAt - Date.now();
  }

  /**
   * Check if token is expiring soon (within given minutes)
   */
  isExpiringSoon(withinMinutes: number = 5): boolean {
    const threshold = withinMinutes * 60 * 1000;
    const timeUntilExpiry = this.getTimeUntilExpiry();
    return timeUntilExpiry > 0 && timeUntilExpiry < threshold;
  }

  /**
   * Check if refresh was definitively rejected (token revoked/invalid).
   * When true, no further refresh attempts will be made until
   * re-authorization or fresh tokens are loaded.
   */
  isRefreshRejected(): boolean {
    return this.refreshRejected;
  }

  /**
   * Reload tokens from storage (useful after external refresh)
   */
  reloadTokens(): void {
    this.loadStoredTokens();
  }
}
