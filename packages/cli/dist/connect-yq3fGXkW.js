import { client, configureClient } from "./sdk-client-BgzKzVIR.js";
import { resolveToken } from "./resolve-token-DKEXT7SA.js";
import { resolveWorkspaceFor } from "./resolve-workspace-D8y7twod.js";

//#region src/utils/connect.ts
/**
* Authenticate the SDK client for a command (ENG-6164): resolve the token,
* then the workspace — looked up for a JWT, taken from an explicit flag or
* `LEVR_WORKSPACE_ID` for a PAT (ENG-6068). Reports the failure and sets exit
* code 1; returns false when the command must stop.
*/
async function connect(ctx, workspaceIdFlag) {
	let auth;
	try {
		auth = await resolveToken();
	} catch (err) {
		ctx.logger.error(err instanceof Error ? err.message : "Authentication failed.");
		ctx.process.exitCode = 1;
		return false;
	}
	configureClient(auth);
	try {
		const ws = await resolveWorkspaceFor(auth, workspaceIdFlag);
		if (ws) client.setConfig({
			...client.getConfig(),
			workspaceId: ws.workspaceId
		});
	} catch (err) {
		ctx.logger.error(err instanceof Error ? err.message : "Workspace resolution failed.");
		ctx.process.exitCode = 1;
		return false;
	}
	return true;
}

//#endregion
export { connect };