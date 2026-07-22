import "./credentials-Ciq9mA7N.js";
import { authGetSitesV1, configureClient } from "./sdk-client-rpUEykDw.js";
import { loadWorkspace } from "./workspace-store-4hfvsEHS.js";
import "./token-refresh-Pl6Adngb.js";
import { resolveToken } from "./resolve-token-CQU55U6J.js";

//#region src/commands/workspace/listHandler.ts
async function listHandler() {
	let auth;
	try {
		auth = await resolveToken();
	} catch {
		this.logger.error("Not authenticated. Run 'levr auth login' first.");
		this.process.exitCode = 1;
		return;
	}
	if (auth.type === "pat") {
		this.logger.error("Workspace listing requires JWT auth. Run 'levr auth login'.");
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
	const sites = result.data.sites;
	if (sites.length === 0) {
		this.logger.info("No workspaces available.");
		return;
	}
	const currentWs = loadWorkspace();
	this.process.stdout.write("\nWorkspaces:\n\n");
	for (const site of sites) {
		const indicator = site.workspace_id === currentWs ? " *" : "";
		this.process.stdout.write(`  ${site.workspace_name} (${site.workspace_id}) [${site.role}]${indicator}\n`);
	}
	this.process.stdout.write("\n");
}

//#endregion
export { listHandler };