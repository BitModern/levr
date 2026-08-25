/**
 * Pure decision logic behind `tq:status` (internal).
 *
 * Lives outside `cli.ts` for the same reason `scripts/setup-mcp-workspace.lib.ts`
 * lives outside `setup-mcp.ts`: that module ends in a self-executing `switch`,
 * so importing it from a test would run a CLI command against the developer's
 * real `~/.tq`. Everything here is pure — the caller does the fs reading and
 * passes the parsed values in.
 *
 * ## The defect this exists to prevent
 *
 * `tq:status` used to render its per-environment block from the three
 * hardcoded `ENV_URLS` presets, while `tq:login` stores a token under the
 * backend's real URL. On any local that is not literally `http://localhost:8080`
 * — every worktree, every DEV_TLS checkout — the block therefore reported a
 * backend the user had not logged into and could not refresh: a stale
 * `local: expired 157366m ago (active)` that survived every login, sitting
 * directly beneath a `Status: valid` line describing a different token.
 *
 * The load-bearing assertion in the tests is that a backend absent from
 * `ENV_URLS` is still listed, and that "active" is decided by URL rather than
 * by environment name.
 */

import { resolveEnvFromUrl } from './token-store.js';
import { PRESETS } from './config.js';

/** One rendered row of the stored-token table. */
export interface TokenRow {
  /** True for the backend `~/.tq/config.json` currently points at. */
  active: boolean;
  url: string;
  /** `local` / `staging` / `production` / `custom`. */
  label: string;
  /** e.g. `valid 738m`, `expired 12m ago`. */
  expiry: string;
}

export function formatExpiry(expiresAt: number, now: number): string {
  const mins = Math.round((expiresAt - now) / 1000 / 60);
  return now >= expiresAt ? `expired ${-mins}m ago` : `valid ${mins}m`;
}

/**
 * Human label for a stored backend URL.
 *
 * `resolveEnvFromUrl` only recognises the three `ENV_URLS` presets, so every
 * worktree-offset local and every DEV_TLS local comes back unnamed — which is
 * most of a working machine's token map. Loopback and the `.levr.test` dev
 * domain are local by construction, so name them rather than render a dozen
 * indistinguishable `custom` rows.
 */
export function labelForBackend(url: string): string {
  const preset = resolveEnvFromUrl(url);
  if (preset) return preset;
  try {
    const { hostname } = new URL(url);
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname === 'levr.test' ||
      hostname.endsWith('.levr.test')
    ) {
      return 'local';
    }
  } catch {
    // Not a parseable URL — fall through to `custom`.
  }
  return 'custom';
}

/**
 * Build the stored-token table from the backends the token map ACTUALLY holds.
 *
 * `activeUrl` is matched by URL, never by environment name: the name `local`
 * maps to the hardcoded `:8080` preset, which on a worktree is a different
 * backend from the configured one.
 *
 * Active row first, then alphabetical — deterministic, so the table does not
 * reshuffle between runs.
 */
export function buildTokenRows(
  entries: ReadonlyArray<{ url: string; tokens: { expiresAt: number } }>,
  activeUrl: string | undefined,
  now: number,
): TokenRow[] {
  return entries
    .map((e) => ({
      active: !!activeUrl && e.url === activeUrl,
      url: e.url,
      label: labelForBackend(e.url),
      expiry: formatExpiry(e.tokens.expiresAt, now),
    }))
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.url.localeCompare(b.url);
    });
}

/**
 * Map a `levr` MCP URL to the backend URL that `~/.tq/oauth-tokens.json` and
 * `~/.tq/workspace.json` are keyed by, so the MCP entry can be compared
 * against the configured backend.
 *
 * The MCP host is not the API host for the hosted environments — both are
 * reached through the client origin's `/api` proxy — so the levr URL cannot be
 * compared directly. The aliases are DERIVED from `PRESETS` rather than
 * written out, so they cannot drift from the environment definitions.
 *
 * Twin of `identityKeyFromLevrUrl` in `scripts/setup-mcp-workspace.lib.ts`,
 * which resolves the same key on the WRITE side. `scripts/` imports no
 * workspace package, so the two cannot share code today; deriving from
 * `PRESETS` is what keeps this copy honest.
 */
export function backendUrlForLevrMcp(levrUrl: string): string {
  const base = levrUrl.replace(/\/+$/, '').replace(/\/v1\/mcp$/, '');
  // ONLY the two hosted presets. `PRESETS.local` must never join this list:
  // under DEV_TLS it is `LOCAL_HTTPS`, whose clientUrl+`/api` is
  // `https://ai.levr.test:3020/api` — a real key in the token map that has to
  // resolve VERBATIM. Adding it would rewrite that key to
  // `https://api.levr.test:8080` and make the entry unreachable, and the
  // "keys a DEV_TLS local verbatim" test would still pass, because
  // `isTestEnv()` makes PRESETS.local the plain-HTTP variant. The test below
  // that asserts this exclusion holds under TLS is the one that would catch
  // it. (review F-006)
  for (const preset of [PRESETS.staging, PRESETS.production]) {
    if (base === `${preset.clientUrl}/api`) return preset.apiUrl;
  }
  // Everything else keys verbatim: that base IS the URL the backend was
  // reached at when its token was stored (worktree locals, DEV_TLS).
  return base;
}

/** The `levr` server entry, extracted from a parsed `.mcp.json`. */
export interface LevrMcpEntry {
  url: string;
  workspaceId?: string;
}

/**
 * Pull the `levr` entry out of a parsed `.mcp.json`.
 *
 * Returns undefined for every shape that does not carry a usable URL —
 * missing file, wrong type, no `levr` server, no `url`. Reporting nothing is
 * correct here: the section is diagnostic, and a guess about which control
 * plane an agent is talking to is worse than silence.
 */
export function levrEntryFrom(parsed: unknown): LevrMcpEntry | undefined {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }
  const servers = (parsed as { mcpServers?: unknown }).mcpServers;
  if (servers === null || typeof servers !== 'object') return undefined;

  const levr = (servers as Record<string, unknown>).levr;
  if (levr === null || typeof levr !== 'object') return undefined;

  const { url, headers } = levr as { url?: unknown; headers?: unknown };
  if (typeof url !== 'string' || !url) return undefined;

  const wsId =
    headers !== null && typeof headers === 'object'
      ? (headers as Record<string, unknown>)['Workspace-Id']
      : undefined;

  return {
    url,
    workspaceId: typeof wsId === 'string' && wsId ? wsId : undefined,
  };
}
