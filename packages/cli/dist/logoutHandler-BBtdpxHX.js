import { deleteCredentials, getPatToken } from "./credentials-CfHLkU7k.js";
import { clearWorkspace } from "./workspace-store-BcyMJAht.js";

//#region src/commands/auth/logoutHandler.ts
function logoutHandler() {
	const deleted = deleteCredentials();
	clearWorkspace();
	if (deleted) this.logger.success("Logged out. Credentials removed.");
	else this.logger.info("No stored credentials found.");
	if (getPatToken()) this.process.stdout.write("Note: LEVR_TOKEN environment variable is still set.\n");
}

//#endregion
export { logoutHandler };