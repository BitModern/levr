import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

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
		const path$1 = [...pathPrefix, key];
		lines.push("", `[${path$1.map(renderTomlKey).join(".")}]`);
		lines.push(...renderTomlBodyLines(v, path$1));
	}
	return lines;
}

//#endregion
//#region ../mcp-harnesses/dist/catalog.js
/**
* Sentinel for {@link AutoApproveDescriptor.file}: the permission key lives in
* the same file this scope's MCP server entry is written to (Zed keeps both in
* `settings.json`), so the path is resolved exactly as the install resolves it.
*/
const SAME_FILE_AS_MCP_CONFIG = "<mcp-config-file>";
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
/** Default server key written into every harness config (used by detect/remove).
* Renamed from the legacy brand key pre-first-publish (ENG-2515) — this key
* is a persisted identity in end-users' client config files, so it must not
* carry the old brand. A caller may write under another name (ENG-6300 D6:
* `levr mcp add --name`) so a second workspace can sit beside the first. */
const DEFAULT_SERVER_NAME = "levr";
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
/**
* `~/.claude.json` on every platform — read for detection, never written by us.
* `~` is `$CLAUDE_CONFIG_DIR` when that is set (see `configDirEnv`).
*/
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
* The catalog. Order is presentation order: the agent CLIs first (Claude
* Desktop, Claude Code, Codex CLI, Grok Build, Antigravity, Gemini CLI), then
* the IDEs (Cursor, Windsurf, Zed, VS Code) — ENG-7100. Every surface that
* lists clients iterates this array unsorted, so this is the one place order
* is decided; `catalog.test.ts` pins it.
*
* Every entry is installable, and there is no deferral flag: the old
* coming-soon flag was retired in ENG-5558 once its last member left. Codex
* became installable in ENG-5264 when the TOML adapter existed, and VS Code
* in ENG-5558 when its file was observed — its `servers` key and native-http
* entry were already expressible as declared data (`serverPropertyName`,
* {@link DEFAULT_NATIVE_HTTP_ENTRY}), so enabling it was a catalog change and
* nothing under `src/node/` moved. A client whose file cannot be written
* faithfully yet does not belong in this list; add it when its bytes have
* been observed, born with real provenance.
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
		verifiedVersion: UNVERIFIED_LEGACY,
		verifiedOn: UNVERIFIED_LEGACY,
		configDirEnv: "CLAUDE_CONFIG_DIR",
		autoApprove: {
			file: {
				user: "~/.claude/settings.json",
				project: ".claude/settings.json",
				local: ".claude/settings.local.json"
			},
			format: "json",
			keyPath: ["permissions", "allow"],
			shape: "allow-list",
			entry: (serverName, tool) => `mcp__${serverName}__${tool}`,
			configDirReplaces: "~/.claude",
			docsUrl: "https://code.claude.com/docs/en/permissions",
			verifiedOn: "2026-10-09"
		},
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
				projectKeyedUnder: "projects"
			}
		]
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
		verifiedVersion: "0.162.1",
		verifiedOn: "2026-10-16",
		configDirEnv: "CODEX_HOME",
		configDirReplaces: "~/.codex",
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
			projectPath: ".codex/config.toml",
			note: "Codex loads .codex/config.toml only once it trusts this repo: accept the trust prompt on first launch, or set trust_level = \"trusted\" under [projects.\"<repo path>\"] in your Codex config (~/.codex/config.toml, or $CODEX_HOME/config.toml when CODEX_HOME is set)"
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
		verifiedVersion: "1.4.0",
		verifiedOn: "2026-10-16",
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
		}, {
			scope: "project",
			installKind: "config-file",
			projectPath: ".agents/mcp_config.json"
		}]
	},
	{
		id: "gemini",
		label: "Gemini CLI",
		matchers: ["gemini cli", "gemini-cli"],
		serverPropertyName: "mcpServers",
		transport: "native-http",
		docsUrl: "https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md",
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
		id: "cursor",
		label: "Cursor",
		matchers: ["cursor"],
		serverPropertyName: "mcpServers",
		transport: "mcp-remote",
		docsUrl: "https://cursor.com/docs/mcp",
		verifiedVersion: UNVERIFIED_LEGACY,
		verifiedOn: UNVERIFIED_LEGACY,
		autoApprove: {
			file: {
				user: "~/.cursor/permissions.json",
				project: ".cursor/permissions.json"
			},
			format: "json",
			keyPath: ["mcpAllowlist"],
			shape: "allow-list",
			entry: (serverName, tool) => `${serverName}:${tool}`,
			appendOnlyToExistingKey: true,
			caveat: "Cursor: Levr only adds to an mcpAllowlist this file already has. It never creates one, because once mcpAllowlist exists here it replaces the MCP allowlist kept in Cursor Settings. The entries only take effect when Run Mode in Cursor Settings uses an allowlist.",
			docsUrl: "https://cursor.com/docs/reference/permissions",
			verifiedOn: "2026-10-09"
		},
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
		verifiedVersion: UNVERIFIED_LEGACY,
		verifiedOn: UNVERIFIED_LEGACY,
		autoApprove: {
			file: { user: SAME_FILE_AS_MCP_CONFIG },
			format: "json",
			keyPath: [
				"agent",
				"tool_permissions",
				"tools"
			],
			shape: "tool-map",
			entry: (serverName, tool) => `mcp:${serverName}:${tool}`,
			toolValue: { default: "allow" },
			caveat: "Zed: per-tool permissions need Zed v0.224.0 or later.",
			docsUrl: "https://zed.dev/docs/ai/tool-permissions",
			verifiedOn: "2026-10-09"
		},
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
		serverPropertyName: "servers",
		transport: "native-http",
		docsUrl: "https://code.visualstudio.com/docs/copilot/chat/mcp-servers",
		verifiedVersion: "1.111.0",
		verifiedOn: "2026-09-21",
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
* `serverName` defaults to {@link DEFAULT_SERVER_NAME}; see {@link buildHarnessConfig}.
*/
function renderHarnessCommand(harness, mcpUrl, scope, serverName = DEFAULT_SERVER_NAME) {
	const def = requireScope(harness, scope);
	if (!def.command) throw new Error(`harness "${harness.id}" scope "${scope}" declares no command argv`);
	const substitutions = {
		"{name}": serverName,
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
* keyed by `serverName` (default {@link DEFAULT_SERVER_NAME}). Shape is per-transport,
* then per-property:
* - `native-http`: the entry's declared {@link NativeHttpEntryShape} —
*   `{ url, type: 'http' }` by default (Claude Code's `.mcp.json`, Gemini).
* - `mcpServers` (Claude Desktop, Cursor, Windsurf): flat `{ command, args }`.
* - `context_servers` (Zed): nested `{ source, command: { path, args } }`.
*
* Not used for `cli-command` scopes (see {@link buildHarnessConfig}).
*/
function buildServerEntry(harness, mcpUrl, scope = defaultScope(harness), serverName = DEFAULT_SERVER_NAME) {
	requireScope(harness, scope);
	if (harness.transport === "native-http") {
		const shape = harness.nativeHttpEntry ?? DEFAULT_NATIVE_HTTP_ENTRY;
		return { [serverName]: {
			[shape.urlKey]: mcpUrl,
			...shape.constants ?? {}
		} };
	}
	const { command, args } = mcpRemoteInvocation(mcpUrl);
	if (serverPropertyFor(harness, scope) === "context_servers") return { [serverName]: {
		source: "custom",
		command: {
			path: command,
			args
		}
	} };
	return { [serverName]: {
		command,
		args
	} };
}
/** The workspace a scoped MCP URL names (`…/w/<url_key>`), if any. */
function workspaceKeyOf(url) {
	const m = /\/w\/([^/]+)$/.exec(url.replace(/\/+$/, ""));
	if (!m?.[1]) return void 0;
	try {
		return decodeURIComponent(m[1]);
	} catch {
		return m[1];
	}
}
/**
* Allowed client entry names: 1-64 of `A-Za-z0-9_-`, and never starting with
* `-`. The name is passed as an argv element to the client's own CLI
* (`claude mcp add … <name> <url>`), so a leading `-` would be read there as a
* flag — the ENG-4159 argument-injection family.
*/
const ENTRY_NAME = /^[A-Za-z0-9_-]{1,64}$/;
function isValidEntryName(name) {
	return ENTRY_NAME.test(name) && !name.startsWith("-");
}
/** Claude Code tool names are `mcp__<entry>__<tool>`; keep that well short. */
const BESIDE_NAME_MAX = 30;
/**
* The name for a second entry beside `serverName`: `<serverName>-<url_key>`,
* so it says which workspace it is. Undefined — and "Add beside it" is not
* offered — when the target URL names no workspace, or when that name would
* be too long or not a valid entry name. It is never shortened: a cut name
* could drop the workspace, or give two workspaces the same entry.
*/
function besideName(serverName, url) {
	const key = workspaceKeyOf(url);
	if (!key) return void 0;
	const name = `${serverName}-${key}`;
	return name.length <= BESIDE_NAME_MAX && isValidEntryName(name) ? name : void 0;
}

//#endregion
//#region ../mcp-harnesses/dist/node/paths.js
function defaultEnv() {
	return {
		platform: process.platform,
		homedir: homedir(),
		pathVar: process.env.PATH ?? "",
		cwd: process.cwd(),
		vars: process.env
	};
}
/**
* A config path or signal with `~` expanded. When the harness's `configDirEnv`
* is set to a non-empty value, the prefix it stands for (`configDirReplaces`,
* `~` by default) resolves to that directory instead (ENG-6696, ENG-6761). A
* relative value resolves against `env.cwd`, the directory a spawned client
* CLI runs in, so the probe and the client read one file.
*/
function expandConfigPath(p, harness, env) {
	const dir = harness.configDirEnv ? env.vars?.[harness.configDirEnv] : void 0;
	if (dir) {
		const prefix = harness.configDirReplaces ?? "~";
		if (p === prefix) return resolve(env.cwd, dir);
		if (p.startsWith(`${prefix}/`) || p.startsWith(`${prefix}\\`)) return join(resolve(env.cwd, dir), p.slice(prefix.length + 1));
	}
	return expandTilde(p, env.homedir);
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
	return expandConfigPath(loc.configPath, harness, env);
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
* The key Claude Code files a `local`-scope entry under, in `projects[...]`,
* for a client run from `env.cwd` (ENG-6696, observed on 2.1.296).
*
* It is the PROJECT, not the directory: from `repo/sub` the key is `repo`.
* A linked git worktree keys to its MAIN checkout (the parent of the common
* `.git`), a worktree of a bare repository to the bare directory, and a
* submodule or `--separate-git-dir` checkout to its own work tree. Outside a
* repository it is the directory itself. Always a real path, with `/`
* separators on Windows (unverified there: drive-letter case). Claude reads
* only this key, so an entry under any other key is invisible to it, and a
* probe that looked elsewhere missed the entry and let `claude mcp add`
* refuse.
*/
function projectKeyFor(env) {
	return configKey(projectDir(env), env.platform);
}
/** Claude Code writes `projects` keys with `/` on Windows too. */
function configKey(dir, platform) {
	return platform === "win32" ? dir.replaceAll("\\", "/") : dir;
}
function projectDir(env) {
	const cwd = realOrResolved(env.cwd);
	const workTree = findRepoRoot(cwd);
	if (!workTree) return cwd;
	const dotGit = join(workTree, ".git");
	let gitDir = dotGit;
	try {
		if (statSync(dotGit).isFile()) {
			const m = /^gitdir:\s*([^\r\n]+)/.exec(readFileSync(dotGit, "utf8").trim());
			if (!m?.[1]) return workTree;
			gitDir = resolve(workTree, m[1].trim());
		}
	} catch {
		return workTree;
	}
	const commonFile = readTextOrNull(join(gitDir, "commondir"));
	if (commonFile === null) return workTree;
	const common = realOrResolved(resolve(gitDir, commonFile.trim()));
	if (!existsSync(common)) return workTree;
	if (realOrResolved(dirname(gitDir)) !== join(common, "worktrees")) return workTree;
	const back = readTextOrNull(join(gitDir, "gitdir"));
	if (back === null || realOrResolved(dirname(resolve(gitDir, back.trim()))) !== workTree) return workTree;
	if (basename(common) === ".git") return dirname(common);
	return existsSync(join(common, ".git")) ? workTree : common;
}
function realOrResolved(p) {
	try {
		return realpathSync(p);
	} catch {
		return resolve(p);
	}
}
/**
* Where our server entry sits INSIDE a scope's config file.
*
* Usually `[<serverProperty>, 'levr']` at the top level. A scope declaring
* `projectKeyedUnder` nests one level deeper, under the project key: Claude
* Code's `local` scope lives at `projects[<key>].mcpServers.levr` in
* `~/.claude.json`, with `<key>` from {@link projectKeyFor}.
*
* Shared by detect and install so the two can never disagree about where an
* entry lives.
*/
function entryPathFor(harness, scope, projectKey, serverName = DEFAULT_SERVER_NAME) {
	const tail = [serverPropertyFor(harness, scope), serverName];
	const nest = scopeDef(harness, scope)?.projectKeyedUnder;
	return nest ? [
		nest,
		projectKey,
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
	const key = projectKeyFor(env);
	const targetEntry = entryPathFor(harness, scope, key).join("\0");
	for (const other of harness.scopes) {
		if (other.scope === scope) continue;
		const otherPath = resolveConfigPath(harness, env, other.scope);
		if (!otherPath) continue;
		if (!pathsResolveSame(target, otherPath, env.platform)) continue;
		if (entryPathFor(harness, other.scope, key).join("\0") === targetEntry) return other.scope;
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
* `which:<bin>`, `~`-prefixed paths, and absolute (app-bundle) paths.
* `expand` turns a `~` path into the one this harness reads — see
* {@link expandConfigPath}. */
function signalMatches(signal, env, expand = (p) => expandTilde(p, env.homedir)) {
	if (signal.startsWith("which:")) return whichSync(signal.slice(6), env);
	return existsSync(signal.startsWith("~") ? expand(signal) : signal);
}
/**
* The value our server key currently holds for this scope, or `undefined`.
*
* Presence alone is not enough for a `cli-command` scope: `claude mcp add`
* refuses when the key exists and never updates its URL, so telling "already
* correct" from "present but pointing somewhere else" needs the value.
*/
function readServerEntry(harness, scope, configPath, projectKey, parseJsonc, serverName = DEFAULT_SERVER_NAME) {
	const text = readTextOrNull(configPath);
	if (!text) return void 0;
	return getAtPath(parseJsonc(text), entryPathFor(harness, scope, projectKey, serverName));
}
/**
* The http(s) URL an entry points at, read in every shape the catalog writes:
* the harness's declared HTTP key (`url`, Antigravity's `serverUrl`), the last
* argv of an `mcp-remote` spawn, or Zed's nested `command.args`. Anything that
* is not an http(s) URL is not one — a script path in `args` must never be
* mistaken for the server the entry points at.
*/
function entryUrl(harness, entry) {
	if (entry === null || typeof entry !== "object") return void 0;
	const e = entry;
	const urlKey = harness.nativeHttpEntry?.urlKey ?? "url";
	const command = e["command"];
	const args = Array.isArray(e["args"]) ? e["args"] : command !== null && typeof command === "object" && Array.isArray(command.args) ? command.args : [];
	return [
		e[urlKey],
		e["url"],
		args[args.length - 1]
	].find((c) => typeof c === "string" && /^https?:\/\//i.test(c));
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
export { DEFAULT_SERVER_NAME, HARNESSES, HARNESS_SCOPES, SAME_FILE_AS_MCP_CONFIG, besideName, buildServerEntry, collidingScope, defaultEnv, defaultScope, detectSignalsFor, entryPathFor, entryUrl, expandConfigPath, expandTilde, getAtPath, getHarness, isValidEntryName, projectKeyFor, readServerEntry, readTextOrNull, renderHarnessCommand, renderTomlBodyLines, renderTomlKey, resolveConfigPath, resolveProjectRoot, scopeDef, signalMatches, supportedScopes, supportsScope, whichPathSync, whichSync, workspaceKeyOf };