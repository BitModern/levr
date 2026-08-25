/**
 * Argument parsing for `tq:logout` (internal D1), kept pure so it can be
 * tested — `cli.ts` ends in a self-executing `switch`, so importing it from a
 * test would run a CLI command against the developer's real `~/.tq`.
 *
 * ## The defect this exists to prevent
 *
 * The first cut matched flags with `args.indexOf('--backend')`, which sees
 * only the space-separated form. `--backend=<url>` therefore matched nothing,
 * fell past every branch, and returned the CONFIGURED backend — clearing a
 * backend the operator had not named, printing success, and exiting 0. An
 * unrecognised flag did the same, because nothing rejected leftovers.
 *
 * That is the whole-file-wipe failure mode reached through argument parsing
 * rather than through a fallback, so this fails CLOSED: anything not
 * understood is an error, never a default.
 */

/** What the operator asked `logout` to clear. */
export type LogoutRequest =
  | { kind: 'all' }
  | { kind: 'backend'; url: string }
  | { kind: 'env'; env: 'local' | 'staging' | 'production' }
  /** No target named — the configured backend, as before. */
  | { kind: 'configured' }
  | { kind: 'error'; message: string };

const ENV_NAMES = ['local', 'staging', 'production'] as const;
const USAGE =
  'Usage: tq-oauth logout [--backend <url> | --env <local|staging|production> | --all]';

/** Both `--flag value` and `--flag=value`. */
function readFlag(
  args: string[],
  flag: string,
): { present: boolean; value: string } {
  const inline = args.find((a) => a.startsWith(`${flag}=`));
  if (inline !== undefined) {
    return { present: true, value: inline.slice(flag.length + 1) };
  }
  const i = args.indexOf(flag);
  if (i === -1) return { present: false, value: '' };
  const next = args[i + 1];
  return {
    present: true,
    value: next && !next.startsWith('--') ? next : '',
  };
}

/** Every token the known flags account for, so leftovers can be rejected. */
function consumedTokens(args: string[]): Set<string> {
  const consumed = new Set<string>();
  for (const flag of ['--backend', '--env', '--all']) {
    const inline = args.find((a) => a.startsWith(`${flag}=`));
    if (inline) consumed.add(inline);
    const i = args.indexOf(flag);
    if (i !== -1) {
      consumed.add(args[i]);
      const next = args[i + 1];
      if (flag !== '--all' && next && !next.startsWith('--'))
        consumed.add(next);
    }
  }
  return consumed;
}

export function parseLogoutArgs(args: string[]): LogoutRequest {
  const consumed = consumedTokens(args);
  const unknown = args.filter((a) => !consumed.has(a));
  if (unknown.length > 0) {
    return {
      kind: 'error',
      message:
        `Unknown argument${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}\n` +
        USAGE,
    };
  }

  const backend = readFlag(args, '--backend');
  const env = readFlag(args, '--env');
  const all = args.includes('--all');

  // Two targets is an operator mistake, and picking one silently is exactly
  // the class of bug this module exists to prevent.
  if ([backend.present, env.present, all].filter(Boolean).length > 1) {
    return {
      kind: 'error',
      message: `Pass only one of --backend, --env, --all\n${USAGE}`,
    };
  }

  if (all) return { kind: 'all' };

  if (backend.present) {
    if (!backend.value) {
      return { kind: 'error', message: `--backend requires a url\n${USAGE}` };
    }
    if (!/^https?:\/\//i.test(backend.value.trim())) {
      return {
        kind: 'error',
        message:
          `Not a backend url: "${backend.value}" — expected an http(s) origin, ` +
          'e.g. http://localhost:8180',
      };
    }
    return { kind: 'backend', url: backend.value.trim().replace(/\/+$/, '') };
  }

  if (env.present) {
    const match = ENV_NAMES.find((n) => n === env.value);
    if (!match) {
      return {
        kind: 'error',
        message: `Unknown environment: "${env.value}" — expected ${ENV_NAMES.join(', ')}`,
      };
    }
    return { kind: 'env', env: match };
  }

  return { kind: 'configured' };
}
