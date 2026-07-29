import type { CommandContext } from '@stricli/core';
import { Logger } from './utils/logger.js';

export interface LocalContext extends CommandContext {
  readonly process: NodeJS.Process;
  readonly logger: Logger;
}

export function buildContext(process: NodeJS.Process): LocalContext {
  return {
    process,
    logger: new Logger({
      verbose: false,
      stdout: process.stdout,
      stderr: process.stderr,
    }),
  };
}
