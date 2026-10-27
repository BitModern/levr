import type {
  StoredCredentials,
  OAuthTokenResponse,
} from '../types/auth-types.js';
import {
  writeCredentials,
  deleteCredentials,
  readCredentials,
} from './credentials.js';
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
 *
 * Returns the updated credentials, or `null` only when the server REFUSED
 * the refresh token itself (400/401 `invalid_grant`): those credentials are
 * dead and are deleted, and the caller asks for `levr auth login`. Every
 * other failure (a 5xx, a 429, another error code, a proxy's HTML page, an
 * older backend's 400, a network error, an unusable success body) THROWS and
 * keeps the stored credentials, so the next command retries: deleting them
 * signed the user out on any backend hiccup (internal). Same rule as the web
 * client (`apps/client/app/services/tokenRefresh.ts`), including its
 * compare-before-clear: a refusal of a token another process already
 * rotated returns the newer stored pair.
 */
export async function refreshToken(
  creds: StoredCredentials,
): Promise<StoredCredentials | null> {
  const apiUrl = getApiUrl();
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/v1/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: creds.refresh_token,
        client_id: CLI_CLIENT_ID,
      }),
    });
  } catch (error) {
    throw transientFailure(
      `network error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!res.ok) {
    if (await isRefusal(res)) {
      // Compare before clearing: another `levr` process may have rotated
      // the pair while this one waited, and the refusal is of the token it
      // replaced. Keep and use the newer pair instead of deleting it.
      const stored = readCredentials();
      if (stored && stored.refresh_token !== creds.refresh_token) {
        // A login for another server (`levr auth login --url …` meanwhile)
        // is not ours to use or to delete.
        return sameServer(stored, creds.api_url) ? stored : null;
      }
      deleteCredentials();
      return null;
    }
    throw transientFailure(`HTTP ${res.status}`);
  }

  const data = await readTokenResponse(res);
  if (!data) throw transientFailure('unusable response');
  const updated: StoredCredentials = {
    ...creds,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };

  writeCredentials(updated);
  return updated;
}

function sameServer(stored: StoredCredentials, apiUrl: string): boolean {
  return stored.api_url.replace(/\/+$/, '') === apiUrl.replace(/\/+$/, '');
}

function transientFailure(reason: string): Error {
  return new Error(
    `Token refresh failed (${reason}). Your login is kept; try again, or run 'levr auth login' if it keeps failing.`,
  );
}

/** The server refused the refresh token itself: a 400/401 `invalid_grant`. */
async function isRefusal(res: Response): Promise<boolean> {
  if (res.status !== 400 && res.status !== 401) return false;
  try {
    const body = (await res.json()) as { error?: unknown };
    return body?.error === 'invalid_grant';
  } catch {
    return false;
  }
}

/**
 * The token response, or `null` when it is not one (a captive portal's 200,
 * a body missing a token): writing it would store a login that cannot be
 * refreshed.
 */
async function readTokenResponse(
  res: Response,
): Promise<OAuthTokenResponse | null> {
  try {
    const data = (await res.json()) as Partial<OAuthTokenResponse>;
    const valid =
      typeof data?.access_token === 'string' &&
      data.access_token !== '' &&
      typeof data.refresh_token === 'string' &&
      data.refresh_token !== '' &&
      typeof data.expires_in === 'number' &&
      Number.isFinite(data.expires_in);
    return valid ? (data as OAuthTokenResponse) : null;
  } catch {
    return null;
  }
}
