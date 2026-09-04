#!/usr/bin/env node
import { COMPLETION_SHELLS } from "./completionHandler-O2G_WZLf.js";
import { buildApplication, buildCommand, buildRouteMap, proposeCompletions, run, text_en } from "@stricli/core";
import chalk from "chalk";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { parse } from "dotenv";

//#region src/utils/logger.ts
var Logger = class {
	verbose;
	stdout;
	stderr;
	constructor(options) {
		this.verbose = options.verbose ?? false;
		this.stdout = options.stdout ?? process.stdout;
		this.stderr = options.stderr ?? process.stderr;
	}
	info(message) {
		this.stdout.write(`${chalk.blue("info")}  ${message}\n`);
	}
	success(message) {
		this.stdout.write(`${chalk.green("ok")}    ${message}\n`);
	}
	error(message) {
		this.stderr.write(`${chalk.red("error")} ${message}\n`);
	}
	warning(message) {
		this.stdout.write(`${chalk.yellow("warn")}  ${message}\n`);
	}
	debug(message) {
		if (this.verbose) this.stdout.write(`${chalk.gray("debug")} ${message}\n`);
	}
	setVerbose(verbose) {
		this.verbose = verbose;
	}
};

//#endregion
//#region src/context.ts
function buildContext(process$1) {
	return {
		process: process$1,
		logger: new Logger({
			verbose: false,
			stdout: process$1.stdout,
			stderr: process$1.stderr
		})
	};
}

//#endregion
//#region src/commands/completion.ts
const completionCommand = buildCommand({
	docs: {
		brief: "Print the shell completion script for bash or zsh",
		fullDescription: `Prints a shell completion script to stdout. You decide where it goes —
this command never edits your shell config.

Load it for the current session:
  eval "$(levr completion bash)"
  eval "$(levr completion zsh)"

Or persist it:
  levr completion bash >> ~/.bashrc
  levr completion zsh  >> ~/.zshrc
  levr completion bash > /etc/bash_completion.d/levr   # system-wide

The shell is detected from $SHELL when omitted; pass it explicitly in scripts
or when generating a script for a shell other than the one you are running.`
	},
	parameters: {
		positional: {
			kind: "tuple",
			parameters: [{
				parse: String,
				proposeCompletions: (partial) => COMPLETION_SHELLS.filter((shell) => shell.startsWith(partial)),
				brief: `Shell to emit (${COMPLETION_SHELLS.join("|")}); detected from $SHELL if omitted`,
				placeholder: "shell",
				optional: true
			}]
		},
		flags: {}
	},
	loader: async () => {
		const { completionHandler } = await import("./completionHandler-DtG_CsK0.js");
		return completionHandler;
	}
});

//#endregion
//#region src/commands/mcp/add.ts
const SCOPES = [
	"user",
	"project",
	"local"
];
/** Validate `--scope` at parse time so a typo fails before anything is read. */
function parseScope(raw) {
	const value = raw.trim().toLowerCase();
	const match = SCOPES.find((s) => s === value);
	if (!match) throw new Error(`invalid --scope "${raw}" (expected one of: ${SCOPES.join(", ")})`);
	return match;
}
const mcpAddCommand = buildCommand({
	docs: {
		brief: "Add the Levr MCP server to installed AI clients",
		fullDescription: `Detect MCP-capable clients on this machine (Claude Desktop,
Claude Code, Cursor, Windsurf, Zed) and write the Levr MCP server into each
one's config. The entry is credential-free — the client opens a browser to
authorize with Levr the first time it connects.

--scope decides where the entry lands:
  user     every project you open (the default)
  project  this repository, shared with everyone who checks it out
  local    this repository, only you (Claude Code only)

Not every client supports every scope — Claude Desktop and Windsurf are
user-only. A client you name with --client fails if it cannot honor the
scope you asked for; one picked up by --all or interactively falls back to
the scope it does support, and the report says so.

Interactive by default; non-interactive when --all/--client/--yes is passed
or when not running in a terminal (CI). Config edits preserve existing
servers and comments, and re-running is a no-op.

Examples:
  npx @levr-one/cli mcp add            # detect clients and pick interactively
  levr mcp add --all                   # set up every detected client
  levr mcp add --client cursor --yes
  levr mcp add --scope project         # commit the config to this repo
  levr mcp add --dry-run               # preview without writing
  levr mcp add --url <mcp-url>         # target a non-default MCP server`
	},
	parameters: {
		flags: {
			client: {
				kind: "parsed",
				parse: String,
				brief: "Set up these client ids (comma-separated or repeated)",
				placeholder: "id[,id]",
				variadic: true,
				optional: true
			},
			all: {
				kind: "boolean",
				default: false,
				brief: "Set up every detected, installable client"
			},
			yes: {
				kind: "boolean",
				default: false,
				brief: "Non-interactive; auto-select detected clients"
			},
			"dry-run": {
				kind: "boolean",
				default: false,
				brief: "Show changes without writing"
			},
			scope: {
				kind: "parsed",
				parse: parseScope,
				brief: "Where to install: user (default), project, or local",
				placeholder: "user|project|local",
				optional: true
			},
			url: {
				kind: "parsed",
				parse: String,
				brief: "MCP server URL (default derived from the API server)",
				placeholder: "url",
				optional: true
			}
		},
		aliases: { y: "yes" }
	},
	loader: async () => {
		const { mcpAddHandler } = await import("./addHandler-Brr4ndcR.js");
		return mcpAddHandler;
	}
});

//#endregion
//#region src/commands/auth/login.ts
const loginCommand = buildCommand({
	docs: {
		brief: "Authenticate with Levr",
		fullDescription: `Authenticate with Levr using OAuth.

By default, opens a browser for PKCE-based authentication.
For headless environments (SSH, containers), use --device-code
to authenticate via a code displayed in the terminal.

Examples:
  levr auth login                 # Browser-based PKCE login
  levr auth login --device-code   # Device flow for SSH/headless`
	},
	parameters: {
		flags: {
			"device-code": {
				kind: "boolean",
				default: false,
				brief: "Use device code flow (for SSH/headless environments)"
			},
			url: {
				kind: "parsed",
				parse: String,
				brief: "API base URL (default: https://api.levr.one)",
				placeholder: "url",
				optional: true
			}
		},
		aliases: { d: "device-code" }
	},
	loader: async () => {
		const { loginHandler } = await import("./loginHandler-BlVzcygL.js");
		return loginHandler;
	}
});

//#endregion
//#region src/commands/auth/logout.ts
const logoutCommand = buildCommand({
	docs: {
		brief: "Log out of Levr",
		fullDescription: `Remove stored credentials.

Note: If using LEVR_TOKEN environment variable, it will remain set.

Examples:
  levr auth logout`
	},
	parameters: {},
	loader: async () => {
		const { logoutHandler } = await import("./logoutHandler-BFutKash.js");
		return logoutHandler;
	}
});

//#endregion
//#region src/commands/auth/status.ts
const statusCommand = buildCommand({
	docs: {
		brief: "Check authentication status",
		fullDescription: `Check the current authentication status.

Shows whether you are authenticated, the auth method (PAT or JWT),
and tests API reachability.

Examples:
  levr auth status`
	},
	parameters: {},
	loader: async () => {
		const { statusHandler } = await import("./statusHandler-tGF4pMHI.js");
		return statusHandler;
	}
});

//#endregion
//#region src/commands/push.ts
const pushCommand = buildCommand({
	docs: {
		brief: "Push test results to Levr",
		fullDescription: `Upload a test result file to Levr.

The backend auto-detects the file format (JUnit XML, Gherkin, Cucumber JSON).
In CI environments, the automation source name and CI metadata are auto-detected.

Team ID is optional. When omitted, the server resolves the team from:
  1. The existing automation source's team (if --source matches a known source)
  2. The workspace's default team

Examples:
  levr push ./test-results.xml
  levr push ./results.xml --source "backend-unit-tests"
  levr push ./report.json --team-id <uuid>   # explicit team
  levr push ./report.json   # uses LEVR_TOKEN env var, default team`
	},
	parameters: {
		positional: {
			kind: "tuple",
			parameters: [{
				parse: String,
				brief: "Path to test result file (.xml, .feature, .json)",
				placeholder: "file",
				optional: false
			}]
		},
		flags: {
			"workspace-id": {
				kind: "parsed",
				parse: String,
				brief: "Workspace ID (required for multi-workspace JWT auth)",
				placeholder: "uuid",
				optional: true
			},
			"team-id": {
				kind: "parsed",
				parse: String,
				brief: "Team ID (optional; server resolves default if omitted)",
				placeholder: "uuid",
				optional: true
			},
			source: {
				kind: "parsed",
				parse: String,
				brief: "Automation source name (auto-detected in CI)",
				placeholder: "name",
				optional: true
			},
			"automation-source": {
				kind: "parsed",
				parse: String,
				brief: "Automation source UUID. When set, routes to POST /v1/automation-run/ingest (synchronous, bypasses ImportJob queue) instead of POST /v1/imports.",
				placeholder: "uuid",
				optional: true
			},
			"run-name": {
				kind: "parsed",
				parse: String,
				brief: "Name for the test run",
				placeholder: "name",
				optional: true
			},
			format: {
				kind: "enum",
				values: [
					"junit",
					"gherkin",
					"cucumber-json",
					"ctrf-json"
				],
				brief: "File format (auto-detected if omitted)",
				optional: true
			},
			"parent-folder-id": {
				kind: "parsed",
				parse: String,
				brief: "Destination folder ID",
				placeholder: "uuid",
				optional: true
			},
			"update-mode": {
				kind: "enum",
				values: ["update", "create_new"],
				default: "update",
				brief: "How to handle existing tests"
			},
			verbose: {
				kind: "boolean",
				default: false,
				brief: "Show detailed output"
			}
		},
		aliases: {
			w: "workspace-id",
			t: "team-id",
			s: "source",
			a: "automation-source",
			r: "run-name",
			f: "format",
			v: "verbose"
		}
	},
	loader: async () => {
		const { pushHandler } = await import("./pushHandler-B-0ByKRt.js");
		return pushHandler;
	}
});

//#endregion
//#region src/commands/import.ts
const importCommand = buildCommand({
	docs: {
		brief: "Import test cases from CSV, Excel, JSON, or Google Sheets",
		fullDescription: `Two-phase test-case import: preview proposes a column mapping to the
Levr test-case schema (exact/fuzzy matching with an LLM assist), you review
and adjust it, then commit writes folders, tests, steps, and preconditions.

Interactive mode (default in a terminal) walks unmapped and low-confidence
columns with a picker. For scripts/CI use --yes and/or --map.

Required-field rule: a column must map to test_name or the commit is
rejected — interactive mode will ask; non-interactive runs exit 1.

Examples:
  levr import ./testrail-export.csv --team-key ENG
  levr import ./cases.xlsx --team-key ENG --map "Title=test_name"
  levr import --sheets-url "https://docs.google.com/spreadsheets/d/..." --team-key ENG --yes
  levr import ./cases.csv --team-id <uuid> --save-mapping mapping.json
  levr import ./cases.csv --team-id <uuid> --mapping-file mapping.json --yes   # CI replay`
	},
	parameters: {
		positional: {
			kind: "tuple",
			parameters: [{
				parse: String,
				brief: "Path to the source file (.csv, .xlsx, .json)",
				placeholder: "file",
				optional: true
			}]
		},
		flags: {
			"workspace-id": {
				kind: "parsed",
				parse: String,
				brief: "Workspace ID (required for multi-workspace JWT auth)",
				placeholder: "uuid",
				optional: true
			},
			"team-id": {
				kind: "parsed",
				parse: String,
				brief: "Team doing the import, by UUID. Optional: use --team-key instead, or omit both when the workspace has one team",
				placeholder: "uuid",
				optional: true
			},
			"team-key": {
				kind: "parsed",
				parse: String,
				brief: "Team doing the import, by key (e.g. ENG). Case-insensitive. Alternative to --team-id",
				placeholder: "key",
				optional: true
			},
			"sheets-url": {
				kind: "parsed",
				parse: String,
				brief: "Public Google Sheets URL (instead of a file)",
				placeholder: "url",
				optional: true
			},
			format: {
				kind: "enum",
				values: [
					"csv",
					"xlsx",
					"json"
				],
				brief: "Source format (auto-detected from the filename if omitted)",
				optional: true
			},
			map: {
				kind: "parsed",
				parse: String,
				brief: "Column override (repeatable): \"Column=target_field\", \"Column=\" to drop, or \"Column=labels:prefix\"",
				placeholder: "pair",
				variadic: true,
				optional: true
			},
			"mapping-file": {
				kind: "parsed",
				parse: String,
				brief: "JSON file with a saved confirmed mapping (from --save-mapping)",
				placeholder: "path",
				optional: true
			},
			"save-mapping": {
				kind: "parsed",
				parse: String,
				brief: "Write the confirmed mapping to this JSON file for CI replay",
				placeholder: "path",
				optional: true
			},
			yes: {
				kind: "boolean",
				default: false,
				brief: "Accept the mapping without prompts (required for non-TTY runs)"
			},
			verbose: {
				kind: "boolean",
				default: false,
				brief: "Show detailed output"
			}
		},
		aliases: {
			w: "workspace-id",
			t: "team-id",
			k: "team-key",
			f: "format",
			m: "map",
			y: "yes",
			v: "verbose"
		}
	},
	loader: async () => {
		const { importHandler } = await import("./importHandler-0J_ITnPt.js");
		return importHandler;
	}
});

//#endregion
//#region src/commands/workspace/list.ts
const listCommand = buildCommand({
	docs: {
		brief: "List available workspaces",
		fullDescription: `List all workspaces you have access to.

The current workspace (if selected) is marked with an asterisk (*).

Requires JWT authentication (levr auth login).

Examples:
  levr workspace list`
	},
	parameters: {},
	loader: async () => {
		const { listHandler } = await import("./listHandler-D2zTOxvd.js");
		return listHandler;
	}
});

//#endregion
//#region src/commands/workspace/select.ts
const selectCommand = buildCommand({
	docs: {
		brief: "Select a workspace",
		fullDescription: `Select a workspace by ID.

The selected workspace is used for all subsequent commands.
Use 'levr workspace list' to see available workspaces.

Requires JWT authentication (levr auth login).

Examples:
  levr workspace select <workspace-id>`
	},
	parameters: {
		positional: {
			kind: "tuple",
			parameters: [{
				parse: String,
				brief: "Workspace ID",
				placeholder: "workspace-id",
				optional: false
			}]
		},
		flags: {}
	},
	loader: async () => {
		const { selectHandler } = await import("./selectHandler-QFbn-SLF.js");
		return selectHandler;
	}
});

//#endregion
//#region src/commands/workspace/current.ts
const currentCommand = buildCommand({
	docs: {
		brief: "Show current workspace",
		fullDescription: `Show the currently selected workspace.

Examples:
  levr workspace current`
	},
	parameters: {},
	loader: async () => {
		const { currentHandler } = await import("./currentHandler-CHydiFui.js");
		return currentHandler;
	}
});

//#endregion
//#region package.json
var version = "0.8.1";

//#endregion
//#region src/app.ts
const authRoutes = buildRouteMap({
	routes: {
		login: loginCommand,
		logout: logoutCommand,
		status: statusCommand
	},
	docs: { brief: "Manage authentication" }
});
const workspaceRoutes = buildRouteMap({
	routes: {
		list: listCommand,
		select: selectCommand,
		current: currentCommand
	},
	docs: { brief: "Manage workspace selection" }
});
const routes = buildRouteMap({
	routes: {
		mcp: buildRouteMap({
			routes: { add: mcpAddCommand },
			docs: { brief: "Wire the Levr MCP server into installed AI clients" }
		}),
		auth: authRoutes,
		workspace: workspaceRoutes,
		push: pushCommand,
		import: importCommand,
		completion: completionCommand
	},
	docs: { brief: "The command-line interface for Levr" }
});
const app = buildApplication(routes, {
	name: "levr",
	versionInfo: { currentVersion: version },
	localization: { loadText: () => ({
		...text_en,
		exceptionWhileParsingArguments: (exc, ansiColor) => {
			const base = text_en.exceptionWhileParsingArguments(exc, ansiColor);
			const hint = "Run `levr <command> --help` for usage information.";
			return ansiColor ? `${base}\n\x1b[2m${hint}\x1b[22m` : `${base}\n${hint}`;
		}
	}) }
});

//#endregion
//#region src/completion.ts
/**
* Compute shell tab-completion suggestions for the hidden `__complete` entrypoint
* (see src/bin/cli.ts). The scripts emitted by `levr completion bash|zsh`
* register a shell function that invokes `levr __complete <words…>` on each TAB,
* so `rawArgs` (process.argv.slice(2)) is
* `['__complete', <targetCommandName>, ...wordsBeingCompleted]` — note the
* command name is passed through and dropped here, which is why the shell
* scripts pass their FULL word array. A COMP_LINE ending in a space means the
* cursor is on a fresh (empty) word to complete.
*
* Never throws — completion must not surface an error to the user's shell.
*/
async function proposeCompletionLines(rawArgs, compLine, context) {
	const inputs = rawArgs.slice(2);
	if (compLine?.endsWith(" ")) inputs.push("");
	try {
		return (await proposeCompletions(app, inputs, context)).map(({ completion }) => completion);
	} catch {
		return [];
	}
}

//#endregion
//#region src/utils/load-env-file.ts
/**
* Only `LEVR_`-prefixed keys are taken from a `.env` file.
*
* `dotenv.config()` would merge EVERY key into `process.env`, which is more
* than this CLI needs and more than a user consents to by running it in a
* directory. A checkout's `.env` routinely carries things that change how Node
* itself behaves — `NODE_TLS_REJECT_UNAUTHORIZED`, `HTTP_PROXY`,
* `NODE_OPTIONS` — and none of them are ours to apply. Parsing and filtering
* means an unrelated project's `.env` cannot reach this process at all; only
* keys deliberately namespaced for this CLI have any effect.
*/
const LEVR_KEY = /^LEVR_[A-Z0-9_]*$/;
/**
* Where to look. `LEVR_ENV_FILE` names an explicit file (absolute, or relative
* to cwd); otherwise `.env` in the working directory.
*/
function envFilePath(cwd, env) {
	const explicit = env["LEVR_ENV_FILE"];
	if (explicit) return isAbsolute(explicit) ? explicit : resolve(cwd, explicit);
	return resolve(cwd, ".env");
}
/**
* Merge `LEVR_*` variables from a `.env` file into `process.env`.
*
* A real environment variable ALWAYS wins: an already-set key is left alone,
* so `LEVR_URL=… levr push` still overrides the file, and CI variables are
* never shadowed by a checked-in `.env`. This matches dotenv's own precedence
* and is the behaviour anyone who has used a `.env` expects — the file is a
* default, not an override.
*
* Missing or unreadable files are not an error: `.env` is optional by nature,
* and a CLI that refused to start because a directory has no `.env` would be
* broken for every user who does not use one. An explicitly requested
* `LEVR_ENV_FILE` that does not exist IS reported, because naming a file and
* getting silence is the one case where quiet failure hides a real mistake.
*/
function loadEnvFile(cwd = process.cwd(), env = process.env) {
	const path = envFilePath(cwd, env);
	const explicitlyRequested = Boolean(env["LEVR_ENV_FILE"]);
	if (!existsSync(path)) {
		if (explicitlyRequested) throw new Error(`LEVR_ENV_FILE points at "${path}", which does not exist.`);
		return {
			path: null,
			applied: []
		};
	}
	let parsed;
	try {
		parsed = parse(readFileSync(path, "utf8"));
	} catch (error) {
		if (explicitlyRequested) throw error;
		return {
			path: null,
			applied: []
		};
	}
	const applied = [];
	for (const [key, value] of Object.entries(parsed)) {
		if (!LEVR_KEY.test(key)) continue;
		if (env[key] !== void 0 && env[key] !== "") continue;
		env[key] = value;
		applied.push(key);
	}
	return {
		path,
		applied
	};
}

//#endregion
//#region src/bin/cli.ts
const argv = process.argv.slice(2);
try {
	loadEnvFile();
} catch (err) {
	if (argv[0] !== "__complete") {
		process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
		process.exit(1);
	}
}
if (argv[0] === "__complete") for (const line of await proposeCompletionLines(argv, process.env["COMP_LINE"], buildContext(process))) process.stdout.write(`${line}\n`);
else {
	let savedExitCode;
	await run(app, argv, buildContext(new Proxy(process, { set(target, prop, value) {
		if (prop === "exitCode" && typeof value === "number" && value !== 0) savedExitCode = value;
		return Reflect.set(target, prop, value);
	} })));
	if (savedExitCode !== void 0) process.exitCode = savedExitCode;
}

//#endregion
export {  };