/**
 * Turning a failed `fetch` into something an operator can act on (internal D5).
 *
 * Node's fetch reports every transport failure as the same opaque
 * `TypeError: fetch failed`, with the real reason buried in `.cause`. Printed
 * raw by the CLI's error handlers it named no URL and gave no reason:
 *
 *   $ TQ_BACKEND_URL=http://localhost:9999 yarn tq:login
 *   Error: TypeError: fetch failed
 *
 * In a worktree that is nearly always "the backend is not running" — but it
 * reads as a broken CLI, so the operator debugs the CLI. The exit code was
 * already correct; only the message was useless.
 */

/** Node attaches the real transport failure here. */
interface ErrnoLike {
  code?: unknown;
  message?: unknown;
  cause?: unknown;
}

/**
 * Walk the `cause` chain for a syscall-level error code.
 *
 * Depth-bounded: a cause chain is nominally short, but it is attacker- and
 * bug-reachable data, and a cyclic `cause` would hang the process inside an
 * error handler — the one place with nothing left to catch it.
 */
function errorCodeOf(err: unknown, depth = 0): string | undefined {
  if (depth > 5 || err === null || typeof err !== 'object') return undefined;
  const { code, cause } = err as ErrnoLike;
  if (typeof code === 'string' && code) return code;
  return errorCodeOf(cause, depth + 1);
}

/**
 * A one-line explanation when `err` is a transport failure, otherwise
 * undefined so the caller falls back to printing the error itself.
 *
 * Deliberately narrow: only codes that genuinely mean "nothing answered at
 * this address" are claimed. Reporting an unrelated failure as "backend not
 * running" would send the operator to start a server that is already up.
 */
export function describeConnectionError(
  err: unknown,
  apiUrl: string,
): string | undefined {
  const code = errorCodeOf(err);
  switch (code) {
    case 'ECONNREFUSED':
    case 'ERR_SOCKET_CONNECTION_TIMEOUT':
    case 'ETIMEDOUT':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return (
        `No backend is listening at ${apiUrl} — it does not exist or is not running.\n` +
        'Start it, or point at another environment with `yarn tq:env <local|staging|production>`.'
      );
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return (
        `Cannot resolve the host for ${apiUrl} — the address does not exist.\n` +
        'Check `yarn tq:env` for the configured backend.'
      );
    default:
      return undefined;
  }
}
