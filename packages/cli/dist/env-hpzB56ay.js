import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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
//#region src/utils/env.ts
const DEFAULT_API_URL = "https://api.levr.one";
const KNOWN_AUTH_HOSTS = {
	"api.levr.one": "auth.levr.one",
	"api.levr.one": "auth.levr.one"
};
/** OAuth client ID for the CLI (seeded in oauth_clients table) */
const CLI_CLIENT_ID = "3";
let sessionApiUrl;
function setSessionApiUrl(url) {
	sessionApiUrl = normalizeUrl(url);
}
function normalizeUrl(url) {
	return url.replace(/\/+$/, "");
}
/**
* Resolve the API base URL: `--url` flag > `LEVR_URL` env var > the
* `api_url` stored in credentials at login > production default.
*
* The stored-credentials fallback keeps every later command (push, refresh,
* workspace list) pointed at the environment the user actually logged into,
* instead of silently falling back to production when the env var is no
* longer exported in the current shell.
*/
function getApiUrl() {
	if (sessionApiUrl) return sessionApiUrl;
	const env = process.env["LEVR_URL"];
	if (env) return normalizeUrl(env);
	if (!getPatToken()) {
		const stored = readCredentials()?.api_url;
		if (stored) return normalizeUrl(stored);
	}
	return DEFAULT_API_URL;
}
/**
* Resolve the auth-server base URL (browser PKCE consent page only):
* `LEVR_AUTH_URL` env var > derived from the resolved API URL for known
* Levr hosts. Unrecognized hosts (e.g. localhost dev stacks) require the
* explicit env var — throwing beats silently opening the production login
* page for a token exchange that can never succeed.
*/
function getAuthUrl() {
	const env = process.env["LEVR_AUTH_URL"];
	if (env) return normalizeUrl(env);
	const apiUrl = getApiUrl();
	const derived = deriveAuthUrl(apiUrl);
	if (derived) return derived;
	throw new Error(`Cannot derive the auth server URL from API URL "${apiUrl}". Set LEVR_AUTH_URL to the auth server base URL (e.g. https://auth.levr.one).`);
}
function deriveAuthUrl(apiUrl) {
	let parsed;
	try {
		parsed = new URL(apiUrl);
	} catch {
		return;
	}
	const authHost = KNOWN_AUTH_HOSTS[parsed.host];
	return authHost ? `${parsed.protocol}//${authHost}` : void 0;
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
export { CLI_CLIENT_ID, deleteCredentials, getApiUrl, getAuthUrl, getAutomationSourceIdOverride, getPatToken, getSourceOverride, getTeamId, readCredentials, setSessionApiUrl, writeCredentials };