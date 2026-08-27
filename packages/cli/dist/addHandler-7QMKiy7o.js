import { getApiUrl } from "./env-CHeKHu5S.js";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { applyEdits, modify, parse } from "jsonc-parser";
import { execFileSync } from "node:child_process";

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
* Plans: specs/plans/mcp-harness-detect-installer.md (ENG-43, P1) ·
*        specs/plans/mcp-install-scopes-ENG-4151.md (ENG-4152, D1 — scope model)
*/
/** Stable server key written into every harness config (used by detect/remove).
* Renamed from the legacy brand key pre-first-publish (ENG-2515) — this key
* is a persisted identity in end-users' client config files, so it must not
* carry the old brand. */
const SERVER_NAME = "levr";
/** Every scope in preference order — the vocabulary, not any harness's support. */
const HARNESS_SCOPES = [
	"user",
	"project",
	"local"
];
/** The `claude mcp add` argv shared by Claude Code's `user` and `local` scopes. */
const CLAUDE_CODE_COMMAND = [
	"claude",
	"mcp",
	"add",
	"--transport",
	"http",
	"--scope",
	"{scope}",
	"{name}",
	"{url}"
];
/** `~/.claude.json` on every platform — read for detection, never written by us. */
const CLAUDE_CODE_LOCATIONS = [
	{
		platform: "darwin",
		configPath: "~/.claude.json"
	},
	{
		platform: "linux",
		configPath: "~/.claude.json"
	},
	{
		platform: "win32",
		configPath: "~/.claude.json"
	}
];
/**
* The catalog. Order is presentation order (most common first).
*
* `comingSoon` clients (VS Code, Codex) are listed but not installable: their
* config formats differ enough (VS Code's `servers`/native-http schema, Codex's
* TOML) that faithful writes are deferred to a dedicated builder branch. Their
* SCOPES are declared as data regardless, so the support matrix stays complete
* and turning them on later is a builder change, not a catalog change.
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
		transport: "mcp-remote",
		docsUrl: "https://modelcontextprotocol.io/quickstart/user",
		comingSoon: false,
		detectSignals: [
			{
				platform: "darwin",
				signals: ["~/Library/Application Support/Claude", "/Applications/Claude.app"]
			},
			{
				platform: "win32",
				signals: ["~/AppData/Roaming/Claude"]
			},
			{
				platform: "linux",
				signals: ["~/.config/Claude"]
			}
		],
		scopes: [{
			scope: "user",
			installKind: "config-file",
			locations: [
				{
					platform: "darwin",
					configPath: "~/Library/Application Support/Claude/claude_desktop_config.json"
				},
				{
					platform: "win32",
					configPath: "~/AppData/Roaming/Claude/claude_desktop_config.json"
				},
				{
					platform: "linux",
					configPath: "~/.config/Claude/claude_desktop_config.json"
				}
			]
		}]
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
		transport: "native-http",
		docsUrl: "https://docs.anthropic.com/en/docs/claude-code/mcp",
		comingSoon: false,
		detectSignals: [
			{
				platform: "darwin",
				signals: [
					"which:claude",
					"~/.claude.json",
					"~/.claude"
				]
			},
			{
				platform: "linux",
				signals: [
					"which:claude",
					"~/.claude.json",
					"~/.claude"
				]
			},
			{
				platform: "win32",
				signals: [
					"which:claude",
					"~/.claude.json",
					"~/.claude"
				]
			}
		],
		scopes: [
			{
				scope: "user",
				installKind: "cli-command",
				locations: CLAUDE_CODE_LOCATIONS,
				command: CLAUDE_CODE_COMMAND
			},
			{
				scope: "project",
				installKind: "config-file",
				projectPath: ".mcp.json"
			},
			{
				scope: "local",
				installKind: "cli-command",
				locations: CLAUDE_CODE_LOCATIONS,
				command: CLAUDE_CODE_COMMAND,
				cwdKeyedUnder: "projects"
			}
		]
	},
	{
		id: "cursor",
		label: "Cursor",
		matchers: ["cursor"],
		serverPropertyName: "mcpServers",
		transport: "mcp-remote",
		docsUrl: "https://cursor.com/docs/mcp",
		comingSoon: false,
		detectSignals: [
			{
				platform: "darwin",
				signals: [
					"~/.cursor",
					"which:cursor",
					"/Applications/Cursor.app"
				]
			},
			{
				platform: "win32",
				signals: ["~/.cursor", "which:cursor"]
			},
			{
				platform: "linux",
				signals: ["~/.cursor", "which:cursor"]
			}
		],
		scopes: [{
			scope: "user",
			installKind: "config-file",
			locations: [
				{
					platform: "darwin",
					configPath: "~/.cursor/mcp.json"
				},
				{
					platform: "win32",
					configPath: "~/.cursor/mcp.json"
				},
				{
					platform: "linux",
					configPath: "~/.cursor/mcp.json"
				}
			]
		}, {
			scope: "project",
			installKind: "config-file",
			projectPath: ".cursor/mcp.json"
		}]
	},
	{
		id: "windsurf",
		label: "Windsurf",
		matchers: ["windsurf", "codeium"],
		serverPropertyName: "mcpServers",
		transport: "mcp-remote",
		docsUrl: "https://docs.windsurf.com/windsurf/mcp",
		comingSoon: false,
		detectSignals: [
			{
				platform: "darwin",
				signals: [
					"~/.codeium/windsurf",
					"/Applications/Windsurf.app",
					"which:windsurf"
				]
			},
			{
				platform: "win32",
				signals: ["~/.codeium/windsurf", "which:windsurf"]
			},
			{
				platform: "linux",
				signals: ["~/.codeium/windsurf", "which:windsurf"]
			}
		],
		scopes: [{
			scope: "user",
			installKind: "config-file",
			locations: [
				{
					platform: "darwin",
					configPath: "~/.codeium/windsurf/mcp_config.json"
				},
				{
					platform: "win32",
					configPath: "~/.codeium/windsurf/mcp_config.json"
				},
				{
					platform: "linux",
					configPath: "~/.codeium/windsurf/mcp_config.json"
				}
			]
		}]
	},
	{
		id: "zed",
		label: "Zed",
		matchers: ["zed"],
		serverPropertyName: "context_servers",
		transport: "mcp-remote",
		docsUrl: "https://zed.dev/docs/ai/mcp",
		comingSoon: false,
		detectSignals: [
			{
				platform: "darwin",
				signals: [
					"~/.config/zed",
					"/Applications/Zed.app",
					"which:zed"
				]
			},
			{
				platform: "linux",
				signals: ["~/.config/zed", "which:zed"]
			},
			{
				platform: "win32",
				signals: ["~/AppData/Roaming/Zed"]
			}
		],
		scopes: [{
			scope: "user",
			installKind: "config-file",
			locations: [
				{
					platform: "darwin",
					configPath: "~/.config/zed/settings.json"
				},
				{
					platform: "linux",
					configPath: "~/.config/zed/settings.json"
				},
				{
					platform: "win32",
					configPath: "~/AppData/Roaming/Zed/settings.json"
				}
			]
		}, {
			scope: "project",
			installKind: "config-file",
			projectPath: ".zed/settings.json"
		}]
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
		transport: "mcp-remote",
		docsUrl: "https://code.visualstudio.com/docs/copilot/chat/mcp-servers",
		comingSoon: true,
		detectSignals: [
			{
				platform: "darwin",
				signals: ["/Applications/Visual Studio Code.app", "which:code"]
			},
			{
				platform: "win32",
				signals: ["which:code"]
			},
			{
				platform: "linux",
				signals: ["~/.config/Code", "which:code"]
			}
		],
		scopes: [{
			scope: "user",
			installKind: "config-file",
			locations: [
				{
					platform: "darwin",
					configPath: "~/Library/Application Support/Code/User/mcp.json"
				},
				{
					platform: "win32",
					configPath: "~/AppData/Roaming/Code/User/mcp.json"
				},
				{
					platform: "linux",
					configPath: "~/.config/Code/User/mcp.json"
				}
			]
		}, {
			scope: "project",
			installKind: "config-file",
			projectPath: ".vscode/mcp.json"
		}]
	},
	{
		id: "codex",
		label: "Codex CLI",
		matchers: ["codex"],
		serverPropertyName: "mcpServers",
		transport: "mcp-remote",
		docsUrl: "https://github.com/openai/codex",
		comingSoon: true,
		detectSignals: [
			{
				platform: "darwin",
				signals: ["~/.codex", "which:codex"]
			},
			{
				platform: "linux",
				signals: ["~/.codex", "which:codex"]
			},
			{
				platform: "win32",
				signals: ["~/.codex", "which:codex"]
			}
		],
		scopes: [{
			scope: "user",
			installKind: "config-file",
			locations: [
				{
					platform: "darwin",
					configPath: "~/.codex/config.toml"
				},
				{
					platform: "linux",
					configPath: "~/.codex/config.toml"
				},
				{
					platform: "win32",
					configPath: "~/.codex/config.toml"
				}
			]
		}, {
			scope: "project",
			installKind: "config-file",
			projectPath: ".codex/config.toml"
		}]
	}
];
/** Look up a harness by id. Returns `undefined` for unknown ids. */
function getHarness(id) {
	return HARNESSES.find((h) => h.id === id);
}
/** This harness's definition for one scope, or `undefined` if unsupported. */
function scopeDef(harness, scope) {
	return harness.scopes.find((s) => s.scope === scope);
}
/** Scopes this harness supports, in preference order. */
function supportedScopes(harness) {
	return harness.scopes.map((s) => s.scope);
}
/** Does this harness accept our server in the given scope? */
function supportsScope(harness, scope) {
	return scopeDef(harness, scope) !== void 0;
}
/**
* The harness's FALLBACK scope — what an unsupported request resolves to.
* Throws on an empty `scopes[]`, which is a catalog bug, not a runtime state
* (`catalog.test.ts` asserts it never happens).
*/
function defaultScope(harness) {
	const first = harness.scopes[0];
	if (!first) throw new Error(`harness "${harness.id}" declares no scopes`);
	return first.scope;
}
/** The config property this harness uses in this scope. */
function serverPropertyFor(harness, scope) {
	return scopeDef(harness, scope)?.serverPropertyName ?? harness.serverPropertyName;
}
/** Resolve a scope def, or throw with the scopes that WOULD have worked. */
function requireScope(harness, scope) {
	const def = scopeDef(harness, scope);
	if (!def) throw new Error(`harness "${harness.id}" does not support scope "${scope}" (supported: ${supportedScopes(harness).join(", ")})`);
	return def;
}
/**
* Substitute `{name}` / `{url}` / `{scope}` into a `cli-command` argv. Returns
* argv rather than a string so the executor can spawn it WITHOUT a shell.
*/
function renderHarnessCommand(harness, mcpUrl, scope) {
	const def = requireScope(harness, scope);
	if (!def.command) throw new Error(`harness "${harness.id}" scope "${scope}" declares no command argv`);
	const substitutions = {
		"{name}": SERVER_NAME,
		"{url}": mcpUrl,
		"{scope}": scope
	};
	return def.command.map((arg) => substitutions[arg] ?? arg);
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
* The structured server entry to merge under the scope's server property,
* keyed by {@link SERVER_NAME}. Shape is per-transport, then per-property:
* - `native-http` (Claude Code's `.mcp.json`): `{ type: 'http', url }`.
* - `mcpServers` (Claude Desktop, Cursor, Windsurf): flat `{ command, args }`.
* - `context_servers` (Zed): nested `{ source, command: { path, args } }`.
*
* Not used for `cli-command` scopes (see {@link buildHarnessConfig}).
*/
function buildServerEntry(harness, mcpUrl, scope = defaultScope(harness)) {
	requireScope(harness, scope);
	if (harness.transport === "native-http") return { [SERVER_NAME]: {
		type: "http",
		url: mcpUrl
	} };
	const { command, args } = mcpRemoteInvocation(mcpUrl);
	if (serverPropertyFor(harness, scope) === "context_servers") return { [SERVER_NAME]: {
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

//#endregion
//#region ../mcp-harnesses/dist/node/paths.js
function defaultEnv() {
	return {
		platform: process.platform,
		homedir: homedir(),
		pathVar: process.env.PATH ?? "",
		cwd: process.cwd()
	};
}
/** Expand a leading `~` / `~/…` to the given home directory. */
function expandTilde(p, home) {
	if (p === "~") return home;
	if (p.startsWith("~/") || p.startsWith("~\\")) return join(home, p.slice(2));
	return p;
}
/**
* The config location for one scope of a harness on the given platform, if any.
* Repo-relative (`project`) scopes carry no platform location — they resolve
* against a project root instead, which is D2's job.
*/
function locationFor(harness, platform, scope = defaultScope(harness)) {
	return scopeDef(harness, scope)?.locations?.find((l) => l.platform === platform);
}
/**
* Install signals for this platform. Signals live on the harness, not the
* scope — "is this client on this machine" has one answer per machine.
*/
function detectSignalsFor(harness, platform) {
	return harness.detectSignals.find((d) => d.platform === platform)?.signals ?? [];
}
/** Absolute (tilde-expanded) config path for a harness, or undefined if the
* harness has no location on this platform. */
function resolveConfigPath(harness, env, scope = defaultScope(harness)) {
	const def = scopeDef(harness, scope);
	if (!def) return void 0;
	if (def.projectPath) return join(resolveProjectRoot(env).root, ...def.projectPath.split("/"));
	const loc = locationFor(harness, env.platform, scope);
	if (!loc) return void 0;
	return expandTilde(loc.configPath, env.homedir);
}
/**
* Nearest ancestor of `cwd` containing `.git`, or `undefined`.
*
* Matches `.git` as a FILE as well as a directory: a git worktree checkout has
* a `.git` *file* pointing at the real gitdir, so a directory-only check would
* miss every worktree — including the ones this repo's own tooling creates.
*/
function findRepoRoot(cwd) {
	let dir = resolve(cwd);
	for (;;) {
		if (existsSync(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return void 0;
		dir = parent;
	}
}
/**
* Resolve where `project` scope writes.
*
* `isRepo: false` is NOT a soft warning. Outside a repository the walk falls
* back to the cwd, and if that cwd happens to be `$HOME` then Cursor's
* repo-relative `.cursor/mcp.json` resolves to `~/.cursor/mcp.json` — the
* exact path its USER scope owns. Silently writing there would clobber a
* different scope's config. Callers must refuse project scope when this is
* false; {@link installHarnessSync} does.
*/
function resolveProjectRoot(env) {
	const root = findRepoRoot(env.cwd);
	return root ? {
		root,
		isRepo: true
	} : {
		root: resolve(env.cwd),
		isRepo: false
	};
}
/**
* Where our server entry sits INSIDE a scope's config file.
*
* Usually `[<serverProperty>, 'levr']` at the top level. A scope declaring
* `cwdKeyedUnder` nests one level deeper, keyed by the launch directory:
* Claude Code's `local` scope lives at
* `projects[<cwd>].mcpServers.levr` in `~/.claude.json`.
*
* `cwdKey` is passed in rather than read off the env because the key is
* specifically the directory the CLIENT was launched in — which is NOT the
* repo root, and callers should have to say which directory they mean.
* Shared by detect and install so the two can never disagree about where an
* entry lives.
*/
function entryPathFor(harness, scope, cwdKey) {
	const tail = [serverPropertyFor(harness, scope), SERVER_NAME];
	const nest = scopeDef(harness, scope)?.cwdKeyedUnder;
	return nest ? [
		nest,
		cwdKey,
		...tail
	] : tail;
}
/**
* Canonical form of a path that may not exist yet.
*
* `realpathSync` throws on a missing path, but the files we compare are
* usually about to be created — so resolve the deepest ancestor that DOES
* exist and re-join the rest. Without this, a symlinked `$HOME` produces two
* different strings for one file.
*/
function canonicalizePath(p) {
	let head = resolve(p);
	const tail = [];
	for (;;) try {
		return join(realpathSync(head), ...tail.reverse());
	} catch {
		const parent = dirname(head);
		if (parent === head) return resolve(p);
		tail.push(head.slice(parent.length + 1));
		head = parent;
	}
}
/**
* Do two paths name the same file?
*
* Compares canonical forms, and on the case-insensitive platforms
* (darwin, win32) compares case-insensitively too — `~/.Cursor/mcp.json` and
* `~/.cursor/mcp.json` are one file there and two on Linux.
*/
function pathsResolveSame(a, b, platform) {
	const ca = canonicalizePath(a);
	const cb = canonicalizePath(b);
	if (ca === cb) return true;
	if (platform === "linux") return false;
	return ca.toLowerCase() === cb.toLowerCase();
}
/**
* Would installing this harness at `scope` write over a DIFFERENT scope's
* config file?
*
* The `isRepo` check alone is not this question. `git init` in `$HOME` — an
* ordinary dotfiles setup — makes Cursor's repo-relative `.cursor/mcp.json`
* resolve to `~/.cursor/mcp.json`, the file its own USER scope owns: the
* guard passes and one scope silently overwrites the other. Compare the
* resolved paths instead of inferring from repo-ness.
*/
function collidingScope(harness, env, scope) {
	if (!scopeDef(harness, scope)?.projectPath) return void 0;
	const target = resolveConfigPath(harness, env, scope);
	if (!target) return void 0;
	const targetEntry = entryPathFor(harness, scope, env.cwd).join("\0");
	for (const other of harness.scopes) {
		if (other.scope === scope) continue;
		const otherPath = resolveConfigPath(harness, env, other.scope);
		if (!otherPath) continue;
		if (!pathsResolveSame(target, otherPath, env.platform)) continue;
		if (entryPathFor(harness, other.scope, env.cwd).join("\0") === targetEntry) return other.scope;
	}
}
const WIN_EXTS = [
	"",
	".exe",
	".cmd",
	".bat"
];
/**
* Resolve `bin` on PATH, returning the full path. Pure `process.env.PATH`
* scan — never spawns a shell (no `which`/`where` subprocess).
*
* Returns the PATH, not a boolean, because the caller has to know the
* extension: a `.cmd`/`.bat` cannot be spawned the same way as a native
* binary. Requires a regular file — a DIRECTORY named `claude` on PATH would
* otherwise resolve, then fail at spawn with EISDIR and be reported as a
* broken install rather than an absent one.
*/
function whichPathSync(bin, env) {
	const exts = env.platform === "win32" ? WIN_EXTS : [""];
	for (const dir of env.pathVar.split(delimiter)) {
		if (!dir) continue;
		for (const ext of exts) {
			const candidate = join(dir, bin + ext);
			try {
				if (statSync(candidate).isFile()) return candidate;
			} catch {}
		}
	}
}
/** Is `bin` resolvable on PATH? */
function whichSync(bin, env) {
	return whichPathSync(bin, env) !== void 0;
}
/** Does one `installSignals` entry match on this machine? Supports
* `which:<bin>`, `~`-prefixed paths, and absolute (app-bundle) paths. */
function signalMatches(signal, env) {
	if (signal.startsWith("which:")) return whichSync(signal.slice(6), env);
	return existsSync(signal.startsWith("~") ? expandTilde(signal, env.homedir) : signal);
}
/**
* The value our server key currently holds for this scope, or `undefined`.
*
* Presence alone is not enough for a `cli-command` scope: `claude mcp add` is
* a no-op when the key exists, so telling "already correct" from "present but
* pointing somewhere else" needs the value.
*/
function readServerEntry(harness, scope, configPath, cwdKey, parseJsonc) {
	const text = readTextOrNull(configPath);
	if (!text) return void 0;
	return getAtPath(parseJsonc(text), entryPathFor(harness, scope, cwdKey));
}
/** Read a text file, or `null` if it doesn't exist / can't be read. */
function readTextOrNull(path) {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}
/** Safe nested lookup over an unknown-typed parsed JSON value. */
function getAtPath(obj, path) {
	let cur = obj;
	for (const key of path) {
		if (cur === null || typeof cur !== "object") return void 0;
		cur = cur[key];
	}
	return cur;
}

//#endregion
//#region ../mcp-harnesses/dist/node/detect.js
/**
* Is our server key present for this scope?
*
* Claude Code shares one file (`~/.claude.json`) between its `user` and
* `local` scopes, so the two are told apart by WHERE in the file they sit,
* not by which file is read — hence the entry path rather than a bare
* top-level lookup.
*/
function isServerConfigured(harness, scope, configPath, cwdKey) {
	const text = readTextOrNull(configPath);
	if (!text) return false;
	const val = getAtPath(parse(text), entryPathFor(harness, scope, cwdKey));
	return val !== void 0 && val !== null;
}
function detectScope(harness, env, def) {
	const configPath = resolveConfigPath(harness, env, def.scope);
	const inRepo = def.projectPath ? resolveProjectRoot(env).isRepo : true;
	const collides = collidingScope(harness, env, def.scope) !== void 0;
	const available = Boolean(configPath) && inRepo && !collides;
	return {
		scope: def.scope,
		installKind: def.installKind,
		configPath: available ? configPath ?? "" : "",
		available,
		alreadyConfigured: available && configPath ? isServerConfigured(harness, def.scope, configPath, env.cwd) : false
	};
}
function detectOne(harness, env) {
	const scopes = harness.scopes.map((def) => detectScope(harness, env, def));
	const available = scopes.some((s) => s.available);
	const installed = detectSignalsFor(harness, env.platform).some((s) => signalMatches(s, env)) || scopes.some((s) => s.configPath !== "" && existsSync(s.configPath));
	const fallback = scopes.find((s) => s.scope === defaultScope(harness));
	return {
		id: harness.id,
		label: harness.label,
		installed,
		scopes,
		alreadyConfigured: fallback?.alreadyConfigured ?? false,
		configPath: fallback?.configPath ?? "",
		available,
		comingSoon: harness.comingSoon
	};
}
/** Synchronous detection over the whole catalog. Exported for tests. */
function detectSync(env = defaultEnv()) {
	return HARNESSES.map((h) => detectOne(h, env));
}

//#endregion
//#region ../mcp-harnesses/dist/node/exec.js
/** Upper bound on a client CLI invocation. `claude mcp add` is a local config
* edit — anything approaching this is hung, not slow. */
const COMMAND_TIMEOUT_MS = 3e4;
/** Keep a failing client's diagnostics readable in a multi-client report. */
const MAX_STDERR = 2e3;
/**
* Windows batch launchers (`.cmd` / `.bat`) cannot be spawned directly.
*
* Since the CVE-2024-27980 fix (Node 18.20.2 / 20.12.2 / 21.7.2),
* `execFileSync` on a `.cmd` without `shell: true` throws EINVAL. This
* matters because `npm i -g @anthropic-ai/claude-code` installs `claude.cmd`,
* so the entire npm-installed Windows population takes this path.
*/
function needsShell(binPath) {
	return /\.(cmd|bat)$/i.test(binPath);
}
/**
* Characters that change meaning inside a Windows command line. Only consulted
* on the `shell: true` path, which is the one case where an argument is
* re-parsed rather than passed through untouched.
*/
const SHELL_METACHARACTERS = /[&|<>^"%!`]/;
/**
* Run a harness CLI invocation, or explain why it was not run.
*
* Resolution uses {@link whichPathSync} — a pure `PATH` scan that spawns
* nothing, so the "is this installed" check can never itself be the thing
* that hangs. It returns the resolved path rather than a boolean because the
* extension decides how the command must be launched.
*/
function runHarnessCommandSync(argv, opts = {}) {
	const env = opts.env ?? defaultEnv();
	const dryRun = opts.dryRun ?? false;
	const [bin, ...args] = argv;
	if (!bin) return {
		executed: false,
		ok: false,
		reason: "empty-command"
	};
	if (dryRun) return {
		executed: false,
		ok: true,
		reason: "dry-run"
	};
	const binPath = whichPathSync(bin, env);
	if (!binPath) return {
		executed: false,
		ok: true,
		reason: "binary-not-found"
	};
	const useShell = needsShell(binPath);
	if (useShell && args.some((a) => SHELL_METACHARACTERS.test(a))) return {
		executed: false,
		ok: false,
		reason: "unsafe-argument"
	};
	try {
		execFileSync(binPath, args, {
			encoding: "utf8",
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			],
			timeout: COMMAND_TIMEOUT_MS,
			env: {
				...process.env,
				HOME: env.homedir,
				USERPROFILE: env.homedir
			},
			cwd: env.cwd,
			...useShell ? { shell: true } : {}
		});
		return {
			executed: true,
			ok: true
		};
	} catch (err) {
		const e = err;
		const raw = typeof e.stderr === "string" ? e.stderr : e.stderr?.toString("utf8") ?? "";
		return {
			executed: true,
			ok: false,
			...typeof e.status === "number" ? { exitCode: e.status } : {},
			stderr: (raw.trim() || e.message || "command failed").slice(0, MAX_STDERR)
		};
	}
}

//#endregion
//#region ../mcp-harnesses/dist/node/install.js
const FORMAT = {
	insertSpaces: true,
	tabSize: 2,
	eol: "\n"
};
/**
* Resolve the target path for a scope, or the reason it cannot be resolved.
* Shared by install and remove so the two can never disagree about where a
* scope lives.
*/
function resolveTarget(harness, env, scope) {
	const def = scopeDef(harness, scope);
	if (!def) return { reason: "unsupported-scope" };
	if (def.projectPath && !resolveProjectRoot(env).isRepo) return { reason: "not-a-repo" };
	const collides = collidingScope(harness, env, scope);
	if (collides) return {
		reason: "scope-collision",
		collidesWith: collides
	};
	const path = resolveConfigPath(harness, env, scope);
	if (!path) return { reason: "no-location" };
	return { path };
}
/**
* What the client currently holds for this scope, read from its own config.
*
* `url` is present for a `native-http` entry (`{ type: 'http', url }`); for an
* `mcp-remote` entry the URL is the last argv element. Absent `url` with
* `present: true` means an entry we cannot interpret — treated as a mismatch
* rather than assumed correct.
*/
function currentEntry(harness, env, scope) {
	const configPath = resolveConfigPath(harness, env, scope);
	if (!configPath) return { present: false };
	const entry = readServerEntry(harness, scope, configPath, env.cwd, (t) => parse(t));
	if (entry === void 0 || entry === null) return { present: false };
	const e = entry;
	if (typeof e.url === "string") return {
		present: true,
		url: e.url
	};
	if (Array.isArray(e.args)) {
		const last = e.args[e.args.length - 1];
		if (typeof last === "string") return {
			present: true,
			url: last
		};
	}
	return { present: true };
}
/** JSON-structural equality — sufficient for our small config values. */
function sameValue(a, b) {
	return JSON.stringify(a) === JSON.stringify(b);
}
/** Merge (or preview) our MCP into a harness config. */
function installHarnessSync(harness, mcpUrl, opts = {}) {
	const env = opts.env ?? defaultEnv();
	const dryRun = opts.dryRun ?? false;
	const scope = opts.scope ?? defaultScope(harness);
	const def = scopeDef(harness, scope);
	if (!def) return {
		ok: false,
		wrote: false,
		path: "",
		alreadyConfigured: false,
		dryRun,
		scope,
		reason: "unsupported-scope"
	};
	if (def.installKind === "cli-command") {
		const argv = renderHarnessCommand(harness, mcpUrl, scope);
		const base = {
			wrote: false,
			path: "",
			command: argv.join(" "),
			dryRun,
			scope
		};
		const existing$1 = currentEntry(harness, env, scope);
		if (existing$1.present) {
			if (existing$1.url === mcpUrl) return {
				...base,
				ok: true,
				executed: false,
				alreadyConfigured: true
			};
			return {
				...base,
				ok: false,
				executed: false,
				alreadyConfigured: false,
				reason: "url-mismatch",
				...existing$1.url ? { currentUrl: existing$1.url } : {}
			};
		}
		const run = opts.runCommand ?? runHarnessCommandSync;
		const outcome = opts.execute ?? true ? run(argv, {
			env,
			dryRun
		}) : {
			executed: false,
			ok: true,
			reason: "not-requested"
		};
		return {
			...base,
			ok: outcome.ok,
			executed: outcome.executed,
			...outcome.ok ? {} : { commandError: outcome.stderr },
			alreadyConfigured: false
		};
	}
	const target = resolveTarget(harness, env, scope);
	if ("reason" in target) return {
		ok: false,
		wrote: false,
		path: "",
		alreadyConfigured: false,
		dryRun,
		scope,
		reason: target.reason,
		...target.collidesWith ? { collidesWith: target.collidesWith } : {}
	};
	const { path } = target;
	const entryValue = buildServerEntry(harness, mcpUrl, scope)[SERVER_NAME];
	const modPath = entryPathFor(harness, scope, env.cwd);
	const existing = readTextOrNull(path);
	const baseText = existing && existing.trim() ? existing : "{}";
	const current = getAtPath(parse(baseText), modPath);
	const alreadyConfigured = current !== void 0 && sameValue(current, entryValue);
	const nextText = applyEdits(baseText, modify(baseText, modPath, entryValue, { formattingOptions: FORMAT }));
	if (alreadyConfigured) return {
		ok: true,
		wrote: false,
		path,
		alreadyConfigured: true,
		dryRun,
		scope,
		preview: nextText
	};
	if (dryRun) return {
		ok: true,
		wrote: false,
		path,
		alreadyConfigured: false,
		dryRun: true,
		scope,
		preview: nextText
	};
	mkdirSync(dirname(path), { recursive: true });
	const finalText = nextText.endsWith("\n") ? nextText : `${nextText}\n`;
	writeFileSync(path, finalText, "utf8");
	return {
		ok: true,
		wrote: true,
		path,
		alreadyConfigured: false,
		dryRun: false,
		scope,
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
/**
* Scope used when the caller passes no `--scope`.
*
* Uniform `user` for every harness (plan decision C1). A no-op for the
* config-file clients — that is already where they write — but a change for
* Claude Code, which previously inherited its OWN default of `local`. `user`
* is the only default that means the same thing everywhere, and it matches
* what someone running an installer once expects: available in every project.
*/
const DEFAULT_SCOPE = "user";
/** Harness ids to pre-select in interactive mode: detected + installable +
* not-already-configured. "Already configured" is judged in the scope we are
* about to install into, not the harness's default one. */
function autoSelectIds(detected, scope) {
	return detected.filter((d) => {
		if (!d.available || d.comingSoon || !d.installed) return false;
		const inScope = scope ? d.scopes.find((s) => s.scope === scope) : void 0;
		return !(inScope ? inScope.alreadyConfigured : d.alreadyConfigured);
	}).map((d) => d.id);
}
/**
* Build the client picker for the scope we are actually about to install
* into.
*
* Pure so it can be tested without a TTY — and it needs testing, because the
* question it answers is scope-dependent: a client configured at `user` is
* NOT configured at `project`, and labelling it "already set up" while
* installing to `project` is simply wrong.
*/
function clientChoices(detected, scope) {
	const preselect = new Set(autoSelectIds(detected, scope));
	return detected.filter((d) => d.available && !d.comingSoon).map((d) => {
		const inScope = d.scopes.find((s) => s.scope === scope);
		const harness = getHarness(d.id);
		let hint;
		if (!inScope) hint = `no ${scope} scope — will use ${harness ? defaultScope(harness) : DEFAULT_SCOPE}`;
		else if (inScope.alreadyConfigured) hint = `already set up (${scope})`;
		else hint = d.installed ? "detected" : "not detected";
		return {
			value: d.id,
			label: d.label,
			hint,
			selected: preselect.has(d.id)
		};
	});
}
/** Scopes worth offering for a selection: any scope at least one selected
* client can actually use here. Availability already accounts for "are we
* inside a repo", so project scope disappears outside one. */
function offerableScopes(selectedIds, detected) {
	return HARNESS_SCOPES.filter((scope) => selectedIds.some((id) => detected.find((d) => d.id === id)?.scopes.some((s) => s.scope === scope && s.available)));
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
/**
* Install each selected id, collecting structured outcomes.
*
* The unsupported-scope policy lives here, and it turns on HOW the client was
* selected — that is what says whether the user asserted this pairing:
*
* - named via `--client` → install at the requested scope and let it fail,
*   so the report says exactly what was refused and the run exits non-zero;
* - swept in by `--all` or a multiselect → fall back to the harness's own
*   scope and record `fallbackFrom`, so the report states what was used.
*
* A fallback is never silent.
*/
function installSelected(ids, plan, install) {
	const outcomes = [];
	for (const id of ids) {
		const harness = getHarness(id);
		if (!harness) continue;
		const canHonor = supportsScope(harness, plan.scope);
		const named = plan.namedIds.has(id);
		const effective = canHonor || named ? plan.scope : defaultScope(harness);
		outcomes.push({
			id,
			label: harness.label,
			result: install(harness, plan.mcpUrl, plan.dryRun, effective),
			...canHonor ? {} : named ? {} : { fallbackFrom: plan.scope }
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
	const scope = options.scope ?? DEFAULT_SCOPE;
	let ids;
	let unknown = [];
	let comingSoon = [];
	const byName = !options.all && (options.clients?.length ?? 0) > 0;
	if (options.all || byName) {
		const requested = resolveRequestedIds(options, detected);
		ids = requested.ids;
		unknown = requested.unknown;
		comingSoon = requested.comingSoon;
	} else ids = autoSelectIds(detected, scope);
	return {
		url,
		urlSource,
		scope,
		outcomes: installSelected(ids, {
			mcpUrl: url,
			dryRun: options.dryRun,
			scope,
			namedIds: new Set(byName ? ids : [])
		}, deps.install),
		unknownClients: unknown,
		comingSoonClients: comingSoon,
		dryRun: options.dryRun
	};
}
/** Why an install was refused, in the user's terms rather than the enum's. */
function failureText(o) {
	const r = o.result;
	const harness = getHarness(o.id);
	switch (r.reason) {
		case "unsupported-scope": return `no ${r.scope} scope` + (harness ? ` (supports: ${supportedScopes(harness).join(", ")})` : "");
		case "not-a-repo": return "project scope needs a git repository (run from inside one)";
		case "scope-collision": return `${r.scope} scope resolves to the same file as ${r.collidesWith ?? "another"} scope here — refusing rather than overwriting it`;
		case "url-mismatch": return "already configured with a different URL" + (r.currentUrl ? ` (${r.currentUrl})` : "") + "; remove it first, then re-run";
		default:
			if (r.commandError) return `\`${r.command}\` (${r.commandError})`;
			return "no config location on this platform";
	}
}
/** One human-readable status line per outcome. */
function outcomeLine(o, dryRun) {
	const r = o.result;
	const note = o.fallbackFrom ? ` [${o.fallbackFrom} scope unsupported — used ${r.scope}]` : "";
	const where = r.path ? ` → ${r.path}` : "";
	if (!r.ok) return `${o.label}: failed — ${failureText(o)}`;
	if (r.alreadyConfigured) return `${o.label}: already set up (${r.scope})${where}${note}`;
	if (r.command) {
		if (r.executed) return `${o.label}: installed (${r.scope}) via \`${r.command}\`${note}`;
		return `${o.label} (${r.scope}): run \`${r.command}\`${note}`;
	}
	if (dryRun) return `${o.label}: would update (${r.scope})${where} (dry run — no changes)${note}`;
	if (r.wrote) return `${o.label}: installed (${r.scope})${where}${note}`;
	return `${o.label}: no change (${r.scope})${where}${note}`;
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
	if (!report.outcomes.some((o) => o.result.wrote || o.result.executed || o.result.command)) return "Nothing to do.";
	const lines = ["Next: restart the client(s) above — each will prompt you to authorize", "Levr once in the browser. Then ask it: \"What issues are assigned to me?\""];
	if (report.outcomes.some((o) => o.result.scope === "project" && o.result.wrote)) lines.push("", "Project-scoped config was written into this repository — commit it to", "share the Levr MCP with everyone who checks it out.");
	return lines.join("\n");
}

//#endregion
//#region src/commands/mcp/addHandler.ts
const defaultInstall = (harness, mcpUrl, dryRun, scope) => installHarnessSync(harness, mcpUrl, {
	dryRun,
	scope
});
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
		dryRun: flags["dry-run"],
		scope: flags.scope
	};
	if (options.all || clients.length > 0 || options.yes || !process.stdout.isTTY) {
		const report = runNonInteractive(options, url, source, defaultDeps);
		this.process.stdout.write(`${formatReport(report)}\n`);
		this.process.stdout.write(`\n${nextStepsText(report)}\n`);
		if (report.unknownClients.length > 0 || hasFailure(report)) this.process.exitCode = 1;
		return;
	}
	await interactive(this, options.dryRun, url, source, flags.scope);
}
function hasFailure(report) {
	return report.outcomes.some((o) => !o.result.ok);
}
/** Human-readable meaning of each scope, for the interactive picker. */
const SCOPE_LABELS = {
	user: {
		label: "user",
		hint: "every project you open"
	},
	project: {
		label: "project",
		hint: "this repo, shared with your team via git"
	},
	local: {
		label: "local",
		hint: "this repo, only you"
	}
};
async function interactive(ctx, dryRun, url, urlSource, requestedScope) {
	const p = await import("@clack/prompts");
	p.intro("Levr MCP setup");
	p.note(`${url}\n(${urlSource})`, "MCP endpoint");
	const detected = defaultDeps.detect();
	const installable = detected.filter((d) => d.available && !d.comingSoon);
	if (installable.length === 0) {
		p.outro("No supported MCP clients found on this machine.");
		return;
	}
	const choices = offerableScopes(installable.map((d) => d.id), detected);
	let scope = requestedScope ?? DEFAULT_SCOPE;
	if (!requestedScope && choices.length > 1) {
		const picked = await p.select({
			message: "Where should Levr be available?",
			options: choices.map((s) => ({
				value: s,
				label: SCOPE_LABELS[s].label,
				hint: SCOPE_LABELS[s].hint
			})),
			initialValue: choices.includes(DEFAULT_SCOPE) ? DEFAULT_SCOPE : choices[0]
		});
		if (p.isCancel(picked)) {
			p.cancel("Cancelled.");
			ctx.process.exitCode = 1;
			return;
		}
		scope = picked;
	} else if (!requestedScope && choices.length === 1) scope = choices[0] ?? DEFAULT_SCOPE;
	const rows = clientChoices(detected, scope);
	const selection = await p.multiselect({
		message: `Select clients to set up (${scope} scope)`,
		options: rows.map((r) => ({
			value: r.value,
			label: r.label,
			hint: r.hint
		})),
		initialValues: rows.filter((r) => r.selected).map((r) => r.value),
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
	const outcomes = installSelected(selection, {
		mcpUrl: url,
		dryRun,
		scope,
		namedIds: /* @__PURE__ */ new Set()
	}, defaultDeps.install);
	spin.stop(dryRun ? "Preview ready" : "Done");
	const report = {
		url,
		urlSource,
		scope,
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