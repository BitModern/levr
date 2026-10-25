import { authGetSitesV1 } from "./sdk-client-CSy2LOEh.js";
import { clearWorkspace, loadWorkspace, saveWorkspace } from "./workspace-store-BJyB_WEG.js";

//#region src/workspace/resolve-workspace.ts
async function fetchSites() {
	try {
		const result = await authGetSitesV1();
		if (result.error) throw new Error("Failed to list workspaces. Check your connection and run 'levr auth login'.");
		return result.data.sites;
	} catch (err) {
		if (err instanceof Error && err.message.includes("Failed to list")) throw err;
		throw new Error("Failed to list workspaces. Check your connection and run 'levr auth login'.");
	}
}
/**
* Auto-select workspace after login.
* - Single workspace: persists and returns it.
* - Multiple: returns count (caller shows hint).
* - None/error: returns 'none' (non-fatal).
*/
async function autoSelectWorkspace() {
	let sites;
	try {
		sites = await fetchSites();
	} catch {
		return { kind: "none" };
	}
	if (sites.length === 1) {
		const ws = sites[0];
		saveWorkspace(ws.workspace_id);
		return {
			kind: "single",
			workspaceId: ws.workspace_id,
			workspaceName: ws.workspace_name
		};
	}
	if (sites.length > 1) return {
		kind: "multiple",
		count: sites.length
	};
	return { kind: "none" };
}
async function resolveWorkspace(flagValue, options = {}) {
	const persist = options.persist ?? true;
	let sites = null;
	const getSites = async () => {
		if (!sites) sites = await fetchSites();
		return sites;
	};
	if (flagValue) {
		if (!(await getSites()).some((site) => site.workspace_id === flagValue)) throw new Error(`Workspace ${flagValue} not found. Run 'levr workspace list'.`);
		return {
			workspaceId: flagValue,
			source: "flag"
		};
	}
	const envWs = process.env["LEVR_WORKSPACE_ID"];
	if (envWs) {
		if (!(await getSites()).some((site) => site.workspace_id === envWs)) throw new Error(`LEVR_WORKSPACE_ID ${envWs} not found. Run 'levr workspace list'.`);
		return {
			workspaceId: envWs,
			source: "env"
		};
	}
	const cached = persist ? loadWorkspace() : null;
	if (cached) {
		if ((await getSites()).some((site) => site.workspace_id === cached)) return {
			workspaceId: cached,
			source: "cache"
		};
		clearWorkspace();
	}
	const s = await getSites();
	if (s.length === 0) throw new Error("No workspaces available.");
	if (s.length === 1) {
		const single = s[0];
		if (persist) saveWorkspace(single.workspace_id);
		return {
			workspaceId: single.workspace_id,
			source: "auto"
		};
	}
	const maxList = 10;
	const list = s.slice(0, maxList).map((x) => `  - ${x.workspace_name} (${x.workspace_id})`).join("\n");
	const overflow = s.length > maxList ? `\n  ... and ${s.length - maxList} more` : "";
	throw new Error(`Multiple workspaces. Select one:\n${list}${overflow}\n\nRun: levr workspace select <id>`);
}
/**
* The workspace a command runs in, for whichever credential it holds —
* [issue:ENG-6068].
*
* A JWT is not bound to a workspace, so one is resolved the usual way: the
* flag, `LEVR_WORKSPACE_ID`, the cached selection, then auto-select, each
* validated against the sites the account can see.
*
* A personal access token IS bound to one workspace, and the server scopes
* every request by it. An explicit `--workspace-id` or `LEVR_WORKSPACE_ID` is
* still sent as `Workspace-Id` — the server refuses one that is not the
* token's — but nothing is looked up or cached, and with neither set the
* answer is null: the token's own workspace applies. Until ENG-6068 both were
* silently dropped for every `LEVR_TOKEN`, including an OAuth access token,
* which was classified as a PAT by where it came from and has no workspace to
* fall back to. An OAuth token from LEVR_TOKEN is not the login session, so
* the saved workspace choice is left alone for it (`persist: false`).
*/
async function resolveWorkspaceFor(auth, flagValue) {
	if (auth.type === "jwt") return resolveWorkspace(flagValue, { persist: auth.source !== "env" });
	if (flagValue) return {
		workspaceId: flagValue,
		source: "flag"
	};
	const envWs = process.env["LEVR_WORKSPACE_ID"];
	if (envWs) return {
		workspaceId: envWs,
		source: "env"
	};
	return null;
}

//#endregion
export { autoSelectWorkspace, fetchSites, resolveWorkspaceFor };