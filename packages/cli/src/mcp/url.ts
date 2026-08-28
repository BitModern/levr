import { getApiUrl } from '../utils/env.js';

// The MCP OAuth resource is the APP host plus an `/api` prefix
// (`ai.levr.<env>/api/v1/mcp`), NOT the bare backend API host — RFC 9728
// protected-resource discovery advertises the app host, and dialing
// `api.levr.*` fails the resource-identity check (verified live 2026-07-21,
// internal/internal). Local dev hits the backend directly (no app-host proxy),
// hence the generic `<api-url>/v1/mcp` fallback below.
const KNOWN_MCP_URLS: Record<string, string> = {
  'api.levr.one': 'https://ai.levr.one/api/v1/mcp',
  'api.levr.now': 'https://ai.levr.now/api/v1/mcp',
};

export interface ResolvedMcpUrl {
  url: string;
  /** Where the URL came from, for the confirmation line. */
  source: 'flag' | 'env:LEVR_MCP_URL' | `derived:${string}`;
}

/**
 * Resolve the MCP server URL: `--url` flag > `LEVR_MCP_URL` env > derived
 * from the resolved API URL (which itself honors `LEVR_URL` > the URL stored
 * at login > production default, internal). Known Levr hosts map to their
 * app-host MCP resource; anything else (localhost dev stacks, custom
 * deployments) derives `<api-url>/v1/mcp`.
 */
export function resolveMcpUrl(flagUrl?: string): ResolvedMcpUrl {
  const resolved = resolveRaw(flagUrl);
  // Validate every source, not just `--url`. The derived value is built from
  // the API URL, which itself comes from `LEVR_URL` or whatever was stored at
  // login — none of that is guaranteed to be a URL either.
  assertUsableMcpUrl(resolved.url, resolved.source);
  return resolved;
}

function resolveRaw(flagUrl?: string): ResolvedMcpUrl {
  if (flagUrl) {
    return { url: stripSlash(flagUrl), source: 'flag' };
  }
  const envVar = process.env['LEVR_MCP_URL'];
  if (envVar) {
    return { url: stripSlash(envVar), source: 'env:LEVR_MCP_URL' };
  }
  const apiUrl = getApiUrl();
  const known = knownMcpUrl(apiUrl);
  return { url: known ?? `${apiUrl}/v1/mcp`, source: `derived:${apiUrl}` };
}

/** Name the input the user has to change, not our internal source tag. */
function sourceLabel(source: ResolvedMcpUrl['source']): string {
  if (source === 'flag') return '--url';
  if (source === 'env:LEVR_MCP_URL') return 'LEVR_MCP_URL';
  return `the API URL (${source.slice('derived:'.length)})`;
}

/**
 * Reject a URL that must not reach a client config or a spawned CLI (internal).
 *
 * Three things this stops:
 *
 * 1. **No scheme.** `claude mcp add --transport http --scope user levr <value>`
 *    is spawned with fixed argv since internal, so a value like `--foo` is read
 *    by that CLI as a FLAG rather than as its URL operand — argument injection.
 *    Requiring a parseable absolute URL removes the shape entirely.
 * 2. **A non-http(s) scheme.** `file:` / `javascript:` is never a valid MCP
 *    endpoint, but would be written verbatim into every client's config.
 * 3. **Embedded credentials.** `https://user:pass@host` would be written into
 *    a config file — and since internal a config file can be `--scope project`,
 *    which the user is told to COMMIT. That turns a bad URL into a secret in
 *    git history. MCP authenticates via OAuth in the browser; credentials in
 *    the URL are never needed.
 */
function assertUsableMcpUrl(
  url: string,
  source: ResolvedMcpUrl['source'],
): void {
  const from = sourceLabel(source);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `Invalid MCP URL from ${from}: ${JSON.stringify(url)} is not a URL. ` +
        `Expected an absolute http(s) URL, e.g. https://ai.levr.one/api/v1/mcp`,
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Invalid MCP URL from ${from}: ${JSON.stringify(url)} uses ` +
        `"${parsed.protocol}" — only http and https are supported.`,
    );
  }

  if (!parsed.hostname) {
    throw new Error(
      `Invalid MCP URL from ${from}: ${JSON.stringify(url)} has no host.`,
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error(
      `Invalid MCP URL from ${from}: ${JSON.stringify(url)} embeds ` +
        `credentials. They would be written into client config files — ` +
        `including project-scoped ones you are told to commit. Levr ` +
        `authenticates in the browser; remove the user:password@ prefix.`,
    );
  }
}

function knownMcpUrl(apiUrl: string): string | undefined {
  try {
    return KNOWN_MCP_URLS[new URL(apiUrl).host];
  } catch {
    return undefined;
  }
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
