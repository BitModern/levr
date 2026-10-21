/**
 * Classify a bearer token by its SHAPE — [issue:internal].
 *
 * The server decides how to verify a token by looking at the token, not at
 * where it came from (`isPersonalAccessToken` in the backend's auth
 * middleware): a Levr personal access token starts with `tq_`, and anything
 * else is handed to the JWT verifier. `LEVR_TOKEN` carries either kind — a
 * PAT minted in Settings, or an OAuth access token a device-code login
 * printed for CI — so the CLI must apply the same rule. Until internal every
 * `LEVR_TOKEN` was called a PAT, and the JWT-only steps (resolving
 * `--workspace-id` / `LEVR_WORKSPACE_ID`, `levr workspace list|select`) were
 * silently skipped for an OAuth token, which has no workspace of its own.
 *
 * Leaf module on purpose: no imports, so `resolve-token`, the handlers and
 * their tests can all read it without pulling in credentials or the SDK.
 */
export const PAT_PREFIX = 'tq_';

export type TokenType = 'pat' | 'jwt';

/** `tq_…` is a personal access token; everything else is treated as a JWT. */
export function classifyToken(token: string): TokenType {
  return token.startsWith(PAT_PREFIX) ? 'pat' : 'jwt';
}
