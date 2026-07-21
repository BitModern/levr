#!/usr/bin/env node
import { run } from '@stricli/core';
import { buildContext } from '../context.js';
import { app } from '../app.js';

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

await run(
  app,
  process.argv.slice(2),
  buildContext(processProxy as unknown as NodeJS.Process),
);

if (savedExitCode !== undefined) {
  process.exitCode = savedExitCode;
}
