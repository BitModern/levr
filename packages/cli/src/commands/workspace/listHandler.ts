import { authGetSitesV1 } from '@levr/sdk';
import type { SitesResponseDto } from '@levr/sdk';
import type { LocalContext } from '../../context.js';
import { resolveToken } from '../../auth/resolve-token.js';
import { configureClient } from '../../utils/sdk-client.js';
import { loadWorkspace } from '../../workspace/workspace-store.js';

export async function listHandler(this: LocalContext): Promise<void> {
  // Auth guard
  let auth;
  try {
    auth = await resolveToken();
  } catch (err) {
    // Forward resolveToken's message — it distinguishes "no credentials"
    // from a cross-environment credentials mismatch (internal).
    this.logger.error(
      err instanceof Error
        ? err.message
        : "Not authenticated. Run 'levr auth login' first.",
    );
    this.process.exitCode = 1;
    return;
  }

  if (auth.type === 'pat') {
    this.logger.error(
      "Workspace listing requires JWT auth. Run 'levr auth login'.",
    );
    this.process.exitCode = 1;
    return;
  }

  configureClient(auth);

  // Fetch workspaces
  const result = await authGetSitesV1();
  if (result.error) {
    this.logger.error('Failed to list workspaces.');
    this.process.exitCode = 1;
    return;
  }

  const data = result.data as SitesResponseDto;
  printSites(this, data.sites);
}

/**
 * Print the workspace list with the current-workspace indicator. Shared
 * with `levr init` (internal).
 */
export function printSites(
  ctx: LocalContext,
  sites: SitesResponseDto['sites'],
): void {
  if (sites.length === 0) {
    ctx.logger.info('No workspaces available.');
    return;
  }

  // Get current workspace for indicator
  const currentWs = loadWorkspace();

  ctx.process.stdout.write('\nWorkspaces:\n\n');
  for (const site of sites) {
    const indicator = site.workspace_id === currentWs ? ' *' : '';
    ctx.process.stdout.write(
      `  ${site.workspace_name} (${site.workspace_id}) [${site.role}]${indicator}\n`,
    );
  }
  ctx.process.stdout.write('\n');
}
