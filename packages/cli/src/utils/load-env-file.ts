import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { parse } from 'dotenv';

/**
 * Only `LEVR_`-prefixed keys are taken from a `.env` file.
 *
 * `dotenv.config()` would merge EVERY key into `process.env`, which is more
 * than this CLI needs and more than a user consents to by running it in a
 * directory. A checkout's `.env` routinely carries things that change how Node
 * itself behaves — `NODE_TLS_REJECT_UNAUTHORIZED`, `HTTP_PROXY`,
 * `NODE_OPTIONS` — and none of them are ours to apply. Parsing and filtering
 * means an unrelated project's `.env` cannot reach this process at all; only
 * keys deliberately namespaced for this CLI have any effect.
 */
const LEVR_KEY = /^LEVR_[A-Z0-9_]*$/;

/**
 * Where to look. `LEVR_ENV_FILE` names an explicit file (absolute, or relative
 * to cwd); otherwise `.env` in the working directory.
 */
function envFilePath(cwd: string, env: NodeJS.ProcessEnv): string {
  const explicit = env['LEVR_ENV_FILE'];
  if (explicit) {
    return isAbsolute(explicit) ? explicit : resolve(cwd, explicit);
  }
  return resolve(cwd, '.env');
}

export interface LoadEnvFileResult {
  /** The file that was read, or null when there was nothing to read. */
  path: string | null;
  /** `LEVR_*` keys actually applied — excludes any already set. */
  applied: string[];
}

/**
 * Merge `LEVR_*` variables from a `.env` file into `process.env`.
 *
 * A real environment variable ALWAYS wins: an already-set key is left alone,
 * so `LEVR_URL=… levr push` still overrides the file, and CI variables are
 * never shadowed by a checked-in `.env`. This matches dotenv's own precedence
 * and is the behaviour anyone who has used a `.env` expects — the file is a
 * default, not an override.
 *
 * Missing or unreadable files are not an error: `.env` is optional by nature,
 * and a CLI that refused to start because a directory has no `.env` would be
 * broken for every user who does not use one. An explicitly requested
 * `LEVR_ENV_FILE` that does not exist IS reported, because naming a file and
 * getting silence is the one case where quiet failure hides a real mistake.
 */
export function loadEnvFile(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): LoadEnvFileResult {
  const path = envFilePath(cwd, env);
  const explicitlyRequested = Boolean(env['LEVR_ENV_FILE']);

  if (!existsSync(path)) {
    if (explicitlyRequested) {
      throw new Error(
        `LEVR_ENV_FILE points at "${path}", which does not exist.`,
      );
    }
    return { path: null, applied: [] };
  }

  let parsed: Record<string, string>;
  try {
    parsed = parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (explicitlyRequested) throw error;
    // An unreadable incidental `.env` (permissions, a directory of that name)
    // must not stop the command the user actually asked for.
    return { path: null, applied: [] };
  }

  const applied: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (!LEVR_KEY.test(key)) continue;
    // F-007: `!== undefined` is the wrong test. Every consumer of these
    // variables gates on TRUTHINESS (`getApiUrl`, `getPatToken`, `getTeamId`
    // all use `||`), so an exported-but-empty `LEVR_URL` is simultaneously
    // "set" here and "unset" there — the .env fallback is skipped and the
    // command silently targets the production default. A CI template filling
    // a variable from an unset secret produces exactly that.
    if (env[key] !== undefined && env[key] !== '') continue; // real env wins
    env[key] = value;
    applied.push(key);
  }
  return { path, applied };
}
