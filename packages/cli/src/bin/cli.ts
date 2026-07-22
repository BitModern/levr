#!/usr/bin/env node
import { run } from '@stricli/core';
import { buildContext } from '../context.js';
import { app } from '../app.js';
import { proposeCompletionLines } from '../completion.js';

const argv = process.argv.slice(2);

// Shell tab-completion entrypoint. `levr install` registers a bash function that
// invokes `levr __complete <COMP_LINE>` on each TAB. We handle it HERE, on the
// single `levr` bin, instead of shipping a separate completion binary — a second
// bin would make `npx @levr-one/cli …` unable to auto-resolve an executable.
// It's intercepted before Stricli's run() so an incomplete `--flag` in the line
// being completed is never parsed as a real argument.
if (argv[0] === '__complete') {
  for (const line of await proposeCompletionLines(
    argv,
    process.env['COMP_LINE'],
    buildContext(process),
  )) {
    process.stdout.write(`${line}\n`);
  }
} else {
  // Stricli's run() overwrites process.exitCode with its own ExitCode
  // after the handler completes, discarding any exitCode set by handlers.
  // Proxy process to capture non-zero exitCode before Stricli resets it.
  let savedExitCode: number | undefined;
  const processProxy = new Proxy(process, {
    set(target, prop, value: unknown) {
      if (prop === 'exitCode' && typeof value === 'number' && value !== 0) {
        savedExitCode = value;
      }
      return Reflect.set(target, prop, value);
    },
  });

  await run(app, argv, buildContext(processProxy as unknown as NodeJS.Process));

  if (savedExitCode !== undefined) {
    process.exitCode = savedExitCode;
  }
}
