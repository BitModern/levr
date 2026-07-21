import type {
  StoredCredentials,
  OAuthTokenResponse,
} from '../types/auth-types.js';
import { writeCredentials, deleteCredentials } from './credentials.js';
import { getApiUrl, CLI_CLIENT_ID } from '../utils/env.js';

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes before expiry

/**
 * Check if stored JWT credentials are expired (or within 5 min of expiry).
 */
export function isTokenExpired(creds: StoredCredentials): boolean {
  const expiresAt = new Date(creds.expires_at).getTime();
  return Date.now() >= expiresAt - REFRESH_BUFFER_MS;
}

/**
 * Refresh JWT credentials using the stored refresh token.
 * Returns updated credentials or null if refresh failed.
 */
export async function refreshToken(
  creds: StoredCredentials,
): Promise<StoredCredentials | null> {
  const apiUrl = getApiUrl();
  try {
    const res = await fetch(`${apiUrl}/v1/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: creds.refresh_token,
        client_id: CLI_CLIENT_ID,
      }),
    });

    if (!res.ok) {
      // Refresh failed — token revoked or expired
      deleteCredentials();
      return null;
    }

    const data = (await res.json()) as OAuthTokenResponse;
    const updated: StoredCredentials = {
      ...creds,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    };

    writeCredentials(updated);
    return updated;
  } catch {
    deleteCredentials();
    return null;
  }
}
