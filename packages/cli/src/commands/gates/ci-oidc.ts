/**
 * GitHub Actions OIDC for `levr gates run --ci` (internal).
 *
 * The workflow needs `permissions: id-token: write` (documented with the
 * pin in D13). When the runner env vars are absent, the CLI still declares
 * CI and the server records `unverified` — it never invents a token.
 *
 * `fail_retry`: a report or verify that answers `OIDC_JWKS_UNAVAILABLE`
 * (503) is retried twice with backoff, then the command exits non-zero.
 * Nothing was recorded for those attempts.
 *
 * internal review H7: the token is minted for ONE workspace
 * (`levr:<workspace_id>`, matching the server's `ciOidcAudience`), is
 * requested fresh right before each verify and report (an Actions token lives
 * minutes, and a long suite outlived the one fetched at start-up), and the
 * request is bounded by a timeout so a hung token endpoint cannot hang CI.
 * The run's commit (`GITHUB_SHA`) is sent as `commit_sha`, which the server
 * now requires before it will stamp `oidc_verified`.
 */

export const CI_OIDC_HEADER = 'X-Levr-CI-OIDC';
const CI_DECLARED_HEADER = 'X-Levr-CI-Declared';
export const OIDC_JWKS_UNAVAILABLE = 'OIDC_JWKS_UNAVAILABLE';

const RETRY_DELAYS_MS = [250, 750];
const TOKEN_REQUEST_TIMEOUT_MS = 10_000;
const COMMIT_SHA = /^[0-9a-f]{40}$/i;

/** The audience the server expects — `levr:<workspace_id>`. */
export function ciOidcAudience(workspaceId: string): string {
  return `levr:${workspaceId}`;
}

/** The commit this Actions run checked out, when the runner says so. */
export function ciCommitSha(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const sha = env['GITHUB_SHA']?.trim();
  return sha && COMMIT_SHA.test(sha) ? sha : undefined;
}

export interface ActionsOidcEnv {
  ACTIONS_ID_TOKEN_REQUEST_URL?: string;
  ACTIONS_ID_TOKEN_REQUEST_TOKEN?: string;
}

function actionsOidcEnvFrom(
  env: NodeJS.ProcessEnv = process.env,
): ActionsOidcEnv {
  return {
    ACTIONS_ID_TOKEN_REQUEST_URL: env['ACTIONS_ID_TOKEN_REQUEST_URL'],
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'],
  };
}

/**
 * Request an Actions OIDC token for `audience`. Returns null when the runner
 * did not expose the env vars, the request failed, or it did not answer
 * within `timeoutMs` — the caller still sends the declaration header, and
 * the server records `unverified`.
 */
export async function requestActionsOidcToken(
  audience: string,
  env: ActionsOidcEnv = actionsOidcEnvFrom(),
  fetchImpl: typeof fetch = globalThis.fetch,
  timeoutMs: number = TOKEN_REQUEST_TIMEOUT_MS,
): Promise<string | null> {
  const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !requestToken) return null;
  let endpoint: URL;
  try {
    endpoint = new URL(url);
  } catch {
    return null;
  }
  endpoint.searchParams.set('audience', audience);
  try {
    const response = await fetchImpl(endpoint, {
      headers: { Authorization: `bearer ${requestToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { value?: unknown };
    return typeof body.value === 'string' && body.value.length > 0
      ? body.value
      : null;
  } catch {
    return null;
  }
}

/** Headers for verify and report. Declaration is `1` whenever `--ci` is set. */
export function ciRequestHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = { [CI_DECLARED_HEADER]: '1' };
  if (token) headers[CI_OIDC_HEADER] = token;
  return headers;
}

export function isOidcJwksUnavailable(result: {
  response?: { status?: number };
  error?: unknown;
}): boolean {
  if (result.response?.status !== 503) return false;
  return JSON.stringify(result.error ?? '').includes(OIDC_JWKS_UNAVAILABLE);
}

/**
 * Run `fn` and, on `OIDC_JWKS_UNAVAILABLE`, retry twice. Any other result
 * is returned as-is. `fail_retry(2)`.
 */
export async function withOidcJwksRetry<
  T extends { response?: { status?: number }; error?: unknown },
>(
  fn: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = delay,
): Promise<T> {
  let result = await fn();
  for (const wait of RETRY_DELAYS_MS) {
    if (!isOidcJwksUnavailable(result)) return result;
    await sleep(wait);
    result = await fn();
  }
  return result;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
