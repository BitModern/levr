import { getApiUrl } from "./env-NxtzJJPk.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { applyEdits, modify, parse } from "jsonc-parser";

//#region ../mcp-harnesses/dist/catalog.js
/**
* @levr/mcp-harnesses — isomorphic catalog (browser + Node).
*
* Single source of truth for MCP-capable clients ("harnesses"): the catalog,
* the OAuth-client → catalog matcher, and the pure config builders. This module
* MUST stay free of Node built-ins (`node:fs`, `node:os`, `node:path`) so the
* client SPA can import it without pulling `node:fs` into the bundle. Detection
* and config-write live in the `@levr/mcp-harnesses/node` subpath.
*
* Plan: specs/plans/mcp-harness-detect-installer.md (ENG-43, P1).
*/
/** Stable server key written into every harness config (used by detect/remove).
* Renamed from the legacy brand key pre-first-publish (ENG-2515) — this key
* is a persisted identity in end-users' client config files, so it must not
* carry the old brand. */
const SERVER_NAME = "levr";
/**
* The catalog. Order is presentation order (most common first).
*
* `comingSoon` clients (VS Code, Codex) are listed but not installable in v1:
* their config formats differ enough (VS Code's `servers`/native-http schema,
* Codex's TOML `~/.codex/config.toml`) that faithful writes are deferred to a
* later catalog entry rather than forced through the JSON `mcpServers` builder.
*/
const HARNESSES = [
	{
		id: "claude",
		label: "Claude Desktop",
		matchers: [
			"claude desktop",
			"claude-desktop",
			"claude"
		],
		serverPropertyName: "mcpServers",
		installKind: "config-file",
		transport: "mcp-remote",
		docsUrl: "https://modelcontextprotocol.io/quickstart/user",
		comingSoon: false,
		locations: [
			{
				platform: "darwin",
				configPath: "~/Library/Application Support/Claude/claude_desktop_config.json",
				installSignals: ["~/Library/Application Support/Claude", "/Applications/Claude.app"]
			},
			{
				platform: "win32",
				configPath: "~/AppData/Roaming/Claude/claude_desktop_config.json",
				installSignals: ["~/AppData/Roaming/Claude"]
			},
			{
				platform: "linux",
				configPath: "~/.config/Claude/claude_desktop_config.json",
				installSignals: ["~/.config/Claude"]
			}
		]
	},
	{
		id: "claude-code",
		label: "Claude Code",
		matchers: [
			"claude code",
			"claude-code",
			"claude_code",
			"claudecode"
		],
		serverPropertyName: "mcpServers",
		installKind: "cli-command",
		transport: "native-http",
		docsUrl: "https://docs.anthropic.com/en/docs/claude-code/mcp",
		comingSoon: false,
		locations: [
			{
				platform: "darwin",
				configPath: "~/.claude.json",
				installSignals: [
					"which:claude",
					"~/.claude.json",
					"~/.claude"
				]
			},
			{
				platform: "linux",
				configPath: "~/.claude.json",
				installSignals: [
					"which:claude",
					"~/.claude.json",
					"~/.claude"
				]
			},
			{
				platform: "win32",
				configPath: "~/.claude.json",
				installSignals: [
					"which:claude",
					"~/.claude.json",
					"~/.claude"
				]
			}
		]
	},
	{
		id: "cursor",
		label: "Cursor",
		matchers: ["cursor"],
		serverPropertyName: "mcpServers",
		installKind: "config-file",
		transport: "mcp-remote",
		docsUrl: "https://docs.cursor.com/context/model-context-protocol",
		comingSoon: false,
		locations: [
			{
				platform: "darwin",
				configPath: "~/.cursor/mcp.json",
				installSignals: [
					"~/.cursor",
					"which:cursor",
					"/Applications/Cursor.app"
				]
			},
			{
				platform: "win32",
				configPath: "~/.cursor/mcp.json",
				installSignals: ["~/.cursor", "which:cursor"]
			},
			{
				platform: "linux",
				configPath: "~/.cursor/mcp.json",
				installSignals: ["~/.cursor", "which:cursor"]
			}
		]
	},
	{
		id: "windsurf",
		label: "Windsurf",
		matchers: ["windsurf", "codeium"],
		serverPropertyName: "mcpServers",
		installKind: "config-file",
		transport: "mcp-remote",
		docsUrl: "https://docs.windsurf.com/windsurf/mcp",
		comingSoon: false,
		locations: [
			{
				platform: "darwin",
				configPath: "~/.codeium/windsurf/mcp_config.json",
				installSignals: [
					"~/.codeium/windsurf",
					"/Applications/Windsurf.app",
					"which:windsurf"
				]
			},
			{
				platform: "win32",
				configPath: "~/.codeium/windsurf/mcp_config.json",
				installSignals: ["~/.codeium/windsurf", "which:windsurf"]
			},
			{
				platform: "linux",
				configPath: "~/.codeium/windsurf/mcp_config.json",
				installSignals: ["~/.codeium/windsurf", "which:windsurf"]
			}
		]
	},
	{
		id: "zed",
		label: "Zed",
		matchers: ["zed"],
		serverPropertyName: "context_servers",
		installKind: "config-file",
		transport: "mcp-remote",
		docsUrl: "https://zed.dev/docs/assistant/model-context-protocol",
		comingSoon: false,
		locations: [
			{
				platform: "darwin",
				configPath: "~/.config/zed/settings.json",
				installSignals: [
					"~/.config/zed",
					"/Applications/Zed.app",
					"which:zed"
				]
			},
			{
				platform: "linux",
				configPath: "~/.config/zed/settings.json",
				installSignals: ["~/.config/zed", "which:zed"]
			},
			{
				platform: "win32",
				configPath: "~/AppData/Roaming/Zed/settings.json",
				installSignals: ["~/AppData/Roaming/Zed"]
			}
		]
	},
	{
		id: "vscode",
		label: "VS Code",
		matchers: [
			"vscode",
			"vs code",
			"visual studio code"
		],
		serverPropertyName: "mcpServers",
		installKind: "config-file",
		transport: "mcp-remote",
		docsUrl: "https://code.visualstudio.com/docs/copilot/chat/mcp-servers",
		comingSoon: true,
		locations: [
			{
				platform: "darwin",
				configPath: "~/Library/Application Support/Code/User/mcp.json",
				installSignals: ["/Applications/Visual Studio Code.app", "which:code"]
			},
			{
				platform: "win32",
				configPath: "~/AppData/Roaming/Code/User/mcp.json",
				installSignals: ["which:code"]
			},
			{
				platform: "linux",
				configPath: "~/.config/Code/User/mcp.json",
				installSignals: ["~/.config/Code", "which:code"]
			}
		]
	},
	{
		id: "codex",
		label: "Codex CLI",
		matchers: ["codex"],
		serverPropertyName: "mcpServers",
		installKind: "config-file",
		transport: "mcp-remote",
		docsUrl: "https://github.com/openai/codex",
		comingSoon: true,
		locations: [
			{
				platform: "darwin",
				configPath: "~/.codex/config.toml",
				installSignals: ["~/.codex", "which:codex"]
			},
			{
				platform: "linux",
				configPath: "~/.codex/config.toml",
				installSignals: ["~/.codex", "which:codex"]
			},
			{
				platform: "win32",
				configPath: "~/.codex/config.toml",
				installSignals: ["~/.codex", "which:codex"]
			}
		]
	}
];
/** Look up a harness by id. Returns `undefined` for unknown ids. */
function getHarness(id) {
	return HARNESSES.find((h) => h.id === id);
}
/** The `npx -y mcp-remote <url>` invocation shared by mcp-remote harnesses. */
function mcpRemoteInvocation(mcpUrl) {
	return {
		command: "npx",
		args: [
			"-y",
			"mcp-remote",
			mcpUrl
		]
	};
}
/**
* The structured server entry to merge under `harness.serverPropertyName`,
* keyed by {@link SERVER_NAME}. Shape is per-harness:
* - `mcpServers` (Claude Desktop, Cursor, Windsurf): flat `{ command, args }`.
* - `context_servers` (Zed): nested `{ source, command: { path, args } }`.
*
* Consumed by the string builder here and, in P2, by the jsonc-preserving
* install merge. Not used for `cli-command` harnesses (see {@link buildHarnessConfig}).
*/
function buildServerEntry(harness, mcpUrl) {
	const { command, args } = mcpRemoteInvocation(mcpUrl);
	if (harness.serverPropertyName === "context_servers") return { [SERVER_NAME]: {
		source: "custom",
		command: {
			path: command,
			args
		}
	} };
	return { [SERVER_NAME]: {
		command,
		args
	} };
}
/**
* The customer-facing install snippet for a harness + MCP URL:
* - `cli-command` harnesses (Claude Code) → the exact command to run.
* - `config-file` harnesses → a pretty-printed JSON snippet (the wrapping
*   `serverPropertyName` + our server entry) to paste/merge into their config.
*/
function buildHarnessConfig(harness, mcpUrl) {
	if (harness.installKind === "cli-command") return `claude mcp add --transport http ${SERVER_NAME} ${mcpUrl}`;
	const snippet = { [harness.serverPropertyName]: buildServerEntry(harness, mcpUrl) };
	return JSON.stringify(snippet, null, 2);
}

//#endregion
//#region ../mcp-harnesses/dist/node/paths.js
function defaultEnv() {
	return {
		platform: process.platform,
		homedir: homedir(),
		pathVar: process.env.PATH ?? ""
	};
}
/** Expand a leading `~` / `~/…` to the given home directory. */
function expandTilde(p, home) {
	if (p === "~") return home;
	if (p.startsWith("~/") || p.startsWith("~\\")) return join(home, p.slice(2));
	return p;
}
/** The config location for a harness on the given platform, if any. */
function locationFor(harness, platform) {
	return harness.locations.find((l) => l.platform === platform);
}
/** Absolute (tilde-expanded) config path for a harness, or undefined if the
* harness has no location on this platform. */
function resolveConfigPath(harness, env) {
	const loc = locationFor(harness, env.platform);
	if (!loc) return void 0;
	return expandTilde(loc.configPath, env.homedir);
}
const WIN_EXTS = [
	"",
	".exe",
	".cmd",
	".bat"
];
/** Is `bin` resolvable on PATH? Pure `process.env.PATH` scan — never spawns a
* shell (no `which`/`where` subprocess). */
function whichSync(bin, env) {
	const exts = env.platform === "win32" ? WIN_EXTS : [""];
	for (const dir of env.pathVar.split(delimiter)) {
		if (!dir) continue;
		for (const ext of exts) if (existsSync(join(dir, bin + ext))) return true;
	}
	return false;
}
/** Does one `installSignals` entry match on this machine? Supports
* `which:<bin>`, `~`-prefixed paths, and absolute (app-bundle) paths. */
function signalMatches(signal, env) {
	if (signal.startsWith("which:")) return whichSync(signal.slice(6), env);
	return existsSync(signal.startsWith("~") ? expandTilde(signal, env.homedir) : signal);
}
/** Read a text file, or `null` if it doesn't exist / can't be read. */
function readTextOrNull(path$1) {
	try {
		return readFileSync(path$1, "utf8");
	} catch {
		return null;
	}
}
/** Safe nested lookup over an unknown-typed parsed JSON value. */
function getAtPath(obj, path$1) {
	let cur = obj;
	for (const key of path$1) {
		if (cur === null || typeof cur !== "object") return void 0;
		cur = cur[key];
	}
	return cur;
}

//#endregion
//#region ../mcp-harnesses/dist/node/detect.js
/** Is our server key present under the harness's server property? */
function isServerConfigured(harness, configPath) {
	const text = readTextOrNull(configPath);
	if (!text) return false;
	const val = getAtPath(parse(text), [harness.serverPropertyName, SERVER_NAME]);
	return val !== void 0 && val !== null;
}
function detectOne(harness, env) {
	const loc = locationFor(harness, env.platform);
	const configPath = resolveConfigPath(harness, env);
	const available = Boolean(loc);
	let installed = false;
	let alreadyConfigured = false;
	if (loc && configPath) {
		installed = loc.installSignals.some((s) => signalMatches(s, env)) || existsSync(configPath);
		alreadyConfigured = isServerConfigured(harness, configPath);
	}
	return {
		id: harness.id,
		label: harness.label,
		installed,
		alreadyConfigured,
		configPath: configPath ?? "",
		available,
		comingSoon: harness.comingSoon
	};
}
/** Synchronous detection over the whole catalog. Exported for tests. */
function detectSync(env = defaultEnv()) {
	return HARNESSES.map((h) => detectOne(h, env));
}

//#endregion
//#region ../mcp-harnesses/dist/node/install.js
const FORMAT = {
	insertSpaces: true,
	tabSize: 2,
	eol: "\n"
};
/** JSON-structural equality — sufficient for our small config values. */
function sameValue(a, b) {
	return JSON.stringify(a) === JSON.stringify(b);
}
/** Merge (or preview) our MCP into a harness config. */
function installHarnessSync(harness, mcpUrl, opts = {}) {
	const env = opts.env ?? defaultEnv();
	const dryRun = opts.dryRun ?? false;
	if (harness.installKind === "cli-command") return {
		ok: true,
		wrote: false,
		path: "",
		command: buildHarnessConfig(harness, mcpUrl),
		alreadyConfigured: false,
		dryRun
	};
	const path$1 = resolveConfigPath(harness, env);
	if (!path$1) return {
		ok: false,
		wrote: false,
		path: "",
		alreadyConfigured: false,
		dryRun
	};
	const entryValue = buildServerEntry(harness, mcpUrl)[SERVER_NAME];
	const modPath = [harness.serverPropertyName, SERVER_NAME];
	const existing = readTextOrNull(path$1);
	const baseText = existing && existing.trim() ? existing : "{}";
	const current = getAtPath(parse(baseText), modPath);
	const alreadyConfigured = current !== void 0 && sameValue(current, entryValue);
	const nextText = applyEdits(baseText, modify(baseText, modPath, entryValue, { formattingOptions: FORMAT }));
	if (alreadyConfigured) return {
		ok: true,
		wrote: false,
		path: path$1,
		alreadyConfigured: true,
		dryRun,
		preview: nextText
	};
	if (dryRun) return {
		ok: true,
		wrote: false,
		path: path$1,
		alreadyConfigured: false,
		dryRun: true,
		preview: nextText
	};
	mkdirSync(dirname(path$1), { recursive: true });
	const finalText = nextText.endsWith("\n") ? nextText : `${nextText}\n`;
	writeFileSync(path$1, finalText, "utf8");
	return {
		ok: true,
		wrote: true,
		path: path$1,
		alreadyConfigured: false,
		dryRun: false,
		preview: finalText
	};
}

//#endregion
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
//#region src/mcp/run.ts
/** Harness ids to pre-select in interactive mode: detected + installable +
* not-already-configured. */
function autoSelectIds(detected) {
	return detected.filter((d) => d.available && !d.comingSoon && d.installed && !d.alreadyConfigured).map((d) => d.id);
}
/** Resolve `--all` / `--client` into concrete, installable harness ids. */
function resolveRequestedIds(options, detected) {
	if (options.all) return {
		ids: detected.filter((d) => d.available && !d.comingSoon).map((d) => d.id),
		unknown: [],
		comingSoon: []
	};
	const ids = [];
	const unknown = [];
	const comingSoon = [];
	for (const c of options.clients ?? []) {
		const harness = getHarness(c);
		if (!harness) unknown.push(c);
		else if (harness.comingSoon) comingSoon.push(c);
		else ids.push(c);
	}
	return {
		ids,
		unknown,
		comingSoon
	};
}
/** Install each selected id, collecting structured outcomes. */
function installSelected(ids, mcpUrl, dryRun, install) {
	const outcomes = [];
	for (const id of ids) {
		const harness = getHarness(id);
		if (!harness) continue;
		outcomes.push({
			id,
			label: harness.label,
			result: install(harness, mcpUrl, dryRun)
		});
	}
	return outcomes;
}
/**
* The non-interactive run: detect, pick ids from `--all`/`--client` (or
* auto-select when only `--yes` is given), install, and return a structured
* report. No console output — the caller formats it.
*/
function runNonInteractive(options, url, urlSource, deps) {
	const detected = deps.detect();
	let ids;
	let unknown = [];
	let comingSoon = [];
	if (options.all || options.clients && options.clients.length > 0) {
		const requested = resolveRequestedIds(options, detected);
		ids = requested.ids;
		unknown = requested.unknown;
		comingSoon = requested.comingSoon;
	} else ids = autoSelectIds(detected);
	return {
		url,
		urlSource,
		outcomes: installSelected(ids, url, options.dryRun, deps.install),
		unknownClients: unknown,
		comingSoonClients: comingSoon,
		dryRun: options.dryRun
	};
}
/** One human-readable status line per outcome. */
function outcomeLine(o, dryRun) {
	const r = o.result;
	if (r.command) return `${o.label}: run \`${r.command}\``;
	if (!r.ok) return `${o.label}: failed (no config location on this platform)`;
	if (r.alreadyConfigured) return `${o.label}: already set up (${r.path})`;
	if (dryRun) return `${o.label}: would update ${r.path} (dry run — no changes)`;
	if (r.wrote) return `${o.label}: installed → ${r.path}`;
	return `${o.label}: no change (${r.path})`;
}
/** Render a report as a plain multi-line summary (used by the CLI + tests). */
function formatReport(report) {
	const lines = [];
	lines.push(`MCP URL: ${report.url} (${report.urlSource})`);
	if (report.outcomes.length === 0) lines.push("No clients selected.");
	else for (const o of report.outcomes) lines.push(outcomeLine(o, report.dryRun));
	if (report.unknownClients.length > 0) lines.push(`Unknown clients (skipped): ${report.unknownClients.join(", ")}`);
	if (report.comingSoonClients.length > 0) lines.push(`Coming soon (skipped): ${report.comingSoonClients.join(", ")}`);
	return lines.join("\n");
}
/** Next-steps blurb after a run. */
function nextStepsText(report) {
	if (report.dryRun) return "Dry run — re-run without --dry-run to apply these changes.";
	if (!report.outcomes.some((o) => o.result.wrote || o.result.command)) return "Nothing to do.";
	return ["Next: restart the client(s) above — each will prompt you to authorize", "Levr once in the browser. Then ask it: \"What issues are assigned to me?\""].join("\n");
}

//#endregion
//#region src/commands/mcp/addHandler.ts
const defaultInstall = (harness, mcpUrl, dryRun) => installHarnessSync(harness, mcpUrl, { dryRun });
const defaultDeps = {
	detect: () => detectSync(),
	install: defaultInstall
};
async function mcpAddHandler(flags) {
	const { url, source } = resolveMcpUrl(flags.url);
	const clients = (flags.client ?? []).flatMap((c) => c.split(",").map((s) => s.trim()).filter(Boolean));
	const options = {
		all: flags.all,
		clients,
		yes: flags.yes,
		dryRun: flags["dry-run"]
	};
	if (options.all || clients.length > 0 || options.yes || !process.stdout.isTTY) {
		const report = runNonInteractive(options, url, source, defaultDeps);
		this.process.stdout.write(`${formatReport(report)}\n`);
		this.process.stdout.write(`\n${nextStepsText(report)}\n`);
		if (report.unknownClients.length > 0 || hasFailure(report)) this.process.exitCode = 1;
		return;
	}
	await interactive(this, options.dryRun, url, source);
}
function hasFailure(report) {
	return report.outcomes.some((o) => !o.result.ok);
}
async function interactive(ctx, dryRun, url, urlSource) {
	const p = await import("@clack/prompts");
	p.intro("Levr MCP setup");
	p.note(`${url}\n(${urlSource})`, "MCP endpoint");
	const detected = defaultDeps.detect();
	const installable = detected.filter((d) => d.available && !d.comingSoon);
	if (installable.length === 0) {
		p.outro("No supported MCP clients found on this machine.");
		return;
	}
	const preselect = new Set(autoSelectIds(detected));
	const selection = await p.multiselect({
		message: "Select clients to set up",
		options: installable.map((d) => ({
			value: d.id,
			label: d.label,
			hint: d.alreadyConfigured ? "already set up" : d.installed ? "detected" : "not detected"
		})),
		initialValues: installable.filter((d) => preselect.has(d.id)).map((d) => d.id),
		required: false
	});
	if (p.isCancel(selection)) {
		p.cancel("Cancelled.");
		ctx.process.exitCode = 1;
		return;
	}
	if (selection.length === 0) {
		p.outro("Nothing selected — bye.");
		return;
	}
	const spin = p.spinner();
	spin.start(dryRun ? "Previewing changes" : "Installing");
	const outcomes = installSelected(selection, url, dryRun, defaultDeps.install);
	spin.stop(dryRun ? "Preview ready" : "Done");
	const report = {
		url,
		urlSource,
		outcomes,
		unknownClients: [],
		comingSoonClients: [],
		dryRun
	};
	p.note(formatReport(report), "Results");
	p.outro(nextStepsText(report));
	if (hasFailure(report)) ctx.process.exitCode = 1;
}

//#endregion
export { mcpAddHandler };