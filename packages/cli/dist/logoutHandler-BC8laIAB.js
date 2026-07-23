import { deleteCredentials, getPatToken } from "./env-NxtzJJPk.js";
import { clearWorkspace } from "./workspace-store-4hfvsEHS.js";

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