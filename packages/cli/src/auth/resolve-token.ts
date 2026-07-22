import type { ResolvedAuth } from '../types/auth-types.js';
import { getApiUrl, getPatToken } from '../utils/env.js';
import { readCredentials } from './credentials.js';
import { isTokenExpired, refreshToken } from './token-refresh.js';

/**
 * Stored credentials exist but were issued by a different server than the
 * one this command targets (`--url`/`LEVR_URL`). Callers that can recover
 * (e.g. `levr init` re-logging-in against the new target) match on this
 * class instead of string-sniffing the message.
 */
export class CredentialsMismatchError extends Error {
  constructor(storedUrl: string, activeUrl: string) {
    super(
      `Stored credentials are for ${storedUrl}, but this command targets ` +
        `${activeUrl}. Run 'levr auth login' to authenticate against this server.`,
    );
    this.name = 'CredentialsMismatchError';
  }
}

/**
 * Resolve auth token in priority order:
 * 1. LEVR_TOKEN env var (PAT) — long-lived, no refresh
 * 2. Stored credentials (JWT) — auto-refresh if expired
 * 3. Error — not authenticated
 */
export async function resolveToken(): Promise<ResolvedAuth> {
  // 1. PAT from environment
  const pat = getPatToken();
  if (pat) {
    return { token: pat, type: 'pat' };
  }

  // 2. Stored JWT credentials
  let creds = readCredentials();
  if (creds) {
    // Stored credentials are only valid for the environment they were issued
    // by. When `--url`/`LEVR_URL` targets a different server, treat them as
    // absent instead of sending (or refreshing) a foreign-environment token —
    // that path ends in a misleading 401/invalid_grant (internal).
    const activeUrl = getApiUrl();
    const storedUrl = creds.api_url.replace(/\/+$/, '');
    if (storedUrl !== activeUrl) {
      throw new CredentialsMismatchError(storedUrl, activeUrl);
    }
    if (isTokenExpired(creds)) {
      const refreshed = await refreshToken(creds);
      if (!refreshed) {
        throw new Error(
          "Token expired and refresh failed. Run 'levr auth login' to re-authenticate.",
        );
      }
      creds = refreshed;
    }
    return { token: creds.access_token, type: 'jwt' };
  }

  // 3. No credentials
  throw new Error(
    "Not authenticated. Run 'levr auth login' or set LEVR_TOKEN environment variable.",
  );
}
