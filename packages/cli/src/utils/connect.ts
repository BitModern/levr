import { client } from '@levr/sdk';
import type { LocalContext } from '../context.js';
import { resolveToken } from '../auth/resolve-token.js';
import { resolveWorkspace } from '../workspace/resolve-workspace.js';
import { configureClient } from './sdk-client.js';

/**
 * Authenticate the SDK client for a command (internal): resolve the token,
 * and for a JWT the workspace. Reports the failure and sets exit code 1;
 * returns false when the command must stop.
 */
export async function connect(
  ctx: LocalContext,
  workspaceIdFlag?: string,
): Promise<boolean> {
  let auth;
  try {
    auth = await resolveToken();
  } catch (err) {
    ctx.logger.error(
      err instanceof Error ? err.message : 'Authentication failed.',
    );
    ctx.process.exitCode = 1;
    return false;
  }
  configureClient(auth);
  if (auth.type === 'jwt') {
    try {
      const ws = await resolveWorkspace(workspaceIdFlag);
      client.setConfig({ ...client.getConfig(), workspaceId: ws.workspaceId });
    } catch (err) {
      ctx.logger.error(
        err instanceof Error ? err.message : 'Workspace resolution failed.',
      );
      ctx.process.exitCode = 1;
      return false;
    }
  }
  return true;
}
