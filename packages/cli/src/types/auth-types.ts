/**
 * Stored credentials for JWT-based authentication (from `levr auth login`).
 * Persisted at ~/.config/levr/credentials.json with 0600 permissions.
 */
export interface StoredCredentials {
  version: 1;
  api_url: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  user: {
    id: string;
    email: string;
    workspace_id: string;
  };
}

/**
 * OAuth token response from POST /v1/oauth/token.
 * The `user` field is included in the enriched response and contains
 * identity from UserAccount (email, name) plus workspace context.
 */
export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  user?: {
    id: string;
    email: string;
    workspace_id: string;
    given_name?: string;
    family_name?: string;
  };
}

/**
 * Device authorization response from POST /v1/oauth/device/authorize.
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
 * Result of resolving auth — either a PAT or JWT access token.
 */
export interface ResolvedAuth {
  token: string;
  type: 'pat' | 'jwt';
}
