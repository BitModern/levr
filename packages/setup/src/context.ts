import type { CommandContext } from '@stricli/core';
import type { StricliAutoCompleteContext } from '@stricli/auto-complete';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { realSetupPorts, type SetupPorts } from './app';

export interface LocalContext
  extends CommandContext,
    StricliAutoCompleteContext {
  readonly process: NodeJS.Process;
  /** Injectable auth/workspace ports — real by default, faked in tests (R2F9). */
  readonly ports: SetupPorts;
}

export function buildContext(
  process: NodeJS.Process,
  ports: SetupPorts = realSetupPorts,
): LocalContext {
  return {
    process,
    os,
    fs,
    path,
    ports,
  };
}
