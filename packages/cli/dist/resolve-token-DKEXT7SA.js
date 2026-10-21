import { classifyToken, isTokenExpired, refreshToken } from "./token-refresh-BpFuU4Ij.js";
import { getApiUrl, getPatToken, readCredentials } from "./env-DjeRwmZ7.js";

//#region src/auth/resolve-token.ts
/**
* Stored credentials exist but were issued by a different server than the
* one this command targets (`--url`/`LEVR_URL`). Callers that can recover
* (e.g. `levr init` re-logging-in against the new target) match on this
* class instead of string-sniffing the message.
*/
var CredentialsMismatchError = class extends Error {
	constructor(storedUrl, activeUrl) {
		super(`Stored credentials are for ${storedUrl}, but this command targets ${activeUrl}. Run 'levr auth login' to authenticate against this server.`);
		this.name = "CredentialsMismatchError";
	}
};
/**
* Resolve auth token in priority order:
* 1. LEVR_TOKEN env var — a PAT or an OAuth access token, told apart by
*    shape (ENG-6068); never refreshed
* 2. Stored credentials (JWT) — auto-refresh if expired
* 3. Error — not authenticated
*/
async function resolveToken() {
	const pat = getPatToken();
	if (pat) return {
		token: pat,
		type: classifyToken(pat),
		source: "env"
	};
	let creds = readCredentials();
	if (creds) {
		const activeUrl = getApiUrl();
		const storedUrl = creds.api_url.replace(/\/+$/, "");
		if (storedUrl !== activeUrl) throw new CredentialsMismatchError(storedUrl, activeUrl);
		if (isTokenExpired(creds)) {
			const refreshed = await refreshToken(creds);
			if (!refreshed) throw new Error("Token expired and refresh failed. Run 'levr auth login' to re-authenticate.");
			creds = refreshed;
		}
		return {
			token: creds.access_token,
			type: "jwt",
			source: "stored"
		};
	}
	throw new Error("Not authenticated. Run 'levr auth login' or set LEVR_TOKEN environment variable.");
}

//#endregion
export { resolveToken };