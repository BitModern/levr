import { authGetSitesV1 } from '@levr/sdk';
import type { SitesResponseDto } from '@levr/sdk';
import type { LocalContext } from '../../context.js';
import { resolveToken } from '../../auth/resolve-token.js';
import { configureClient } from '../../utils/sdk-client.js';
import { saveWorkspace } from '../../workspace/workspace-store.js';

export async function selectHandler(
  this: LocalContext,
  _flags: Record<string, never>,
  workspaceId: string,
): Promise<void> {
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
      "Workspace selection requires JWT auth. Run 'levr auth login'.",
    );
    this.process.exitCode = 1;
    return;
  }

  configureClient(auth);

  // Validate workspace ID against sites list
  const result = await authGetSitesV1();
  if (result.error) {
    this.logger.error('Failed to list workspaces.');
    this.process.exitCode = 1;
    return;
  }

  const data = result.data as SitesResponseDto;
  const site = data.sites.find((s) => s.workspace_id === workspaceId);

  if (!site) {
    this.logger.error(
      `Workspace ${workspaceId} not found. Run 'levr workspace list'.`,
    );
    this.process.exitCode = 1;
    return;
  }

  saveWorkspace(workspaceId);
  this.logger.success(
    `Workspace set to ${site.workspace_name} (${site.workspace_id})`,
  );
}
