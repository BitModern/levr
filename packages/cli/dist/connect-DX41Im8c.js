import { client, configureClient } from "./sdk-client-CTvYVr7D.js";
import { resolveToken } from "./resolve-token-7xb7kG7h.js";
import { resolveWorkspace } from "./resolve-workspace-B3Gz3-Vh.js";

//#region src/utils/connect.ts
/**
* Authenticate the SDK client for a command (ENG-6164): resolve the token,
* and for a JWT the workspace. Reports the failure and sets exit code 1;
* returns false when the command must stop.
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
	if (auth.type === "jwt") try {
		const ws = await resolveWorkspace(workspaceIdFlag);
		client.setConfig({
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