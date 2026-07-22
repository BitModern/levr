import { performLogin } from "./loginHandler-BSrs0mHq.js";
import { setSessionApiUrl } from "./env-hpzB56ay.js";
import { authGetSitesV1, configureClient } from "./sdk-client-BCOB2qNU.js";
import "./workspace-store-BcyMJAht.js";
import "./resolve-workspace-EpjKI71z.js";
import "./token-refresh-BYu4XO3G.js";
import { CredentialsMismatchError, resolveToken } from "./resolve-token-DizP2xRY.js";
import { printSites } from "./listHandler-DDd6scZ8.js";
import chalk from "chalk";

//#region src/commands/initHandler.ts
/**
* First-run onboarding: authenticate if needed, then list workspaces.
* Composes the existing login flow (loginHandler's performLogin) with the
* workspace listing (listHandler's printSites) — absorbs the retired
* @levr-one/setup flow (ENG-2361).
*/
async function initHandler(flags) {
	if (flags.url) setSessionApiUrl(flags.url);
	let auth;
	try {
		auth = await resolveToken();
		this.logger.success("Already authenticated.");
	} catch (resolveError) {
		if (resolveError instanceof CredentialsMismatchError) this.logger.warning(resolveError.message);
		if (!await performLogin(this, { deviceCode: flags["device-code"] })) return;
		try {
			auth = await resolveToken();
		} catch (error) {
			this.logger.error(error instanceof Error ? error.message : "Authentication failed.");
			this.process.exitCode = 1;
			return;
		}
	}
	if (auth.type === "pat") {
		this.logger.info("Authenticated via LEVR_TOKEN (PAT). Workspace listing requires JWT auth — run 'levr auth login' to browse workspaces.");
		return;
	}
	configureClient(auth);
	const result = await authGetSitesV1();
	if (result.error) {
		this.logger.error("Failed to list workspaces.");
		this.process.exitCode = 1;
		return;
	}
	printSites(this, result.data.sites);
	this.process.stdout.write(`Next: ${chalk.cyan("'levr workspace select <id>'")} to pick a workspace, then ${chalk.cyan("'levr push <file>'")} to upload results.\n`);
}

//#endregion
export { initHandler };