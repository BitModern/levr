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
  } catch {
    this.logger.error("Not authenticated. Run 'levr auth login' first.");
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
  const sites = data.sites;

  if (sites.length === 0) {
    this.logger.info('No workspaces available.');
    return;
  }

  // Get current workspace for indicator
  const currentWs = loadWorkspace();

  this.process.stdout.write('\nWorkspaces:\n\n');
  for (const site of sites) {
    const indicator = site.workspace_id === currentWs ? ' *' : '';
    this.process.stdout.write(
      `  ${site.workspace_name} (${site.workspace_id}) [${site.role}]${indicator}\n`,
    );
  }
  this.process.stdout.write('\n');
}
