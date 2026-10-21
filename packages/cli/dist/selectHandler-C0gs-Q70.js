import { authGetSitesV1, configureClient } from "./sdk-client-BgzKzVIR.js";
import "./token-refresh-BpFuU4Ij.js";
import "./env-DjeRwmZ7.js";
import { resolveToken } from "./resolve-token-DKEXT7SA.js";
import { saveWorkspace } from "./workspace-store-Bmw104Qa.js";

//#region src/commands/workspace/selectHandler.ts
async function selectHandler(_flags, workspaceId) {
	let auth;
	try {
		auth = await resolveToken();
	} catch {
		this.logger.error("Not authenticated. Run 'levr auth login' first.");
		this.process.exitCode = 1;
		return;
	}
	if (auth.type === "pat") {
		this.logger.error("Workspace selection requires JWT auth. Run 'levr auth login'.");
		this.process.exitCode = 1;
		return;
	}
	if (auth.source === "env") {
		this.logger.error("LEVR_TOKEN is set: a workspace selected here would be saved for your login session, not for that token. Pass --workspace-id or set LEVR_WORKSPACE_ID instead.");
		this.process.exitCode = 1;
		return;
	}
	configureClient(auth);
	const result = await authGetSitesV1();
	if (result.error) {
		this.logger.error("Failed to list workspaces.");
		this.process.exitCode = 1;
		return;
	}
	const site = result.data.sites.find((s) => s.workspace_id === workspaceId);
	if (!site) {
		this.logger.error(`Workspace ${workspaceId} not found. Run 'levr workspace list'.`);
		this.process.exitCode = 1;
		return;
	}
	saveWorkspace(workspaceId);
	this.logger.success(`Workspace set to ${site.workspace_name} (${site.workspace_id})`);
}

//#endregion
export { selectHandler };