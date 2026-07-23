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
