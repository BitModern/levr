import { getApiUrl } from "./env-CHeKHu5S.js";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { applyEdits, modify, parse, printParseErrorCode } from "jsonc-parser";
import { TomlError, parse as parse$1 } from "smol-toml";
import { execFileSync } from "node:child_process";

//#region ../mcp-harnesses/dist/format/toml-render.js
/**
* Value → TOML text, ISOMORPHIC (browser + Node), dependency-free.
*
* Two consumers, one implementation (ENG-5264 D5, audit C1):
* - `buildHarnessConfig` in the isomorphic catalog renders the pasteable
*   snippet a TOML client's card shows — so it must run in the client SPA,
*   which forbids `node:` imports and the `/node/` subpath (catalog.test.ts
*   isomorphic guard).
* - The node `tomlAdapter` renders the body of the table it writes into the
*   user's config file.
*
* Written once here so the snippet a user pastes by hand and the bytes the
* installer writes can never drift apart.
*
* Scope is deliberately what `buildServerEntry` produces: string, number,
* boolean, arrays of those, and nested plain objects. Anything else throws —
* a TOML file is never the place to discover a serializer guessed.
*/
/** Keys TOML lets us write without quotes. */
const BARE_KEY = /^[A-Za-z0-9_-]+$/;
/** A TOML key, quoted only when it has to be. */
function renderTomlKey(key) {
	return BARE_KEY.test(key) ? key : renderTomlString(key);
}
/**
* A TOML basic string with every escape TOML requires: backslash, double
* quote, the C0 controls, and DEL. Everything else (including non-ASCII) is
* written verbatim, which TOML permits in basic strings.
*/
function renderTomlString(value) {
	let out = "\"";
	for (const ch of value) {
		const code = ch.codePointAt(0) ?? 0;
		if (ch === "\"") out += "\\\"";
		else if (ch === "\\") out += "\\\\";
		else if (ch === "\n") out += "\\n";
		else if (ch === "\r") out += "\\r";
		else if (ch === "	") out += "\\t";
		else if (ch === "\b") out += "\\b";
		else if (ch === "\f") out += "\\f";
		else if (code < 32 || code === 127) out += `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`;
		else out += ch;
	}
	return out + "\"";
}
/** A scalar or array value on the right-hand side of `key = …`. */
function renderTomlValue(value) {
	if (typeof value === "string") return renderTomlString(value);
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error(`cannot render non-finite number ${String(value)} as TOML`);
		return String(value);
	}
	if (Array.isArray(value)) {
		if (value.length === 0) return "[]";
		return `[ ${value.map((v) => renderTomlValue(v)).join(", ")} ]`;
	}
	throw new Error(`cannot render a ${value === null ? "null" : typeof value} as a TOML value`);
}
function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/**
* The `key = value` lines for one table body, in the order the object's keys
* were declared, followed by sub-tables for any nested objects. Nested objects
* become `[path.key]` sub-tables rather than inline tables so the output stays
* one key per line — the shape both Codex and Grok Build write themselves.
*
* `pathPrefix` is the table this body belongs to, needed to name sub-tables.
* Returns lines WITHOUT line terminators; the caller picks `\n` or `\r\n`.
*/
function renderTomlBodyLines(value, pathPrefix) {
	const lines = [];
	const nested = [];
	for (const [key, v] of Object.entries(value)) {
		if (v === void 0) continue;
		if (isPlainObject(v)) {
			nested.push([key, v]);
			continue;
		}
		lines.push(`${renderTomlKey(key)} = ${renderTomlValue(v)}`);
	}
	for (const [key, v] of nested) {
		const path = [...pathPrefix, key];
		lines.push("", `[${path.map(renderTomlKey).join(".")}]`);
		lines.push(...renderTomlBodyLines(v, path));
	}
	return lines;
}

//#endregion
//#region ../mcp-harnesses/dist/catalog.js
/** The `{ url, type: "http" }` shape Claude Code and Gemini CLI write. */
const DEFAULT_NATIVE_HTTP_ENTRY = {
	urlKey: "url",
	constants: { type: "http" }
};
/**
* Provenance sentinel for entries that predate the invariant (ENG-5264 D1,
* decision ENG-5327). No observation record exists for the harnesses that
* carry it, and inventing a version or date would be exactly what the
* invariant forbids — so they say so, greppably: `grep unverified-legacy`
* names every entry still owing a real observation. An entry is upgraded to a
* real version + date whenever someone next installs that client, and is never
* downgraded back. A NEW entry must never be born carrying this value.
*/
const UNVERIFIED_LEGACY = "unverified-legacy";
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
* `comingSoon` clients (VS Code) are listed but not installable: their config
* format differs enough (VS Code's `servers`/native-http schema) that a
* faithful write is deferred. Their SCOPES are declared as data regardless, so
* the support matrix stays complete and turning them on later is a builder
* change, not a catalog change. Codex left this list in ENG-5264 once the TOML
* adapter existed.
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
		verifiedVersion: UNVERIFIED_LEGACY,
		verifiedOn: UNVERIFIED_LEGACY,
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
		verifiedVersion: UNVERIFIED_LEGACY,
		verifiedOn: UNVERIFIED_LEGACY,
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
		verifiedVersion: UNVERIFIED_LEGACY,
		verifiedOn: UNVERIFIED_LEGACY,
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
		verifiedVersion: UNVERIFIED_LEGACY,
		verifiedOn: UNVERIFIED_LEGACY,
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
		verifiedVersion: UNVERIFIED_LEGACY,
		verifiedOn: UNVERIFIED_LEGACY,
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
		id: "gemini",
		label: "Gemini CLI",
		matchers: ["gemini cli", "gemini-cli"],
		serverPropertyName: "mcpServers",
		transport: "native-http",
		docsUrl: "https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md",
		comingSoon: false,
		verifiedVersion: "0.35.1",
		verifiedOn: "2026-09-17",
		detectSignals: [
			{
				platform: "darwin",
				signals: ["which:gemini", "~/.gemini/settings.json"]
			},
			{
				platform: "linux",
				signals: ["which:gemini", "~/.gemini/settings.json"]
			},
			{
				platform: "win32",
				signals: ["which:gemini", "~/.gemini/settings.json"]
			}
		],
		scopes: [{
			scope: "user",
			installKind: "config-file",
			locations: [
				{
					platform: "darwin",
					configPath: "~/.gemini/settings.json"
				},
				{
					platform: "linux",
					configPath: "~/.gemini/settings.json"
				},
				{
					platform: "win32",
					configPath: "~/.gemini/settings.json"
				}
			]
		}, {
			scope: "project",
			installKind: "config-file",
			projectPath: ".gemini/settings.json"
		}]
	},
	{
		id: "grok",
		label: "Grok Build",
		matchers: ["grok build", "grok-build"],
		serverPropertyName: "mcp_servers",
		transport: "native-http",
		nativeHttpEntry: {
			urlKey: "url",
			constants: { enabled: true }
		},
		configFormat: "toml",
		docsUrl: "https://docs.x.ai/build/overview",
		comingSoon: false,
		verifiedVersion: "1.0.34",
		verifiedOn: "2026-09-17",
		detectSignals: [
			{
				platform: "darwin",
				signals: ["~/.grok/config.toml", "~/.grok/bin/grok"]
			},
			{
				platform: "linux",
				signals: ["~/.grok/config.toml", "~/.grok/bin/grok"]
			},
			{
				platform: "win32",
				signals: ["~/.grok/config.toml", "~/.grok/bin/grok.exe"]
			}
		],
		scopes: [{
			scope: "user",
			installKind: "config-file",
			locations: [
				{
					platform: "darwin",
					configPath: "~/.grok/config.toml"
				},
				{
					platform: "linux",
					configPath: "~/.grok/config.toml"
				},
				{
					platform: "win32",
					configPath: "~/.grok/config.toml"
				}
			]
		}, {
			scope: "project",
			installKind: "config-file",
			projectPath: ".grok/config.toml"
		}]
	},
	{
		id: "antigravity",
		label: "Antigravity",
		matchers: ["antigravity"],
		serverPropertyName: "mcpServers",
		transport: "native-http",
		nativeHttpEntry: {
			urlKey: "serverUrl",
			constants: { disabled: false }
		},
		docsUrl: "https://antigravity.google/docs/mcp",
		comingSoon: false,
		verifiedVersion: "1.2.5",
		verifiedOn: "2026-09-17",
		detectSignals: [
			{
				platform: "darwin",
				signals: [
					"which:agy",
					"~/.local/bin/agy",
					"/Applications/Antigravity IDE.app",
					"~/.gemini/config/mcp_config.json"
				]
			},
			{
				platform: "linux",
				signals: [
					"which:agy",
					"~/.local/bin/agy",
					"~/.gemini/config/mcp_config.json"
				]
			},
			{
				platform: "win32",
				signals: ["which:agy", "~/.gemini/config/mcp_config.json"]
			}
		],
		scopes: [{
			scope: "user",
			installKind: "config-file",
			locations: [
				{
					platform: "darwin",
					configPath: "~/.gemini/config/mcp_config.json"
				},
				{
					platform: "linux",
					configPath: "~/.gemini/config/mcp_config.json"
				},
				{
					platform: "win32",
					configPath: "~/.gemini/config/mcp_config.json"
				}
			]
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
		serverPropertyName: "mcp_servers",
		transport: "native-http",
		nativeHttpEntry: { urlKey: "url" },
		configFormat: "toml",
		docsUrl: "https://github.com/openai/codex",
		comingSoon: false,
		verifiedVersion: "0.154.0",
		verifiedOn: "2026-09-17",
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
* - `native-http`: the entry's declared {@link NativeHttpEntryShape} —
*   `{ url, type: 'http' }` by default (Claude Code's `.mcp.json`, Gemini).
* - `mcpServers` (Claude Desktop, Cursor, Windsurf): flat `{ command, args }`.
* - `context_servers` (Zed): nested `{ source, command: { path, args } }`.
*
* Not used for `cli-command` scopes (see {@link buildHarnessConfig}).
*/
function buildServerEntry(harness, mcpUrl, scope = defaultScope(harness)) {
	requireScope(harness, scope);
	if (harness.transport === "native-http") {
		const shape = harness.nativeHttpEntry ?? DEFAULT_NATIVE_HTTP_ENTRY;
		return { [SERVER_NAME]: {
			[shape.urlKey]: mcpUrl,
			...shape.constants ?? {}
		} };
	}
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
//#region ../mcp-harnesses/dist/node/format/port.js
/**
* Outbound port: a config DOCUMENT the installer can read a value out of and
* surgically edit, without the domain knowing what syntax the file is in.
*
* `installHarnessSync` / `removeHarnessSync` (`../install.ts`) and detection
* (`../detect.ts`) speak only this interface; each concrete format lives in a
* sibling adapter and is selected by the DECLARATIVE `configFormat` field on
* the catalog entry (`adapterFor`, `./index.ts`). No harness id, and no format
* name, ever reaches the domain — plan ENG-5264 §2.
*
* ## The failure channel is part of the contract (review F-002)
*
* A read has THREE outcomes, not two. `absent` is the state the domain answers
* by writing a fresh entry into an empty document; `unsupported` is the state
* it must REFUSE on — a non-empty file that does not parse, or a document in
* which our key sits in a shape the adapter cannot edit in place. Collapsing
* the two (returning `undefined` for both) is how a real user config gets
* treated as empty and overwritten. That is why `readAt` returns a tagged
* union rather than `unknown`, and why the mutators throw a typed error
* instead of best-effort restructuring a document they did not understand.
*/
/**
* Thrown by {@link ConfigDocumentAdapter.setAt} / `removeAt` when the edit
* cannot be made without restructuring content the adapter does not fully
* understand. The domain catches it and refuses the install — fail closed.
*/
var UnsupportedConfigShapeError = class extends Error {
	detail;
	constructor(detail) {
		super(detail);
		this.detail = detail;
		this.name = "UnsupportedConfigShapeError";
	}
};

//#endregion
//#region ../mcp-harnesses/dist/node/format/jsonc.js
const FORMAT = {
	insertSpaces: true,
	tabSize: 2,
	eol: "\n"
};
/**
* Parse strictly enough to be safe: any syntax error is a refusal, never a
* partial document. Returns the root, or the reason it cannot be used.
*/
function parseDocument$1(text) {
	const errors = [];
	const root = parse(text, errors, {
		allowTrailingComma: true,
		disallowComments: false
	});
	const first = errors[0];
	if (first) return {
		ok: false,
		detail: `document does not parse (${printParseErrorCode(first.error)} at offset ${first.offset})`
	};
	if (root === null || typeof root !== "object" || Array.isArray(root)) return {
		ok: false,
		detail: "document root is not an object"
	};
	return {
		ok: true,
		root
	};
}
const jsoncAdapter = {
	empty: "{}",
	readAt(text, path) {
		if (text.trim() === "") return { kind: "absent" };
		const doc = parseDocument$1(text);
		if (!doc.ok) return {
			kind: "unsupported",
			detail: doc.detail
		};
		const value = getAtPath(doc.root, path);
		return value === void 0 ? { kind: "absent" } : {
			kind: "value",
			value
		};
	},
	setAt(text, path, value) {
		return edit(text, path, value);
	},
	removeAt(text, path) {
		return edit(text, path, void 0);
	}
};
/** Shared by set and remove: jsonc-parser removes a key when `value` is `undefined`. */
function edit(text, path, value) {
	const doc = parseDocument$1(text);
	if (!doc.ok) throw new UnsupportedConfigShapeError(doc.detail);
	try {
		return applyEdits(text, modify(text, path, value, { formattingOptions: FORMAT }));
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new UnsupportedConfigShapeError(`cannot edit path ${path.join(".")}: ${message}`);
	}
}

//#endregion
//#region ../mcp-harnesses/dist/node/format/toml.js
/**
* Suffix of the one-shot sibling backup the domain writes before the FIRST
* modifying write to a TOML target (review F-005): `config.toml.levr-bak`.
* Declared here, applied format-generically by the installer.
*/
const TOML_BACKUP_SUFFIX = ".levr-bak";
const BOM = "﻿";
function parseDocument(text) {
	try {
		return {
			ok: true,
			root: parse$1(stripBom(text))
		};
	} catch (err) {
		if (err instanceof TomlError) return {
			ok: false,
			detail: `document does not parse: ${err.message.split("\n")[0] ?? err.message} (line ${err.line}, col ${err.column})`
		};
		return {
			ok: false,
			detail: `document does not parse: ${err instanceof Error ? err.message : String(err)}`
		};
	}
}
/**
* `smol-toml` does not strip a UTF-8 byte-order mark, and Windows editors
* write one (code review F-006). The BOM is document decoration: parse and
* edit the text behind it, put it back on the way out.
*/
function stripBom(text) {
	return text.startsWith(BOM) ? text.slice(1) : text;
}
function splitLines(text) {
	const lines = [];
	const eols = [];
	let crlf = 0;
	let lf = 0;
	let from = 0;
	for (let i = 0; i < text.length; i++) {
		if (text[i] !== "\n") continue;
		const cr = i > 0 && text[i - 1] === "\r";
		lines.push(text.slice(from, cr ? i - 1 : i));
		eols.push(cr ? "\r\n" : "\n");
		if (cr) crlf++;
		else lf++;
		from = i + 1;
	}
	lines.push(text.slice(from));
	eols.push("");
	return {
		lines,
		eols,
		eol: crlf > lf ? "\r\n" : "\n"
	};
}
function joinLines(lines, eols) {
	let out = "";
	for (let i = 0; i < lines.length; i++) out += lines[i] + (eols[i] ?? "");
	return out;
}
/** Leading whitespace then `[` — the shape every table header shares. */
function isBracketLed(line) {
	return /^[ \t]*\[/.test(line);
}
/**
* The key path of a `[table.header]` line, or `undefined` when the line is
* not a standard-table header this scanner can read. Array-of-tables
* (`[[x]]`) and comment lines never match; a trailing `# comment` may
* contain anything, brackets included. Segments may be bare, `"basic"` (with
* escapes) or `'literal'` keys.
*
* `undefined` means "not OUR table" and nothing more — see the module
* comment for why an unreadable header still ends a body.
*/
function headerPathOf(line) {
	let i = 0;
	while (line[i] === " " || line[i] === "	") i++;
	if (line[i] !== "[" || line[i + 1] === "[") return void 0;
	i++;
	const segments = [];
	let current = "";
	let sawSegment = false;
	let closed = false;
	while (i < line.length) {
		const ch = line[i];
		if (ch === " " || ch === "	") {
			i++;
			continue;
		}
		if (ch === "]") {
			closed = true;
			i++;
			break;
		}
		if (ch === "\"") {
			const end = scanBasicString(line, i);
			if (end === -1) return void 0;
			const unescaped = unescapeBasic(line.slice(i + 1, end));
			if (unescaped === void 0) return void 0;
			current += unescaped;
			i = end + 1;
			sawSegment = true;
			continue;
		}
		if (ch === "'") {
			const close = line.indexOf("'", i + 1);
			if (close === -1) return void 0;
			current += line.slice(i + 1, close);
			i = close + 1;
			sawSegment = true;
			continue;
		}
		if (ch === ".") {
			if (!sawSegment) return void 0;
			segments.push(current);
			current = "";
			sawSegment = false;
			i++;
			continue;
		}
		if (/[A-Za-z0-9_-]/.test(ch)) {
			current += ch;
			sawSegment = true;
			i++;
			continue;
		}
		return;
	}
	if (!closed || !sawSegment) return void 0;
	const rest = line.slice(i);
	if (!/^[ \t]*(#.*)?$/.test(rest)) return void 0;
	segments.push(current);
	return segments;
}
/** Index of the closing quote of the basic string opening at `open`, or -1. */
function scanBasicString(line, open) {
	for (let i = open + 1; i < line.length; i++) {
		if (line[i] === "\\") {
			i++;
			continue;
		}
		if (line[i] === "\"") return i;
	}
	return -1;
}
/** TOML basic-string escapes are a subset of JSON's, so JSON can decode them. */
function unescapeBasic(raw) {
	try {
		const value = JSON.parse(`"${raw}"`);
		return typeof value === "string" ? value : void 0;
	} catch {
		return;
	}
}
const PROBE_KEY = "__levr_header_probe__";
/**
* What is the bracket-led line at `idx`? Swap it for a probe header and ask
* the parser:
*
* - `'real'`: the probe table appeared at the root — the line was a genuine
*   header at document level.
* - `'text'`: the document still parses and the probe did NOT appear — the
*   line is content inside a multi-line string. It changed the string, not
*   the document's shape.
* - `'unknown'`: the swap broke the document. Nothing is proven either way.
*/
function probeHeader(doc, idx) {
	const probe = [...doc.lines];
	probe[idx] = `[${PROBE_KEY}]`;
	const parsed = parseDocument(joinLines(probe, doc.eols));
	if (!parsed.ok) return "unknown";
	return Object.prototype.hasOwnProperty.call(parsed.root, PROBE_KEY) ? "real" : "text";
}
function samePath(a, b) {
	return a.length === b.length && a.every((s, i) => s === b[i]);
}
function isSubPath(path, prefix) {
	return path.length > prefix.length && prefix.every((s, i) => s === path[i]);
}
/**
* Locate our table: the header line index and the index just past its body.
* `undefined` when there is no standalone header for `path`.
*
* The START must be a fully parsed header for exactly `path`, confirmed
* real. The END is the first bracket-led line after it that is neither one
* of our own sub-tables nor proven to be string content — a header the path
* scanner cannot read, or one whose probe breaks the document, still ends
* the body. Misjudging a line can only make our region smaller.
*/
function locateTable(doc, path) {
	const { lines } = doc;
	let start = -1;
	for (let i = 0; i < lines.length; i++) {
		const hp = headerPathOf(lines[i]);
		if (hp && samePath(hp, path) && probeHeader(doc, i) === "real") {
			start = i;
			break;
		}
	}
	if (start === -1) return void 0;
	const last = lines.length - 1;
	const limit = lines[last] === "" ? last : lines.length;
	let end = limit;
	for (let i = start + 1; i < limit; i++) {
		if (!isBracketLed(lines[i])) continue;
		const verdict = probeHeader(doc, i);
		if (verdict === "text") continue;
		const hp = headerPathOf(lines[i]);
		if (hp && isSubPath(hp, path) && verdict === "real") continue;
		end = i;
		break;
	}
	while (end - 1 > start && /^[ \t]*(#.*)?$/.test(lines[end - 1])) end--;
	return {
		start,
		end
	};
}
function requireEditable(text, path) {
	const parsed = parseDocument(text);
	if (!parsed.ok) throw new UnsupportedConfigShapeError(parsed.detail);
	return {
		doc: splitLines(text),
		exists: getAtPath(parsed.root, path) !== void 0
	};
}
function notStandalone(path) {
	return new UnsupportedConfigShapeError(`${path.join(".")} exists but not as a standalone [${path.join(".")}] table (inline table or dotted key) — refusing to restructure it`);
}
const tomlAdapter = {
	empty: "",
	backupSuffix: TOML_BACKUP_SUFFIX,
	readAt(text, path) {
		if (stripBom(text).trim() === "") return { kind: "absent" };
		const doc = parseDocument(text);
		if (!doc.ok) return {
			kind: "unsupported",
			detail: doc.detail
		};
		const value = getAtPath(doc.root, path);
		return value === void 0 ? { kind: "absent" } : {
			kind: "value",
			value
		};
	},
	setAt(text, path, value) {
		if (value === null || typeof value !== "object" || Array.isArray(value)) throw new UnsupportedConfigShapeError(`a TOML table body must be an object, got ${value === null ? "null" : Array.isArray(value) ? "array" : typeof value}`);
		const body = value;
		const bom = text.startsWith(BOM) ? BOM : "";
		const inner = stripBom(text);
		if (inner.trim() === "") return bom + renderTable(path, body, inner.includes("\r\n") ? "\r\n" : "\n");
		const { doc, exists } = requireEditable(inner, path);
		const table = locateTable(doc, path);
		if (!table) {
			if (exists) throw notStandalone(path);
			const { eol } = doc;
			let base = inner.endsWith("\n") ? inner : inner + eol;
			if (!/\r?\n\r?\n$/.test(base)) base += eol;
			return bom + base + renderTable(path, body, eol);
		}
		const rendered = renderTomlBodyLines(body, path);
		const atEof = table.end === doc.lines.length;
		return bom + joinLines([
			...doc.lines.slice(0, table.start + 1),
			...rendered,
			...doc.lines.slice(table.end)
		], [
			...doc.eols.slice(0, table.start + 1),
			...rendered.map((_, i) => atEof && i === rendered.length - 1 ? "" : doc.eol),
			...doc.eols.slice(table.end)
		]);
	},
	removeAt(text, path) {
		const bom = text.startsWith(BOM) ? BOM : "";
		const inner = stripBom(text);
		if (inner.trim() === "") return text;
		const { doc, exists } = requireEditable(inner, path);
		if (!exists) return text;
		const table = locateTable(doc, path);
		if (!table) throw notStandalone(path);
		const lines = [...doc.lines.slice(0, table.start), ...doc.lines.slice(table.end)];
		const eols = [...doc.eols.slice(0, table.start), ...doc.eols.slice(table.end)];
		const at = table.start;
		if (at === 0) {
			if (lines[0] === "" && lines.length > 1) {
				lines.splice(0, 1);
				eols.splice(0, 1);
			}
		} else if (lines[at - 1] === "" && (at >= lines.length || lines[at] === "")) {
			lines.splice(at - 1, 1);
			eols.splice(at - 1, 1);
		}
		return bom + joinLines(lines, eols);
	}
};
function renderTable(path, body, eol) {
	return [`[${path.map(renderTomlKey).join(".")}]`, ...renderTomlBodyLines(body, path)].join(eol) + eol;
}

//#endregion
//#region ../mcp-harnesses/dist/node/format/index.js
/** Every syntax the installer can write, keyed by the catalog's `configFormat`. */
const ADAPTERS = {
	jsonc: jsoncAdapter,
	toml: tomlAdapter
};
/** The format a harness declares, with the catalog's documented default. */
function configFormatOf(harness) {
	return harness.configFormat ?? "jsonc";
}
/** The adapter for this harness's config syntax. */
function adapterFor(harness) {
	const format = configFormatOf(harness);
	const adapter = ADAPTERS[format];
	if (!adapter) throw new Error(`no config adapter registered for configFormat "${format}" (declared by harness "${harness.id}")`);
	return adapter;
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
	const read = adapterFor(harness).readAt(text, entryPathFor(harness, scope, cwdKey));
	return read.kind === "value" && read.value !== null;
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
	const adapter = adapterFor(harness);
	const entry = readServerEntry(harness, scope, configPath, env.cwd, (t) => {
		const read = adapter.readAt(t, []);
		return read.kind === "value" ? read.value : void 0;
	});
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
/**
* Structural equality, key order ignored. A client that writes its keys in a
* different order than we do (Antigravity sorts them; older versions of our
* own writer put `type` before `url`) must still read as already configured,
* or every install becomes a perpetual rewrite.
*/
function sameValue(a, b) {
	return canonical(a) === canonical(b);
}
function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== void 0).sort(([x], [y]) => x < y ? -1 : x > y ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
	return JSON.stringify(value) ?? "undefined";
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
	const adapter = adapterFor(harness);
	const existing = readTextOrNull(path);
	const baseText = existing && existing.trim() ? existing : adapter.empty;
	const current = adapter.readAt(baseText, modPath);
	if (current.kind === "unsupported") return unsupportedShape(path, dryRun, scope, current.detail);
	const alreadyConfigured = current.kind === "value" && sameValue(current.value, entryValue);
	let nextText;
	try {
		nextText = adapter.setAt(baseText, modPath, entryValue);
	} catch (err) {
		if (err instanceof UnsupportedConfigShapeError) return unsupportedShape(path, dryRun, scope, err.detail);
		throw err;
	}
	if (alreadyConfigured) return {
		ok: true,
		wrote: false,
		path,
		alreadyConfigured: true,
		dryRun,
		scope,
		preview: nextText
	};
	const backupPath = backupPathFor(path, adapter.backupSuffix);
	if (dryRun) return {
		ok: true,
		wrote: false,
		path,
		alreadyConfigured: false,
		dryRun: true,
		scope,
		preview: nextText,
		...backupPath ? { backupPath } : {}
	};
	const finalText = nextText.endsWith("\n") ? nextText : `${nextText}\n`;
	try {
		mkdirSync(dirname(path), { recursive: true });
		if (backupPath) backupOnce(path, backupPath);
		writeConfigAtomic(path, finalText);
	} catch (err) {
		return writeFailed(path, scope, err);
	}
	return {
		ok: true,
		wrote: true,
		path,
		alreadyConfigured: false,
		dryRun: false,
		scope,
		preview: finalText,
		...backupPath ? { backupPath } : {}
	};
}
/**
* Where the one-shot backup of an existing `path` lives, for an adapter that
* asks for one — `undefined` when the format does not, or when there is no
* original to protect yet.
*/
function backupPathFor(path, suffix) {
	if (!suffix || !existsSync(path)) return void 0;
	return `${path}${suffix}`;
}
/** Copy the original once. An existing backup is never overwritten. */
function backupOnce(path, backupPath) {
	if (existsSync(backupPath)) return;
	copyFileSync(path, backupPath);
}
/** The refusal every format shares: the file is there, and we will not touch it. */
function unsupportedShape(path, dryRun, scope, detail) {
	return {
		ok: false,
		wrote: false,
		path,
		alreadyConfigured: false,
		dryRun,
		scope,
		reason: "unsupported-config-shape",
		detail
	};
}
/** The filesystem said no: report it per client instead of aborting the run. */
function writeFailed(path, scope, err) {
	return {
		ok: false,
		wrote: false,
		path,
		alreadyConfigured: false,
		dryRun: false,
		scope,
		reason: "write-failed",
		detail: err instanceof Error ? err.message : String(err)
	};
}
/**
* Replace `path`'s contents atomically: the new text goes to a sibling temp
* file that is then renamed over the target, so an interrupted write (ENOSPC,
* a kill, sleep) leaves the ORIGINAL file intact rather than a truncated one,
* and a concurrent reader sees either the old document or the new one. The
* original mode is preserved (a `0600` config stays `0600`).
*
* This matters more than it did: a harness config can be the file that also
* holds a user's model providers, profiles and sandbox policy (review F-005).
*/
function writeConfigAtomic(path, text) {
	let target = path;
	let mode;
	try {
		target = realpathSync(path);
		mode = statSync(target).mode & 511;
	} catch {}
	const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.tmp`);
	writeFileSync(tmp, text, {
		encoding: "utf8",
		...mode !== void 0 ? { mode } : {}
	});
	try {
		if (mode !== void 0) chmodSync(tmp, mode);
		renameSync(tmp, target);
	} catch (err) {
		try {
			unlinkSync(tmp);
		} catch {}
		throw err;
	}
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
		case "write-failed": return `its config could not be written` + (r.detail ? ` (${r.detail})` : "") + `; check the file's permissions and re-run`;
		case "unsupported-config-shape": return `its config could not be edited safely` + (r.detail ? ` (${r.detail})` : "") + `; fix the file or add the entry by hand`;
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
	const backup = r.backupPath ? dryRun ? ` [original would be backed up to ${r.backupPath}]` : ` [original backed up to ${r.backupPath}]` : "";
	if (!r.ok) return `${o.label}: failed — ${failureText(o)}`;
	if (r.alreadyConfigured) return `${o.label}: already set up (${r.scope})${where}${note}`;
	if (r.command) {
		if (r.executed) return `${o.label}: installed (${r.scope}) via \`${r.command}\`${note}`;
		return `${o.label} (${r.scope}): run \`${r.command}\`${note}`;
	}
	if (dryRun) return `${o.label}: would update (${r.scope})${where} (dry run — no changes)${backup}${note}`;
	if (r.wrote) return `${o.label}: installed (${r.scope})${where}${backup}${note}`;
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
	let url;
	let source;
	try {
		({url, source} = resolveMcpUrl(flags.url));
	} catch (err) {
		this.logger.error(err instanceof Error ? err.message : "Could not resolve the MCP URL.");
		this.process.exitCode = 1;
		return;
	}
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