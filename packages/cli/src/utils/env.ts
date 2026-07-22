import { readCredentials } from '../auth/credentials.js';

const DEFAULT_API_URL = 'https://api.levr.one';

// Known Levr environments: api host → auth host. Used to derive the
// browser-authorize base when LEVR_AUTH_URL is not set, so the API and auth
// URLs can never be half-configured into a cross-environment mismatch
// (internal: a staging auth code exchanged at production fails with
// invalid_grant and vice versa).
const KNOWN_AUTH_HOSTS: Record<string, string> = {
  'api.levr.one': 'auth.levr.one',
  'api.levr.now': 'auth.levr.now',
};

/** OAuth client ID for the CLI (seeded in oauth_clients table) */
export const CLI_CLIENT_ID = '3';

// Per-invocation override from a `--url` flag (levr init / levr auth login).
// Set once at handler start; wins over the environment for the rest of the
// process so every downstream call (device flow, token exchange, SDK client)
// targets the same environment.
let sessionApiUrl: string | undefined;

export function setSessionApiUrl(url: string): void {
  sessionApiUrl = normalizeUrl(url);
}

/** Test-only: clear the module-level `--url` override between tests. */
export function resetSessionApiUrl(): void {
  sessionApiUrl = undefined;
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Resolve the API base URL: `--url` flag > `LEVR_URL` env var > the
 * `api_url` stored in credentials at login > production default.
 *
 * The stored-credentials fallback keeps every later command (push, refresh,
 * workspace list) pointed at the environment the user actually logged into,
 * instead of silently falling back to production when the env var is no
 * longer exported in the current shell.
 */
export function getApiUrl(): string {
  if (sessionApiUrl) {
    return sessionApiUrl;
  }
  const env = process.env['LEVR_URL'];
  if (env) {
    return normalizeUrl(env);
  }
  // The stored api_url belongs to the stored JWT session — never route PAT
  // (LEVR_TOKEN) auth by it: an unrelated earlier `levr auth login` against
  // another environment must not hijack where a PAT request is sent.
  if (!getPatToken()) {
    const stored = readCredentials()?.api_url;
    if (stored) {
      return normalizeUrl(stored);
    }
  }
  return DEFAULT_API_URL;
}

/**
 * Resolve the auth-server base URL (browser PKCE consent page only):
 * `LEVR_AUTH_URL` env var > derived from the resolved API URL for known
 * Levr hosts. Unrecognized hosts (e.g. localhost dev stacks) require the
 * explicit env var — throwing beats silently opening the production login
 * page for a token exchange that can never succeed.
 */
export function getAuthUrl(): string {
  const env = process.env['LEVR_AUTH_URL'];
  if (env) {
    return normalizeUrl(env);
  }
  const apiUrl = getApiUrl();
  const derived = deriveAuthUrl(apiUrl);
  if (derived) {
    return derived;
  }
  throw new Error(
    `Cannot derive the auth server URL from API URL "${apiUrl}". ` +
      'Set LEVR_AUTH_URL to the auth server base URL (e.g. https://auth.levr.one).',
  );
}

function deriveAuthUrl(apiUrl: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(apiUrl);
  } catch {
    return undefined;
  }
  const authHost = KNOWN_AUTH_HOSTS[parsed.host];
  return authHost ? `${parsed.protocol}//${authHost}` : undefined;
}

export function getTeamId(flagValue?: string): string | undefined {
  return flagValue || process.env['LEVR_TEAM_ID'] || undefined;
}

export function getPatToken(): string | undefined {
  return process.env['LEVR_TOKEN'];
}

export function getSourceOverride(): string | undefined {
  return process.env['LEVR_SOURCE'];
}

export function getAutomationSourceIdOverride(): string | undefined {
  return process.env['LEVR_AUTOMATION_SOURCE_ID'];
}
