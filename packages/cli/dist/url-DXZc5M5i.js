import { getApiUrl } from "./env-D31eVXPZ.js";

//#region src/mcp/url.ts
const KNOWN_MCP_URLS = {
	"api.levr.one": "https://ai.levr.one/api/v1/mcp",
	"api.levr.now": "https://ai.levr.now/api/v1/mcp"
};
/**
* Resolve the MCP server URL: `--url` flag > `LEVR_MCP_URL` env > derived
* from the resolved API URL (which itself honors `LEVR_URL` > the URL stored
* at login > production default, ENG-2361). Known Levr hosts map to their
* app-host MCP resource; anything else (localhost dev stacks, custom
* deployments) derives `<api-url>/v1/mcp`.
*/
function resolveMcpUrl(flagUrl) {
	const resolved = resolveRaw(flagUrl);
	assertUsableMcpUrl(resolved.url, resolved.source);
	return resolved;
}
function resolveRaw(flagUrl) {
	if (flagUrl) return {
		url: stripSlash(flagUrl),
		source: "flag"
	};
	const envVar = process.env["LEVR_MCP_URL"];
	if (envVar) return {
		url: stripSlash(envVar),
		source: "env:LEVR_MCP_URL"
	};
	const apiUrl = getApiUrl();
	return {
		url: knownMcpUrl(apiUrl) ?? `${apiUrl}/v1/mcp`,
		source: `derived:${apiUrl}`
	};
}
/** Name the input the user has to change, not our internal source tag. */
function sourceLabel(source) {
	if (source === "flag") return "--url";
	if (source === "env:LEVR_MCP_URL") return "LEVR_MCP_URL";
	return `the API URL (${source.slice(8)})`;
}
/**
* Reject a URL that must not reach a client config or a spawned CLI (ENG-4159).
*
* Three things this stops:
*
* 1. **No scheme.** `claude mcp add --transport http --scope user levr <value>`
*    is spawned with fixed argv since ENG-4156, so a value like `--foo` is read
*    by that CLI as a FLAG rather than as its URL operand — argument injection.
*    Requiring a parseable absolute URL removes the shape entirely.
* 2. **A non-http(s) scheme.** `file:` / `javascript:` is never a valid MCP
*    endpoint, but would be written verbatim into every client's config.
* 3. **Embedded credentials.** `https://user:pass@host` would be written into
*    a config file — and since ENG-4151 a config file can be `--scope project`,
*    which the user is told to COMMIT. That turns a bad URL into a secret in
*    git history. MCP authenticates via OAuth in the browser; credentials in
*    the URL are never needed.
*/
function assertUsableMcpUrl(url, source) {
	const from = sourceLabel(source);
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`Invalid MCP URL from ${from}: ${JSON.stringify(url)} is not a URL. Expected an absolute http(s) URL, e.g. https://ai.levr.one/api/v1/mcp`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`Invalid MCP URL from ${from}: ${JSON.stringify(url)} uses "${parsed.protocol}" — only http and https are supported.`);
	if (!parsed.hostname) throw new Error(`Invalid MCP URL from ${from}: ${JSON.stringify(url)} has no host.`);
	if (parsed.username || parsed.password) throw new Error(`Invalid MCP URL from ${from}: ${JSON.stringify(url)} embeds credentials. They would be written into client config files — including project-scoped ones you are told to commit. Levr authenticates in the browser; remove the user:password@ prefix.`);
}
/**
* Is this MCP URL served by the API the CLI is logged in to? `--workspace`
* and the workspace picker read that API's workspaces, so pinning a URL on
* another server to one of them would name the wrong workspace, or none
* (ENG-6300 D6).
*/
function servedBySessionApi(mcpUrl) {
	const apiUrl = getApiUrl();
	const derived = knownMcpUrl(apiUrl) ?? `${apiUrl}/v1/mcp`;
	try {
		return new URL(mcpUrl).origin === new URL(derived).origin;
	} catch {
		return false;
	}
}
/** `…/v1/mcp/w/<url_key>`: the URL already names one workspace (ENG-6300). */
const SCOPED_SUFFIX = /\/w\/[^/]+$/;
/** Does this MCP URL already name a workspace? */
function isScopedMcpUrl(url) {
	return SCOPED_SUFFIX.test(stripSlash(url));
}
/**
* The MCP URL for one workspace, `<base>/w/<url_key>` (ENG-6300 D6). A base
* that already names a workspace is an error rather than a silent re-point:
* `--url …/w/a --workspace b` asks for two different workspaces at once.
*/
function scopedMcpUrl(base, urlKey) {
	const root = stripSlash(base);
	if (isScopedMcpUrl(root)) throw new Error(`The MCP URL ${root} already names a workspace. Drop --workspace, or pass the URL without its /w/<url_key> suffix.`);
	return `${root}/w/${encodeURIComponent(urlKey)}`;
}
function knownMcpUrl(apiUrl) {
	try {
		return KNOWN_MCP_URLS[new URL(apiUrl).host];
	} catch {
		return;
	}
}
function stripSlash(url) {
	return url.replace(/\/+$/, "");
}

//#endregion
export { isScopedMcpUrl, resolveMcpUrl, scopedMcpUrl, servedBySessionApi };