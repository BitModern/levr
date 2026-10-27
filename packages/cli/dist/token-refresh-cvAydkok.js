import { CLI_CLIENT_ID, deleteCredentials, getApiUrl, readCredentials, writeCredentials } from "./env-Cv-anxJA.js";

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
*
* Returns the updated credentials, or `null` only when the server REFUSED
* the refresh token itself (400/401 `invalid_grant`): those credentials are
* dead and are deleted, and the caller asks for `levr auth login`. Every
* other failure (a 5xx, a 429, another error code, a proxy's HTML page, an
* older backend's 400, a network error, an unusable success body) THROWS and
* keeps the stored credentials, so the next command retries: deleting them
* signed the user out on any backend hiccup (ENG-7829). Same rule as the web
* client (`apps/client/app/services/tokenRefresh.ts`), including its
* compare-before-clear: a refusal of a token another process already
* rotated returns the newer stored pair.
*/
async function refreshToken(creds) {
	const apiUrl = getApiUrl();
	let res;
	try {
		res = await fetch(`${apiUrl}/v1/oauth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: creds.refresh_token,
				client_id: CLI_CLIENT_ID
			})
		});
	} catch (error) {
		throw transientFailure(`network error: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!res.ok) {
		if (await isRefusal(res)) {
			const stored = readCredentials();
			if (stored && stored.refresh_token !== creds.refresh_token) return sameServer(stored, creds.api_url) ? stored : null;
			deleteCredentials();
			return null;
		}
		throw transientFailure(`HTTP ${res.status}`);
	}
	const data = await readTokenResponse(res);
	if (!data) throw transientFailure("unusable response");
	const updated = {
		...creds,
		access_token: data.access_token,
		refresh_token: data.refresh_token,
		expires_at: new Date(Date.now() + data.expires_in * 1e3).toISOString()
	};
	writeCredentials(updated);
	return updated;
}
function sameServer(stored, apiUrl) {
	return stored.api_url.replace(/\/+$/, "") === apiUrl.replace(/\/+$/, "");
}
function transientFailure(reason) {
	return /* @__PURE__ */ new Error(`Token refresh failed (${reason}). Your login is kept; try again, or run 'levr auth login' if it keeps failing.`);
}
/** The server refused the refresh token itself: a 400/401 `invalid_grant`. */
async function isRefusal(res) {
	if (res.status !== 400 && res.status !== 401) return false;
	try {
		return (await res.json())?.error === "invalid_grant";
	} catch {
		return false;
	}
}
/**
* The token response, or `null` when it is not one (a captive portal's 200,
* a body missing a token): writing it would store a login that cannot be
* refreshed.
*/
async function readTokenResponse(res) {
	try {
		const data = await res.json();
		return typeof data?.access_token === "string" && data.access_token !== "" && typeof data.refresh_token === "string" && data.refresh_token !== "" && typeof data.expires_in === "number" && Number.isFinite(data.expires_in) ? data : null;
	} catch {
		return null;
	}
}

//#endregion
export { classifyToken, isTokenExpired, refreshToken };