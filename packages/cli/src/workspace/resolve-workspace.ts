import { authGetSitesV1 } from '@levr/sdk';
import type { SitesResponseDto } from '@levr/sdk';
import {
  loadWorkspace,
  saveWorkspace,
  clearWorkspace,
} from './workspace-store.js';

export interface WorkspaceResult {
  workspaceId: string;
  source: 'flag' | 'env' | 'cache' | 'auto';
}

type Site = SitesResponseDto['sites'][number];

async function fetchSites(): Promise<Site[]> {
  try {
    const result = await authGetSitesV1();
    if (result.error) {
      throw new Error(
        "Failed to list workspaces. Check your connection and run 'levr auth login'.",
      );
    }
    return (result.data as SitesResponseDto).sites;
  } catch (err) {
    if (err instanceof Error && err.message.includes('Failed to list')) {
      throw err;
    }
    throw new Error(
      "Failed to list workspaces. Check your connection and run 'levr auth login'.",
    );
  }
}

export interface AutoSelectResult {
  kind: 'single';
  workspaceId: string;
  workspaceName: string;
}

export interface AutoSelectMultiple {
  kind: 'multiple';
  count: number;
}

export interface AutoSelectNone {
  kind: 'none';
}

export type AutoSelectOutcome =
  | AutoSelectResult
  | AutoSelectMultiple
  | AutoSelectNone;

/**
 * Auto-select workspace after login.
 * - Single workspace: persists and returns it.
 * - Multiple: returns count (caller shows hint).
 * - None/error: returns 'none' (non-fatal).
 */
export async function autoSelectWorkspace(): Promise<AutoSelectOutcome> {
  let sites: Site[];
  try {
    sites = await fetchSites();
  } catch {
    return { kind: 'none' };
  }

  if (sites.length === 1) {
    const ws = sites[0]!;
    saveWorkspace(ws.workspace_id);
    return {
      kind: 'single',
      workspaceId: ws.workspace_id,
      workspaceName: ws.workspace_name,
    };
  }

  if (sites.length > 1) {
    return { kind: 'multiple', count: sites.length };
  }

  return { kind: 'none' };
}

export async function resolveWorkspace(
  flagValue?: string,
): Promise<WorkspaceResult> {
  let sites: Site[] | null = null;
  const getSites = async () => {
    if (!sites) sites = await fetchSites();
    return sites;
  };

  // 1. --workspace-id flag (check flagValue directly)
  if (flagValue) {
    const s = await getSites();
    if (!s.some((site) => site.workspace_id === flagValue)) {
      throw new Error(
        `Workspace ${flagValue} not found. Run 'levr workspace list'.`,
      );
    }
    return { workspaceId: flagValue, source: 'flag' };
  }

  // 2. LEVR_WORKSPACE_ID env (read process.env directly — NOT via merged utility)
  const envWs = process.env['LEVR_WORKSPACE_ID'];
  if (envWs) {
    const s = await getSites();
    if (!s.some((site) => site.workspace_id === envWs)) {
      throw new Error(
        `LEVR_WORKSPACE_ID ${envWs} not found. Run 'levr workspace list'.`,
      );
    }
    return { workspaceId: envWs, source: 'env' };
  }

  // 3. Disk cache (validate cached ID; clear stale cache on miss)
  const cached = loadWorkspace();
  if (cached) {
    const s = await getSites();
    if (s.some((site) => site.workspace_id === cached)) {
      return { workspaceId: cached, source: 'cache' };
    }
    clearWorkspace(); // stale cache — fall through
  }

  // 4. Auto-select (single workspace) — reuses cached getSites()
  const s = await getSites();
  if (s.length === 0) {
    throw new Error('No workspaces available.');
  }
  if (s.length === 1) {
    const single = s[0]!;
    saveWorkspace(single.workspace_id);
    return { workspaceId: single.workspace_id, source: 'auto' };
  }

  // 5. Error with list (multiple workspaces)
  const maxList = 10;
  const list = s
    .slice(0, maxList)
    .map((x) => `  - ${x.workspace_name} (${x.workspace_id})`)
    .join('\n');
  const overflow =
    s.length > maxList ? `\n  ... and ${s.length - maxList} more` : '';
  throw new Error(
    `Multiple workspaces. Select one:\n${list}${overflow}\n\nRun: levr workspace select <id>`,
  );
}
