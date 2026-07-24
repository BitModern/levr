import { getApiUrl, getPatToken, readCredentials } from "./env-NxtzJJPk.js";
import { authGetProfileV1, configureClient } from "./sdk-client-BWrIbeUg.js";
import { isTokenExpired } from "./token-refresh-Cz-FqDtC.js";
import chalk from "chalk";

//#region src/commands/auth/statusHandler.ts
async function statusHandler() {
	const apiUrl = getApiUrl();
	const pat = getPatToken();
	if (pat) {
		if (await checkApiReachable(pat, "pat")) {
			this.process.stdout.write(`${chalk.green("ok")}    Authenticated via LEVR_TOKEN (PAT)\n`);
			this.process.stdout.write(`  API:  ${apiUrl} (reachable)\n`);
		} else {
			this.process.stdout.write(`${chalk.yellow("warn")}  LEVR_TOKEN is set but API is unreachable\n`);
			this.process.stdout.write(`  API:  ${apiUrl}\n`);
		}
		return;
	}
	const creds = readCredentials();
	if (!creds) {
		this.process.stdout.write(`${chalk.red("error")} Not authenticated. Run 'levr auth login' or set LEVR_TOKEN.\n`);
		this.process.exitCode = 1;
		return;
	}
	const storedUrl = creds.api_url.replace(/\/+$/, "");
	if (storedUrl !== apiUrl) {
		this.process.stdout.write(`${chalk.red("error")} Stored credentials are for ${storedUrl}, but the current target is ${apiUrl}. Run 'levr auth login' to authenticate against this server.\n`);
		this.process.exitCode = 1;
		return;
	}
	if (isTokenExpired(creds)) {
		this.process.stdout.write(`${chalk.red("error")} Token expired. Run 'levr auth login' to re-authenticate.\n`);
		this.process.exitCode = 1;
		return;
	}
	const reachable = await checkApiReachable(creds.access_token, "jwt");
	const expiresAt = new Date(creds.expires_at);
	const hoursLeft = Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / (1e3 * 60 * 60)));
	this.process.stdout.write(`${chalk.green("ok")}    Authenticated as ${chalk.bold(creds.user.email)}\n`);
	this.process.stdout.write(`  API:   ${apiUrl}${reachable ? " (reachable)" : " (unreachable)"}\n`);
	this.process.stdout.write(`  Auth:  JWT via credentials file (expires in ${hoursLeft}h)\n`);
}
async function checkApiReachable(token, type) {
	try {
		configureClient({
			token,
			type
		});
		return !(await authGetProfileV1()).error;
	} catch {
		return false;
	}
}

//#endregion
export { statusHandler };