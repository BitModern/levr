import { CLI_CLIENT_ID, deleteCredentials, getApiUrl, writeCredentials } from "./env-hpzB56ay.js";

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
export { isTokenExpired, refreshToken };