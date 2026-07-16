#!/usr/bin/env node
import { run } from '@stricli/core';
import { app } from '../app';
import { buildContext } from '../context';

await run(app, process.argv.slice(2), buildContext(process));

// The OAuth flow leaves a pooled keep-alive socket (from the token-exchange and
// /v1/auth/sites fetches) that keeps the event loop alive, so the process would
// otherwise hang after finishing. All work is done and output is flushed by the
// time run() resolves, so exit deterministically with the code stricli set —
// mirrors the internal `tq-oauth login` command's process.exit.
process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0);
