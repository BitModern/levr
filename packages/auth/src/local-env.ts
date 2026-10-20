/**
 * Local-checkout environment resolution: which backend, auth-web and client a
 * checkout of this monorepo serves, read from its own `apps/backender` env.
 *
 * A LEAF module on purpose: it imports nothing else from this package (the
 * `TqConfig` import is type-only and erased), so both `config.ts` and
 * `token-store.ts` can use it without the import cycle `token-store.ts` exists
 * to avoid (`config.ts` imports `token-store.ts`). internal moved these
 * helpers here from `config.ts`, which still re-exports the public ones.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { TqConfig } from './config.js';

/**
 * Returns true when running inside a test runner (Vitest, Jest, etc.).
 */
export function isTestEnv(): boolean {
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
export function isLocalTlsMode(): boolean {
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
  // WHATWG also reads `\\` as `/` for http(s), so `http:\\host\\x` would
  // slip past the raw-path check below; and any `@` is userinfo, which never
  // belongs here (an EMPTY one, `http://@host`, parses to no credentials and
  // would otherwise pass the check further down). internal review F-001.
  if (/[\\@]/.test(trimmed)) return undefined;
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

export const LOCAL_HTTP: TqConfig = {
  environment: 'local',
  apiUrl: 'http://localhost:8080',
  authUrl: 'http://localhost:3021',
  clientUrl: 'http://localhost:3020',
  oauthClientId: '2',
};

export const LOCAL_HTTPS: TqConfig = {
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

/** Env files the backender reads, in its own precedence order. */
const BACKENDER_ENV_FILES = ['.env.worktree', '.env'] as const;

/**
 * The checkout a reader belongs to: the nearest ancestor of `start` with an
 * `apps/backender` env file, or undefined outside any checkout (e.g. the
 * published CLI run in an unrelated project).
 *
 * Walks up like `devTlsFromBackenderEnv`, so a reader started from an app
 * subdirectory still finds its checkout. The stdio MCP servers are started
 * from the checkout root (`./plugins/...` in `.mcp.json`) and the hooks from
 * `$CLAUDE_PROJECT_DIR`, so for them `start` IS the session's checkout.
 */
export function findLocalCheckoutRoot(start: string): string | undefined {
  let dir = path.resolve(start);
  for (let i = 0; i < 10; i++) {
    const hasEnv = BACKENDER_ENV_FILES.some((name) =>
      fs.existsSync(path.join(dir, 'apps', 'backender', name)),
    );
    if (hasEnv) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/** The backend, auth-web and client URLs one checkout serves. */
export interface LocalCheckoutUrls {
  root: string;
  apiUrl: string;
  authUrl: string;
  clientUrl: string;
}

/**
 * Resolve the `local` environment for the checkout containing `start`.
 *
 * `local` means "the backend of the checkout I am working in". `tq:env local`
 * still writes the URLs it resolved into the machine-global
 * `~/.tq/config.json` (older readers and the published CLI read them), but
 * every reader in this package re-resolves `local` HERE, against its own
 * checkout, so running `tq:env local` in one worktree no longer re-points the
 * sessions of every other checkout on the machine. internal.
 *
 * Per checkout:
 *   - all three URLs come from `apps/backender`'s env (`API_BASE_URL`,
 *     `AUTH_URL`, `CLIENT_APP_URL`), which `worktree-add.sh` writes together
 *     when it allocates a worktree's port block — resolving only the API left
 *     `tq:login` opening another checkout's auth-web;
 *   - `.env.worktree` before `.env`, the order `apps/backender/src/env.ts`
 *     loads them, and the first file that HAS a key decides
 *     (`resolveOriginFromEnvFiles`);
 *   - only a bare origin is accepted (`parseLocalBackenderOrigin`): the main
 *     checkout under DEV_TLS carries the SPA's `/api` proxy URL there, which
 *     must fall back to the preset, not be dialled (internal);
 *   - otherwise the local preset, HTTPS when this checkout runs DEV_TLS.
 *
 * This is deliberately STRICTER than `scripts/setup-mcp.ts`'s
 * `resolveLocalLevrUrl`, which takes any `https?://` value: the levr MCP
 * endpoint is legitimately reached THROUGH the SPA proxy, so it wants the
 * `/api` suffix this must reject. Not drift to reconcile — "fixing" it
 * reintroduces internal. internal.
 *
 * Returns undefined outside a checkout, so the caller keeps the stored URLs.
 */
export function resolveLocalCheckout(
  start: string = process.cwd(),
): LocalCheckoutUrls | undefined {
  const root = findLocalCheckoutRoot(start);
  if (!root) return undefined;

  // Per file, so one unreadable file does not discard the other — the
  // backender would still read it.
  const files = BACKENDER_ENV_FILES.map((name) => {
    const envPath = path.join(root, 'apps', 'backender', name);
    try {
      return fs.existsSync(envPath)
        ? fs.readFileSync(envPath, 'utf8')
        : undefined;
    } catch {
      return undefined;
    }
  });

  const preset = checkoutUsesTls(files) ? LOCAL_HTTPS : LOCAL_HTTP;
  return {
    root,
    apiUrl: resolveOriginFromEnvFiles('API_BASE_URL', files) ?? preset.apiUrl,
    authUrl: resolveOriginFromEnvFiles('AUTH_URL', files) ?? preset.authUrl,
    clientUrl:
      resolveOriginFromEnvFiles('CLIENT_APP_URL', files) ?? preset.clientUrl,
  };
}

/**
 * `isLocalTlsMode()` for an explicit checkout's env files rather than a cwd
 * walk: tests first, then the `DEV_TLS` env var, then the first file that
 * sets `DEV_TLS`. Same order, same parser.
 */
function checkoutUsesTls(files: readonly (string | undefined)[]): boolean {
  if (isTestEnv()) return false;
  if (process.env.DEV_TLS === 'true') return true;
  if (process.env.DEV_TLS === 'false') return false;
  for (const contents of files) {
    if (contents === undefined) continue;
    const parsed = parseDevTls(contents);
    if (parsed !== undefined) return parsed;
  }
  return false;
}
