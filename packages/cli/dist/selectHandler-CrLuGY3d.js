import { authGetSitesV1, configureClient } from "./sdk-client-B4FMd_Fa.js";
import "./env-CvjMSRd7.js";
import "./token-refresh-CJB7Qlxy.js";
import { resolveToken } from "./resolve-token-ByZq05Us.js";
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