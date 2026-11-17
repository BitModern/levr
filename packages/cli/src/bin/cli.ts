#!/usr/bin/env node
import { run } from '@stricli/core';
import { buildContext } from '../context.js';
import { app } from '../app.js';
import { proposeCompletionLines } from '../completion.js';
import { loadEnvFile } from '../utils/load-env-file.js';
import {
  isBareInvocation,
  shouldRunOnboarding,
} from '../onboarding/interactive.js';

const argv = process.argv.slice(2);

// Before ANY command runs, and before anything reads process.env — every read
// in this CLI is inside a function, so this body statement beats all of them.
//
// Only `LEVR_*` keys are taken, and only when not already set: a real
// environment variable always wins, so `LEVR_URL=… levr push` still overrides
// the file and CI variables are never shadowed by a checked-in `.env`.
//
// F-006: this THROWS on a missing `LEVR_ENV_FILE`, and as a bare top-level
// statement that killed the process before the `__complete` branch below —
// so a stale `LEVR_ENV_FILE` in a shell profile made every command AND every
// TAB PRESS dump a Node stack trace through bundled internals. Completion in
// particular must never crash: it runs on a keystroke, and its output is
// consumed by the shell.
try {
  loadEnvFile();
} catch (err) {
  if (argv[0] !== '__complete') {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
  // Completion: proceed with whatever the real environment already holds.
}

// Shell tab-completion entrypoint. The scripts printed by
// `levr completion bash|zsh` register a shell function that invokes
// `levr __complete <words…>` on each TAB. We handle it HERE, on the single
// `levr` bin, instead of shipping a separate completion binary — a second
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
} else if (
  argv.length === 0 &&
  shouldRunOnboarding({
    argv,
    env: process.env,
    stdinIsTTY: process.stdin.isTTY,
    stdoutIsTTY: process.stdout.isTTY,
  })
) {
  // internal (plan internal D9): a bare `levr` at a terminal runs the
  // onboarding wizard. Intercepted before Stricli, like `__complete`. A
  // non-TTY stdin or stdout, CI, LEVR_NO_PROMPT or --non-interactive falls
  // through to the help below, exactly as before. Loaded lazily so no other
  // command pays for the wizard's imports.
  const { liveOnboardingDeps, runOnboarding } = await import(
    '../onboarding/onboarding-flow.js'
  );
  process.exitCode = await runOnboarding(await liveOnboardingDeps(process));
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

  // `levr --non-interactive` alone is a bare `levr` that must not prompt: it
  // prints the same help a bare `levr` prints without a terminal.
  const stricliArgv = isBareInvocation(argv) ? [] : argv;
  await run(
    app,
    stricliArgv,
    buildContext(processProxy as unknown as NodeJS.Process),
  );

  if (savedExitCode !== undefined) {
    process.exitCode = savedExitCode;
  }
}
