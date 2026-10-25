import { CLI_CLIENT_ID, deleteCredentials, getApiUrl, writeCredentials } from "./env-Cv-anxJA.js";

//#region src/auth/token-shape.ts
/**
* Classify a bearer token by its SHAPE — [issue:ENG-6068].
*
* The server decides how to verify a token by looking at the token, not at
* where it came from (`isPersonalAccessToken` in the backend's auth
* middleware): a Levr personal access token starts with `tq_`, and anything
* else is handed to the JWT verifier. `LEVR_TOKEN` carries either kind — a
* PAT minted in Settings, or an OAuth access token a device-code login
* printed for CI — so the CLI must apply the same rule. Until ENG-6068 every
* `LEVR_TOKEN` was called a PAT, and the JWT-only steps (resolving
* `--workspace-id` / `LEVR_WORKSPACE_ID`, `levr workspace list|select`) were
* silently skipped for an OAuth token, which has no workspace of its own.
*
* Leaf module on purpose: no imports, so `resolve-token`, the handlers and
* their tests can all read it without pulling in credentials or the SDK.
*/
const PAT_PREFIX = "tq_";
/** `tq_…` is a personal access token; everything else is treated as a JWT. */
function classifyToken(token) {
	return token.startsWith(PAT_PREFIX) ? "pat" : "jwt";
}

//#endregion
//#region src/auth/token-refresh.ts
const REFRESH_BUFFER_MS = 300 * 1e3;
/**
* Check if stored JWT credentials are expired (or within 5 min of expiry).
*/
function isTokenExpired(creds) {
	const expiresAt = new Date(creds.expires_at).getTime();
	return Date.now() >= expiresAt - REFRESH_BUFFER_MS;
}
/**
* Refresh JWT credentials using the stored refresh token.
* Returns updated credentials or null if refresh failed.
*/
async function refreshToken(creds) {
	const apiUrl = getApiUrl();
	try {
		const res = await fetch(`${apiUrl}/v1/oauth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: creds.refresh_token,
				client_id: CLI_CLIENT_ID
			})
		});
		if (!res.ok) {
			deleteCredentials();
			return null;
		}
		const data = await res.json();
		const updated = {
			...creds,
			access_token: data.access_token,
			refresh_token: data.refresh_token,
			expires_at: new Date(Date.now() + data.expires_in * 1e3).toISOString()
		};
		writeCredentials(updated);
		return updated;
	} catch {
		deleteCredentials();
		return null;
	}
}

//#endregion
export { classifyToken, isTokenExpired, refreshToken };