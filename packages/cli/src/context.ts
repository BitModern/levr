import type { CommandContext } from '@stricli/core';
import type { StricliAutoCompleteContext } from '@stricli/auto-complete';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Logger } from './utils/logger.js';

export interface LocalContext
  extends CommandContext,
    StricliAutoCompleteContext {
  readonly process: NodeJS.Process;
  readonly logger: Logger;
}

export function buildContext(process: NodeJS.Process): LocalContext {
  return {
    process,
    os,
    fs,
    path,
    logger: new Logger({
      verbose: false,
      stdout: process.stdout,
      stderr: process.stderr,
    }),
  };
}
