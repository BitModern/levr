import "./env-NxtzJJPk.js";
import { authGetSitesV1, configureClient } from "./sdk-client-BeE6mXns.js";
import { loadWorkspace } from "./workspace-store-4hfvsEHS.js";
import "./token-refresh-Cz-FqDtC.js";
import { resolveToken } from "./resolve-token-BRPrqdG-.js";

//#region src/commands/workspace/listHandler.ts
async function listHandler() {
	let auth;
	try {
		auth = await resolveToken();
	} catch (err) {
		this.logger.error(err instanceof Error ? err.message : "Not authenticated. Run 'levr auth login' first.");
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
	const data = result.data;
	printSites(this, data.sites);
}
/**
* Print the workspace list with the current-workspace indicator. Shared
* with `levr init` (ENG-2361).
*/
function printSites(ctx, sites) {
	if (sites.length === 0) {
		ctx.logger.info("No workspaces available.");
		return;
	}
	const currentWs = loadWorkspace();
	ctx.process.stdout.write("\nWorkspaces:\n\n");
	for (const site of sites) {
		const indicator = site.workspace_id === currentWs ? " *" : "";
		ctx.process.stdout.write(`  ${site.workspace_name} (${site.workspace_id}) [${site.role}]${indicator}\n`);
	}
	ctx.process.stdout.write("\n");
}

//#endregion
export { listHandler };