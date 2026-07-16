/**
 * Shared types for OAuth token management
 */

/**
 * Token response from OAuth server.
 *
 * `user` is present on non-refresh grants (authorization_code, device_code,
 * password) and absent on refresh_token responses — `setTokens()` uses
 * `user?.workspace_id` to decide whether to persist workspace state.
 *
 * The backend also returns a `workspaces` array alongside `user` on initial
 * grants, but tq-oauth does not cache that list locally (membership can
 * change between sessions, and `tq:workspace` always fetches a fresh list
 * from `/v1/auth/sites`). Callers that need the live workspace list should
 * call the auth sites endpoint directly.
 */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  user?: { workspace_id: string };
}

/**
 * Structure for stored tokens
 */
export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  /** Backend URL this token was issued for (for environment mismatch detection) */
  apiBaseUrl?: string;
}

/**
 * OAuth client configuration
 */
export interface OAuthConfig {
  /** OAuth authorization server URL (e.g., http://localhost:8080) */
  authServerUrl: string;
  /** Registered OAuth client ID */
  clientId: string;
  /** Local callback port for receiving authorization code */
  redirectPort: number;
  /** Requested OAuth scopes */
  scopes: string[];
}

/**
 * Device authorization response from POST /v1/oauth/device/authorize
 * @see https://datatracker.ietf.org/doc/html/rfc8628
 */
export interface DeviceAuthorizationResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

/**
 * Authentication status for self-healing
 */
export type AuthStatus = 'ok' | 'expired' | 'missing' | 'refreshing' | 'error';

/**
 * Callback for token change events
 */
export type TokenChangeCallback = (tokens: StoredTokens | null) => void;
