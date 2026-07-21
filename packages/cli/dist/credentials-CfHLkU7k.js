import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

//#region src/utils/env.ts
const DEFAULT_API_URL = "https://api.levr.one";
const DEFAULT_AUTH_URL = "https://auth.levr.one";
/** OAuth client ID for the CLI (seeded in oauth_clients table) */
const CLI_CLIENT_ID = "3";
function getApiUrl() {
	return process.env["LEVR_URL"] || DEFAULT_API_URL;
}
function getAuthUrl() {
	return process.env["LEVR_AUTH_URL"] || DEFAULT_AUTH_URL;
}
function getTeamId(flagValue) {
	return flagValue || process.env["LEVR_TEAM_ID"] || void 0;
}
function getPatToken() {
	return process.env["LEVR_TOKEN"];
}
function getSourceOverride() {
	return process.env["LEVR_SOURCE"];
}
function getAutomationSourceIdOverride() {
	return process.env["LEVR_AUTOMATION_SOURCE_ID"];
}

//#endregion
//#region src/auth/credentials.ts
const CREDENTIALS_PATH = join(join(homedir(), ".config", "levr"), "credentials.json");
function readCredentials() {
	try {
		const raw = readFileSync(CREDENTIALS_PATH, "utf8");
		return JSON.parse(raw);
	} catch {
		return null;
	}
}
function writeCredentials(creds) {
	mkdirSync(dirname(CREDENTIALS_PATH), { recursive: true });
	writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), { mode: 384 });
}
function deleteCredentials() {
	try {
		unlinkSync(CREDENTIALS_PATH);
		return true;
	} catch {
		return false;
	}
}

//#endregion
export { CLI_CLIENT_ID, deleteCredentials, getApiUrl, getAuthUrl, getAutomationSourceIdOverride, getPatToken, getSourceOverride, getTeamId, readCredentials, writeCredentials };