import type { ResolvedAuth } from '../types/auth-types.js';
import { getPatToken } from '../utils/env.js';
import { readCredentials } from './credentials.js';
import { isTokenExpired, refreshToken } from './token-refresh.js';

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
