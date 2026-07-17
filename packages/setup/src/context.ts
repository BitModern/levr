import type { CommandContext } from '@stricli/core';
import { realSetupPorts, type SetupPorts } from './app';

export interface LocalContext extends CommandContext {
  readonly process: NodeJS.Process;
  /** Injectable auth/workspace ports — real by default, faked in tests (R2F9). */
  readonly ports: SetupPorts;
}

export function buildContext(
  process: NodeJS.Process,
  ports: SetupPorts = realSetupPorts,
): LocalContext {
  return { process, ports };
}
