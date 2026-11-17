//#region src/workspace/find-workspace.ts
/** The url_key syntax the backend and auth-web accept (reserved keys aside). */
const URL_KEY_SYNTAX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
/**
* Could this `--workspace` value be a url_key? Only a url_key can name a
* workspace before a session exists, so only one can skip the login picker
* (ENG-6694); a name is resolved once the token has arrived.
*/
function looksLikeUrlKey(input) {
	return input.length <= 100 && URL_KEY_SYNTAX.test(input);
}
/** `  - Name (url_key)` per workspace, for error messages and hints. */
function describeWorkspaces(sites) {
	return sites.map((s) => `  - ${s.workspace_name} (${s.workspace_url_key})`).join("\n");
}
/**
* An exact `url_key` wins; otherwise a case-insensitive name that matches
* exactly one workspace. Anything else throws, listing the choices.
*/
function findWorkspaceByKeyOrName(sites, input) {
	const wanted = input.trim();
	if (!wanted) throw new Error("--workspace needs a workspace name or url_key.");
	const byKey = sites.find((s) => s.workspace_url_key === wanted);
	if (byKey) return byKey;
	const lower = wanted.toLowerCase();
	const byName = sites.filter((s) => s.workspace_name.toLowerCase() === lower);
	if (byName.length === 1) return byName[0];
	if (byName.length > 1) throw new Error(`"${wanted}" names more than one workspace. Pass its url_key instead:\n` + describeWorkspaces(byName));
	if (sites.length === 0) throw new Error("Your account has no workspaces.");
	throw new Error(`No workspace "${wanted}" in your account. Choose one of:\n` + describeWorkspaces(sites));
}

//#endregion
export { describeWorkspaces, findWorkspaceByKeyOrName, looksLikeUrlKey };