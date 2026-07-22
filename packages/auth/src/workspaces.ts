/**
 * Workspace listing — public library surface for `@levr-one/auth`.
 *
 * Promotes the CLI's former private `fetchWorkspaceSites()` into a reusable
 * library function (internal / D2). Consumed by any embedder of `@levr-one/auth`
 * (its original consumer `@levr/setup` was retired in internal).
 *
 * IMPORTANT (internal / R2F1): a public library function must NEVER terminate
 * its caller's process. Where the old CLI-private helper terminated the process
 * on auth/HTTP-error branches, `listWorkspaces()` instead throws a typed
 * `WorkspaceFetchError`. Process termination + user-facing stderr messaging live
 * in the CLI wrapper (`cli.ts`), which catches this error.
 */

import { OAuthClient } from './oauth-client.js';
import { loadTokens } from './token-store.js';
import { loadConfig } from './config.js';

/**
 * A workspace (site) the authenticated user has access to.
 *
 * This shape mirrors the backend contract exactly — `siteItemSchema` in
 * `apps/backender/src/auth/dto/sites-response.dto.ts`, backing
 * `GET /v1/auth/sites`. (internal / audit H1: the former client-side interface
 * had drifted — it was missing `user_id`/`role`/`last_accessed_at`, carried a
 * dead/misnamed `url_key`, and had a nonexistent `id`. All corrected here.)
 */
export interface WorkspaceSite {
  workspace_id: string;
  workspace_name: string;
  workspace_url_key: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'guest';
  is_primary: boolean;
  last_accessed_at: string | null;
}

/** Why a `listWorkspaces()` call failed — lets callers format their own messaging. */
export type WorkspaceFetchErrorCode =
  | 'not_authenticated'
  | 'token_refresh_failed'
  | 'http_error';

/**
 * Thrown by `listWorkspaces()` instead of terminating the process. Carries a
 * machine-readable `code` and, for HTTP failures, the response `status`/`body`.
 */
export class WorkspaceFetchError extends Error {
  readonly code: WorkspaceFetchErrorCode;
  readonly status?: number;
  readonly body?: string;

  constructor(
    code: WorkspaceFetchErrorCode,
    message: string,
    options?: { status?: number; body?: string },
  ) {
    super(message);
    this.name = 'WorkspaceFetchError';
    this.code = code;
    this.status = options?.status;
    this.body = options?.body;
  }
}

/** Response envelope from `GET /v1/auth/sites`. */
interface SitesResponseEnvelope {
  sites?: WorkspaceSite[];
  current_workspace_id?: string;
}

/**
 * `true` only for a non-null, non-array object. `typeof null === 'object'` and
 * arrays are objects too, so both need excluding explicitly.
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Validates the *elements*, not just the container. `JSON.parse` happily yields
 * `[null]`, `["a"]`, or `[1]`, and a bare `Array.isArray()` check would pass
 * those straight through to callers that then dereference `site.workspace_name`
 * and crash with a TypeError. Reject an unexpected shape here so it surfaces as
 * a typed `WorkspaceFetchError` (contract drift) rather than a downstream crash.
 */
const isSiteArray = (value: unknown): value is WorkspaceSite[] =>
  Array.isArray(value) && value.every(isPlainObject);

/**
 * List the workspaces (sites) the authenticated user has access to.
 *
 * Resolves the env/client from the persisted `~/.tq/config.json` (via
 * `loadConfig()`), loads the stored tokens, refreshes if needed, and calls
 * `GET /v1/auth/sites`.
 *
 * @throws {WorkspaceFetchError} `not_authenticated` if no tokens are stored,
 *   `token_refresh_failed` if the access token can't be obtained/refreshed, or
 *   `http_error` (carrying `status`/`body`) on a non-2xx response. Never
 *   terminates the process.
 */
export async function listWorkspaces(): Promise<WorkspaceSite[]> {
  const stored = loadTokens();
  if (!stored) {
    throw new WorkspaceFetchError('not_authenticated', 'Not logged in.');
  }

  const config = loadConfig();
  const authServerUrl = config.apiUrl;
  const client = new OAuthClient({
    clientId: config.oauthClientId,
    authServerUrl,
  });
  // The OAuthClient constructor only loads tokens lazily via the disk path.
  // Seed it with the freshly-loaded tokens so getAccessToken() can refresh
  // (or use) them instead of throwing "No access token available".
  client.setTokensFromStorage(stored);

  let token: string;
  try {
    token = await client.getAccessToken();
  } catch {
    throw new WorkspaceFetchError(
      'token_refresh_failed',
      'Token expired and refresh failed.',
    );
  }

  const url = new URL('/v1/auth/sites', authServerUrl);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new WorkspaceFetchError(
      'http_error',
      `Failed to fetch workspaces (${res.status}).`,
      { status: res.status, body },
    );
  }

  // Backend returns { sites: [...], current_workspace_id: "..." }.
  // Tolerate older bare-array responses for forward compat.
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new WorkspaceFetchError(
      'http_error',
      'Workspace list response was not valid JSON.',
      { status: res.status },
    );
  }

  if (isSiteArray(data)) {
    return data;
  }
  const sites = isPlainObject(data)
    ? (data as SitesResponseEnvelope).sites
    : undefined;
  if (isSiteArray(sites)) {
    return sites;
  }
  // Surface a contract drift instead of silently returning an empty list —
  // an empty `{ sites: [] }` is a valid array and returns above; only an
  // unrecognized shape reaches here.
  throw new WorkspaceFetchError(
    'http_error',
    'Workspace list response had an unexpected shape.',
    { status: res.status },
  );
}
