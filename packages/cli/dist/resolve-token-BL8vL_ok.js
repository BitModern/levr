import { getPatToken, readCredentials } from "./credentials-CfHLkU7k.js";
import { isTokenExpired, refreshToken } from "./token-refresh-waF23pyw.js";

//#region src/auth/resolve-token.ts
/**
* Resolve auth token in priority order:
* 1. LEVR_TOKEN env var (PAT) — long-lived, no refresh
* 2. Stored credentials (JWT) — auto-refresh if expired
* 3. Error — not authenticated
*/
async function resolveToken() {
	const pat = getPatToken();
	if (pat) return {
		token: pat,
		type: "pat"
	};
	let creds = readCredentials();
	if (creds) {
		if (isTokenExpired(creds)) {
			const refreshed = await refreshToken(creds);
			if (!refreshed) throw new Error("Token expired and refresh failed. Run 'levr auth login' to re-authenticate.");
			creds = refreshed;
		}
		return {
			token: creds.access_token,
			type: "jwt"
		};
	}
	throw new Error("Not authenticated. Run 'levr auth login' or set LEVR_TOKEN environment variable.");
}

//#endregion
export { resolveToken };