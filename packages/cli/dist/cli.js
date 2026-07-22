#!/usr/bin/env node
import { buildApplication, buildCommand, buildRouteMap, proposeCompletions, run, text_en } from "@stricli/core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { buildInstallCommand, buildUninstallCommand } from "@stricli/auto-complete";

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
		os,
		fs,
		path,
		logger: new Logger({
			verbose: false,
			stdout: process$1.stdout,
			stderr: process$1.stderr
		})
	};
}

//#endregion
//#region src/commands/init.ts
const initCommand = buildCommand({
	docs: {
		brief: "First-run setup: authenticate and list your workspaces",
		fullDescription: `Set up the Levr CLI: authenticate (if needed) and list your workspaces.

Reuses an existing session when one is stored — running init again never
re-opens the browser unnecessarily. For headless environments (SSH,
containers), use --device-code.

Examples:
  npx @levr-one/cli init          # First-run onboarding
  levr init --device-code         # Headless/SSH onboarding
  levr init --url <api-url>       # Target a non-default API server`
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
		const { initHandler } = await import("./initHandler-JN92u8td.js");
		return initHandler;
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
		const { loginHandler } = await import("./loginHandler-uZCrwdcR.js");
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
		const { logoutHandler } = await import("./logoutHandler-jWPGhzls.js");
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
		const { statusHandler } = await import("./statusHandler-D6YAxhoN.js");
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
					"cucumber-json"
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
		const { pushHandler } = await import("./pushHandler-DG96IOVd.js");
		return pushHandler;
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
		const { listHandler } = await import("./listHandler-5L3YE52T.js");
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
		const { selectHandler } = await import("./selectHandler-CkIbO2qH.js");
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
		const { currentHandler } = await import("./currentHandler-Dzg819Np.js");
		return currentHandler;
	}
});

//#endregion
//#region package.json
var version = "0.2.0";

//#endregion
//#region src/app.ts
const routes = buildRouteMap({
	routes: {
		init: initCommand,
		auth: buildRouteMap({
			routes: {
				login: loginCommand,
				logout: logoutCommand,
				status: statusCommand
			},
			docs: { brief: "Manage authentication" }
		}),
		workspace: buildRouteMap({
			routes: {
				list: listCommand,
				select: selectCommand,
				current: currentCommand
			},
			docs: { brief: "Manage workspace selection" }
		}),
		push: pushCommand,
		install: buildInstallCommand("levr", { bash: "levr __complete" }),
		uninstall: buildUninstallCommand("levr", { bash: true })
	},
	docs: {
		brief: "The command-line interface for Levr",
		hideRoute: {
			install: true,
			uninstall: true
		}
	}
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
* (see src/bin/cli.ts). `levr install` registers a bash function that invokes
* `levr __complete <COMP_LINE>` on each TAB, so `rawArgs` (process.argv.slice(2))
* is `['__complete', <targetCommandName>, ...wordsBeingCompleted]`. A COMP_LINE
* ending in a space means the cursor is on a fresh (empty) word to complete.
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
//#region src/bin/cli.ts
const argv = process.argv.slice(2);
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