#!/usr/bin/env node
import { proposeCompletions } from '@stricli/core';
import { app } from '../app';
import { buildContext } from '../context';

const inputs = process.argv.slice(3);
if (process.env['COMP_LINE']?.endsWith(' ')) {
  inputs.push('');
}

try {
  for (const { completion } of await proposeCompletions(
    app,
    inputs,
    buildContext(process),
  )) {
    process.stdout.write(`${completion}\n`);
  }
} catch {
  // Completions are best-effort; never fail the shell.
}
