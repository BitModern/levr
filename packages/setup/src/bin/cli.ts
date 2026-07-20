#!/usr/bin/env node
import { run } from '@stricli/core';
import { app } from '../app';
import { buildContext } from '../context';

// The OAuth flow leaves a pooled keep-alive socket (token-exchange + /v1/auth/sites
// fetches) that keeps the event loop alive, so the process would otherwise hang —
// we must exit explicitly. But a bare process.exit() can DROP buffered output when
// stdout/stderr is a pipe (writes are async on Linux — e.g. `npx @levr-one/setup |
// tee`, CI log capture). Flush both streams first (a zero-length write's callback
// fires once the queue ahead of it has drained), then exit with the code stricli set.
const flush = (stream: NodeJS.WriteStream): Promise<void> =>
  new Promise((resolve) => stream.write('', () => resolve()));

// The flush+exit MUST run even when `run()` rejects: without it a thrown error
// skips the explicit exit and the keep-alive socket above can hang the CLI
// indefinitely. `finally` guarantees we always drain and terminate.
let exitCode = 0;
try {
  await run(app, process.argv.slice(2), buildContext(process));
  exitCode = typeof process.exitCode === 'number' ? process.exitCode : 0;
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  exitCode = 1;
} finally {
  await Promise.all([flush(process.stdout), flush(process.stderr)]);
  process.exit(exitCode);
}
