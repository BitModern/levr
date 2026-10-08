/**
 * Resolve `levr mcp add --workspace <name|url_key>` to one of the user's
 * workspaces (internal D6, R1 K-003).
 *
 * Side-effect free on purpose: it reads only the list it is handed. It never
 * reads the workspace the CLI has selected (environment or disk) and never
 * writes it, so adding an MCP entry for a workspace cannot change which
 * workspace `levr push` and friends use.
 */
import type { SitesResponseDto } from '@levr-one/sdk';

export type WorkspaceSite = SitesResponseDto['sites'][number];

/** `  - Name (url_key)` per workspace, for error messages and hints. */
export function describeWorkspaces(sites: readonly WorkspaceSite[]): string {
  return sites
    .map((s) => `  - ${s.workspace_name} (${s.workspace_url_key})`)
    .join('\n');
}

/**
 * An exact `url_key` wins; otherwise a case-insensitive name that matches
 * exactly one workspace. Anything else throws, listing the choices.
 */
export function findWorkspaceByKeyOrName(
  sites: readonly WorkspaceSite[],
  input: string,
): WorkspaceSite {
  const wanted = input.trim();
  if (!wanted) {
    throw new Error('--workspace needs a workspace name or url_key.');
  }
  const byKey = sites.find((s) => s.workspace_url_key === wanted);
  if (byKey) return byKey;

  const lower = wanted.toLowerCase();
  const byName = sites.filter((s) => s.workspace_name.toLowerCase() === lower);
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) {
    throw new Error(
      `"${wanted}" names more than one workspace. Pass its url_key instead:\n` +
        describeWorkspaces(byName),
    );
  }
  if (sites.length === 0) {
    throw new Error('Your account has no workspaces.');
  }
  throw new Error(
    `No workspace "${wanted}" in your account. Choose one of:\n` +
      describeWorkspaces(sites),
  );
}
