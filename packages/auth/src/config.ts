/**
 * Unified environment configuration for TQ.AI
 *
 * Single source of truth for backend URLs, auth URLs, and OAuth client IDs.
 * Precedence: TQ_BACKEND_URL env var > ~/.tq/config.json > token apiBaseUrl > staging default
 *
 * In test environments (VITEST or NODE_ENV=test), ~/.tq/config.json is
 * skipped so that tests stay deterministic and never depend on the
 * developer's local config file.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getTqDir, loadTokens } from './token-store.js';

export interface TqConfig {
  environment: 'local' | 'staging' | 'production' | 'custom';
  apiUrl: string;
  authUrl: string;
  clientUrl: string;
  oauthClientId: string;
}

/**
 * Returns true when running inside a test runner (Vitest, Jest, etc.).
 */
function isTestEnv(): boolean {
  return (
    process.env.VITEST !== undefined ||
    process.env.NODE_ENV === 'test' ||
    process.env.JEST_WORKER_ID !== undefined
  );
}

/**
 * Detect whether the developer is running in TLS dev mode (mkcert + DEV_TLS).
 *
 * Resolution order:
 *   1. Tests (Vitest/Jest/NODE_ENV=test) → always false (deterministic).
 *   2. Explicit `DEV_TLS` env var        → 'true'/'false' wins.
 *   3. `DEV_TLS` in the backender's env  → the setting that actually decides
 *                                          whether the backender serves TLS.
 *
 * Step 3 used to probe for `apps/backender/certs/dev.crt` and treat its
 * PRESENCE as "TLS is on". That tested a proxy for the real question: the cert
 * is written once by scripts/dev-setup-tls.sh and never removed when TLS is
 * turned off, so any machine that had ever run it resolved TLS mode forever.
 *
 * The walk-up from cwd is retained, so this still works from the repo root, an
 * app subdirectory, or a worktree.
 *
 * Keep in sync with `apps/sync-server/src/auth.ts:isLocalTlsMode()` — the two
 * are duplicated verbatim (sync-server does not depend on this package). The
 * bodies are kept byte-identical so a plain `diff` verifies the claim; that is
 * also why the quote check below is split across lines, since this package
 * formats at printWidth 80 and sync-server at 100.
 */
function isLocalTlsMode(): boolean {
  if (isTestEnv()) return false;
  if (process.env.DEV_TLS === 'true') return true;
  if (process.env.DEV_TLS === 'false') return false;
  return devTlsFromBackenderEnv();
}

/**
 * `parseDevTls` reproduces three dotenv behaviours the obvious regex gets
 * wrong. Each failed CLOSED — it missed a real `DEV_TLS=true` and so dialled
 * http:// at a TLS backender, the exact bug this file exists to fix, mirrored:
 *   - `export DEV_TLS=true`  — the form docs/guides/dev-tls-setup.md prints
 *   - `DEV_TLS=true # note`  — trailing comment on an unquoted value
 *   - the key repeated       — dotenv takes the LAST occurrence, not the first
 *
 * dotenv itself is not used: `packages/auth` does not depend on it, and this
 * helper is duplicated verbatim between the two files (see the note above).
 */
export function parseDevTls(contents: string): boolean | undefined {
  // Global: the LAST assignment wins, matching dotenv.
  const re = /^[ \t]*(?:export[ \t]+)?DEV_TLS[ \t]*=[ \t]*(.*)$/gm;
  let raw: string | undefined;
  for (const m of contents.matchAll(re)) raw = m[1];
  if (raw === undefined) return undefined;

  let value = raw.trim();
  const quote = value[0];
  const isQuote = quote === '"' || quote === "'";
  if (isQuote && value.length > 1 && value.endsWith(quote)) {
    value = value.slice(1, -1);
  } else {
    // Unquoted only: everything from `#` onward is a comment.
    value = (value.split('#')[0] ?? '').trim();
  }
  return value === 'true';
}

function devTlsFromBackenderEnv(): boolean {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    // `.env.worktree` FIRST — it outranks `.env` for the backender, because
    // apps/backender/src/env.ts loads it first and dotenv does not overwrite
    // an already-set key. Reading only `.env` resolves the wrong protocol in a
    // worktree that overrides DEV_TLS.
    for (const name of ['.env.worktree', '.env']) {
      const envPath = path.join(dir, 'apps/backender', name);
      if (!fs.existsSync(envPath)) continue;
      try {
        const parsed = parseDevTls(fs.readFileSync(envPath, 'utf8'));
        if (parsed !== undefined) return parsed;
      } catch {
        // Unreadable env file must not silently select TLS — fail safe.
        return false;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

/**
 * Accept an env value ONLY if it is a bare `http(s)` origin — scheme, host,
 * optional port, and nothing else. Returns the normalised origin, or
 * `undefined` for anything that is not one.
 *
 * This exists because `API_BASE_URL` does not mean the same thing in every
 * env file. In a worktree's `apps/backender/.env` it is that backender's own
 * origin (`http://localhost:8580`) — the value `tq:env local` wants. In the
 * main checkout under DEV_TLS it is `https://ai.levr.test:3020/api`, the URL
 * the BROWSER should call: the client SPA's `/api` proxy. Accepting the
 * second overwrote a correctly-computed `LOCAL_HTTPS` preset with a value
 * that was wrong twice over — wrong host role, and a client dev-server port
 * that is usually not listening — so every stdio MCP server dialled a dead
 * host and reported an opaque `fetch failed`.
 *
 * The path is the discriminator **for the local checkout specifically** — the
 * name says `Local` for that reason. It is NOT a universal truth that a
 * backend base URL has no path: this repo's own deploys set
 * `API_BASE_URL=https://ai.levr.now/api` (`apps/backender/chart/stage.yaml:35`)
 * and `https://ai.levr.one/api` (`chart/prod.yaml:74`), and `setup-mcp.ts`
 * deliberately accepts that shape because the levr MCP endpoint IS reached
 * through the SPA proxy. Do not reuse this helper where deployed values are
 * in scope — it would reject a valid production URL. internal.
 *
 * It fails SAFE — anything ambiguous declines to override the preset instead
 * of silently replacing it. Do NOT weaken this back to a `^https?://` prefix
 * test; that is precisely the check the proxy URL passed.
 *
 * Kept here rather than in `cli.ts` because that module is a self-executing
 * CLI (importing it runs the command switch), so a pure helper there cannot
 * be unit-tested — the same reason `parseDevTls` lives in this file.
 *
 * internal.
 */
export function parseLocalBackenderOrigin(
  raw: string | undefined,
): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return undefined;

  // Reject on the RAW text, BEFORE parsing. WHATWG normalises during parse:
  // `/foo/..` collapses to `/`, and a bare trailing `?` or `#` reports an
  // EMPTY `search`/`hash`. A guard that reads only the parsed URL therefore
  // cannot see the two shapes it most needs to reject — which is precisely
  // the bug the first cut of this function shipped (internal): it validated
  // `parsed` and then returned the raw string.
  if (/[?#]/.test(trimmed)) return undefined;
  const afterScheme = trimmed.replace(/^https?:\/\//i, '');
  if (afterScheme.includes('/')) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return undefined;
  }
  // Credentials never belong in a backend base URL, and silently stripping
  // them would write a different URL than the author wrote.
  if (parsed.username || parsed.password) return undefined;

  // Return the PARSED origin, never the raw text — that pairing is what makes
  // the guards above load-bearing rather than decorative.
  return parsed.origin;
}

/**
 * Read one key out of dotenv file contents, reproducing the behaviours
 * `parseDevTls` documents twenty lines above: an `export ` prefix, a trailing
 * `#` comment on an unquoted value, and the LAST assignment winning when the
 * key repeats. Quotes are stripped only when they PAIR, so an unbalanced
 * quote is left intact rather than half-removed.
 *
 * The first cut of this reader hand-rolled a narrower regex and inherited
 * none of that, even though the repo had already been bitten by the `export `
 * form on this very key — see `scripts/worktree-delete.test.ts:319`.
 * internal / internal.
 *
 * `key` is always a literal from the call sites, never user input, so
 * interpolating it into the pattern is safe.
 */
export function extractEnvValue(
  contents: string,
  key: string,
): string | undefined {
  const re = new RegExp(
    `^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=[ \\t]*(.*)$`,
    'gm',
  );
  let raw: string | undefined;
  for (const m of contents.matchAll(re)) raw = m[1];
  if (raw === undefined) return undefined;

  let value = raw.trim();
  const quote = value[0];
  const isQuote = quote === '"' || quote === "'";
  if (isQuote && value.length > 1 && value.endsWith(quote)) {
    value = value.slice(1, -1);
  } else {
    value = (value.split('#')[0] ?? '').trim();
  }
  return value;
}

/**
 * Resolve a backender origin across the env files in precedence order, given
 * their CONTENTS (`undefined` for a file that does not exist). Pure, so the
 * precedence rule is unit-testable — the file I/O stays in `cli.ts`.
 *
 * **The first file that CONTAINS the key decides, even if its value is
 * unusable.** That matches dotenv and `devTlsFromBackenderEnv`, which both
 * fall through only on an ABSENT key. The first cut fell through on absent
 * OR unusable, which let `.env.worktree` and `.env` disagree: the backender
 * would use the higher-precedence value while the CLI silently resolved the
 * lower one. Two answers for one key is exactly what reading these files in
 * a shared order exists to prevent. Falling back to the preset is the safe
 * direction; falling back to a different file is not. internal.
 */
export function resolveOriginFromEnvFiles(
  key: string,
  files: readonly (string | undefined)[],
): string | undefined {
  for (const contents of files) {
    if (contents === undefined) continue;
    const raw = extractEnvValue(contents, key);
    if (raw === undefined) continue;
    return parseLocalBackenderOrigin(raw);
  }
  return undefined;
}

const LOCAL_HTTP: TqConfig = {
  environment: 'local',
  apiUrl: 'http://localhost:8080',
  authUrl: 'http://localhost:3021',
  clientUrl: 'http://localhost:3020',
  oauthClientId: '2',
};

const LOCAL_HTTPS: TqConfig = {
  environment: 'local',
  // internal D14: TLS dev mode mirrors the prod parent-domain topology
  // (`*.levr.test` is the dev counterpart of `*.levr.now` / `*.levr.one`).
  // The mkcert cert generated by scripts/dev-setup-tls.sh covers these
  // hostnames, /etc/hosts entries are written by the same script, and the
  // SPA's `runtime-config.ts` falls back to the same triple. Keeping the
  // names consistent end-to-end means cookies set with `Domain=.levr.test`
  // travel to all three subdomains the same way they do in prod.
  apiUrl: 'https://api.levr.test:8080',
  authUrl: 'https://auth.levr.test:3021',
  clientUrl: 'https://ai.levr.test:3020',
  oauthClientId: '2',
};

/**
 * Environment presets. Staging is the default.
 *
 * `local` is a getter that returns the HTTPS variant when DEV_TLS dev mode
 * is detected (see `isLocalTlsMode()`), so `yarn tq:env local` writes the
 * right URLs whether the user has TLS dev mode set up or not.
 */
export const PRESETS: Record<'local' | 'staging' | 'production', TqConfig> = {
  staging: {
    environment: 'staging',
    // internal D15: levr.now is the unified staging origin set.
    apiUrl: 'https://api.levr.now',
    authUrl: 'https://auth.levr.now',
    clientUrl: 'https://ai.levr.now',
    oauthClientId: '2',
  },
  get local(): TqConfig {
    return isLocalTlsMode() ? { ...LOCAL_HTTPS } : { ...LOCAL_HTTP };
  },
  production: {
    environment: 'production',
    // internal: rebranded levr.tools → levr.one. Redirect CloudFront keeps
    // legacy levr.tools URLs reachable indefinitely via 301.
    apiUrl: 'https://api.levr.one',
    authUrl: 'https://auth.levr.one',
    clientUrl: 'https://ai.levr.one',
    oauthClientId: '2',
  },
};

/**
 * Env var override — single canonical name
 */
const ENV_VAR = 'TQ_BACKEND_URL';

/**
 * Legacy localhost form for the HTTPS dev preset. Older configs and
 * stored tokens may have `https://localhost:8080` as the apiUrl; we
 * accept it as an alias of `LOCAL_HTTPS` so flipping DEV_TLS doesn't
 * orphan existing config files.
 */
const LOCAL_HTTPS_LOCALHOST_ALIAS = 'https://localhost:8080';

/**
 * Resolve a full TqConfig from a bare API URL by matching presets.
 * Returns 'custom' environment if no preset matches.
 *
 * Local resolution covers three forms:
 *   - `http://localhost:8080`        → LOCAL_HTTP
 *   - `https://api.levr.test:8080`   → LOCAL_HTTPS (canonical TLS form)
 *   - `https://localhost:8080`       → LOCAL_HTTPS (legacy alias)
 *
 * Resolving the legacy localhost alias to the new levr.test preset means
 * a token issued in TLS mode under the old localhost URL still maps to
 * the right config when read after this change.
 */
export function resolveFromApiUrl(url: string): TqConfig {
  const normalized = url.replace(/\/+$/, '');

  if (normalized === LOCAL_HTTP.apiUrl) return { ...LOCAL_HTTP };
  if (normalized === LOCAL_HTTPS.apiUrl) return { ...LOCAL_HTTPS };
  if (normalized === LOCAL_HTTPS_LOCALHOST_ALIAS) return { ...LOCAL_HTTPS };

  for (const preset of [PRESETS.staging, PRESETS.production]) {
    if (preset.apiUrl === normalized) {
      return { ...preset };
    }
  }

  // Custom URL -- use staging-style auth/client URLs as placeholders
  return {
    environment: 'custom',
    apiUrl: normalized,
    authUrl: normalized,
    clientUrl: normalized,
    oauthClientId: process.env.TQ_OAUTH_CLIENT_ID || '2',
  };
}

/**
 * Load unified config with precedence:
 * 1. TQ_BACKEND_URL env var
 * 2. ~/.tq/config.json  (skipped in test environments)
 * 3. Token's apiBaseUrl from ~/.tq/oauth-tokens.json (skipped in test environments)
 * 4. Staging default
 *
 * TQ_OAUTH_CLIENT_ID env var overrides oauthClientId from any source.
 */
export function loadConfig(): TqConfig {
  let config: TqConfig;

  // 1. Check env var override
  const envValue = process.env[ENV_VAR];
  if (envValue) {
    config = resolveFromApiUrl(envValue);
    if (process.env.TQ_OAUTH_CLIENT_ID) {
      config.oauthClientId = process.env.TQ_OAUTH_CLIENT_ID;
    }
    return config;
  }

  // 2. Read ~/.tq/config.json (skip in test environments for determinism)
  if (!isTestEnv()) {
    const configPath = getConfigFilePath();
    if (fs.existsSync(configPath)) {
      try {
        const raw = JSON.parse(
          fs.readFileSync(configPath, 'utf-8'),
        ) as Partial<TqConfig>;
        config = {
          environment: raw.environment || 'custom',
          apiUrl: raw.apiUrl ?? PRESETS.staging.apiUrl,
          authUrl: raw.authUrl ?? PRESETS.staging.authUrl,
          clientUrl: raw.clientUrl ?? PRESETS.staging.clientUrl,
          oauthClientId: raw.oauthClientId ?? '2',
        };
        // Apply TQ_OAUTH_CLIENT_ID override
        if (process.env.TQ_OAUTH_CLIENT_ID) {
          config.oauthClientId = process.env.TQ_OAUTH_CLIENT_ID;
        }
        return config;
      } catch {
        process.stderr.write(
          `[levr-auth] WARNING: Malformed config at ${configPath}, falling back to default.\n`,
        );
      }
    }
  }

  // 3. Infer from stored token's apiBaseUrl (tokens know which backend issued them)
  if (!isTestEnv()) {
    const stored = loadTokens();
    if (stored?.apiBaseUrl) {
      config = resolveFromApiUrl(stored.apiBaseUrl);
      if (process.env.TQ_OAUTH_CLIENT_ID) {
        config.oauthClientId = process.env.TQ_OAUTH_CLIENT_ID;
      }
      process.stderr.write(
        `[levr-auth] No config.json found. Using environment from token: ${config.environment} (${config.apiUrl})\n`,
      );
      return config;
    }
  }

  // 4. Default to staging
  config = { ...PRESETS.staging };
  // Apply TQ_OAUTH_CLIENT_ID override
  if (process.env.TQ_OAUTH_CLIENT_ID) {
    config.oauthClientId = process.env.TQ_OAUTH_CLIENT_ID;
  }
  return config;
}

/**
 * Write config to ~/.tq/config.json using atomic write (tmp + rename)
 */
export function writeConfig(config: TqConfig): void {
  const tqDir = getTqDir();

  if (!fs.existsSync(tqDir)) {
    fs.mkdirSync(tqDir, { recursive: true, mode: 0o700 });
  }

  const configPath = getConfigFilePath();
  const tempPath = configPath + '.tmp';

  fs.writeFileSync(tempPath, JSON.stringify(config, null, 2) + '\n', {
    mode: 0o600,
  });
  fs.renameSync(tempPath, configPath);
}

/**
 * Get the config file path (~/.tq/config.json)
 */
export function getConfigFilePath(): string {
  return path.join(getTqDir(), 'config.json');
}
