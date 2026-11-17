import { configureClient } from "./sdk-client-COhVazCc.js";
import "./token-refresh-ChElPPiG.js";
import { getApiUrl } from "./env-D31eVXPZ.js";
import { resolveToken } from "./resolve-token-QPDOFGfO.js";
import "./workspace-store-DYXnmPDY.js";
import { fetchSites } from "./resolve-workspace-Q8FOM4UC.js";
import { DEFAULT_SERVER_NAME, HARNESSES, HARNESS_SCOPES, SAME_FILE_AS_MCP_CONFIG, besideName, buildServerEntry, collidingScope, defaultEnv, defaultScope, entryPathFor, entryUrl, expandConfigPath, expandTilde, getAtPath, getHarness, isValidEntryName, projectKeyFor, readServerEntry, readTextOrNull, renderHarnessCommand, resolveConfigPath, resolveProjectRoot, scopeDef, supportedScopes, supportsScope, whichPathSync, workspaceKeyOf } from "./paths-BWrY8EUd.js";
import { UnsupportedConfigShapeError, adapterFor, detectSync, jsoncAdapter, tomlAdapter } from "./detect-oNmsIBkr.js";
import { isScopedMcpUrl, resolveMcpUrl, scopedMcpUrl, servedBySessionApi } from "./url-DXZc5M5i.js";
import { describeWorkspaces, findWorkspaceByKeyOrName } from "./find-workspace-7e3j-yPV.js";
import { chmodSync, copyFileSync, existsSync, mkdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

//#region ../mcp-harnesses/dist/levr-tool-allowlist.js
/**
* The Levr MCP tools `levr mcp add` may offer to pre-approve in a harness's
* own permission file (ENG-6392, plan ENG-6341 §D9).
*
* SINGLE SOURCE. Every harness auto-approve descriptor in `catalog.ts`
* renders its entries from this list, and the backender parity spec
* (`apps/backender/src/mcp/levr-tool-allowlist.parity.spec.ts`) asserts that
* every name here is a public tool and none is in
* `McpToolAdapterService.DESTRUCTIVE_TOOL_NAMES`.
*
* Rules for this list:
* - Only the non-destructive tools a first task or an ordinary gated issue
*   actually calls (`batch_verify_gates`: agents used it in the real-agent
*   trial, user decision 2026-11-04). A tool that
*   can delete, merge away or permanently unlink anything never belongs here.
* - Nor does a tool whose PURPOSE is to waive a check (waive_gate): see
*   {@link LEVR_NEVER_PREAPPROVED_TOOLS}.
* - `deploy_gates` and `transition_issue` ARE listed (user decision
*   2026-10-15: neither is destructive, and the first task must run without
*   permission prompts). deploy_gates can also change or withdraw a gate,
*   and transition_issue can waive a required gate through
*   `verification_override`. The installer's disclosure says so rather than
*   promising otherwise, and every such change is recorded on the gate (code
*   review F-027). The disclosure must stay literally true for every entry.
* - One entry per tool, by its exact registered name. Never a server-wide
*   entry and never a glob: a server-wide grant would also pre-approve the
*   destructive tools the server exposes.
*
* Isomorphic and import-free, like the catalog, so the client SPA and the
* backender can both read it.
*/
/** The tools offered for pre-approval, in the order a first task uses them. */
const LEVR_PREAPPROVED_TOOLS = [
	"get_context",
	"start_onboarding",
	"get_onboarding_step",
	"get_issue",
	"get_issues",
	"search_issues",
	"get_issue_comments",
	"add_issue_comment",
	"deploy_gates",
	"verify_gates",
	"batch_verify_gates",
	"report_gate_results",
	"get_gate_status",
	"transition_issue",
	"get_practice_app",
	"my_work"
];
/**
* A plain description of what each tool does, printed next to its entry in
* the installer's disclosure (plan R1-23) so the user can judge each line
* rather than a list of opaque identifiers.
*/
const LEVR_PREAPPROVED_TOOL_DESCRIPTIONS = {
	get_context: "reads your workspace, teams and projects",
	start_onboarding: "starts a guided first task",
	get_onboarding_step: "reads the current step of the guided first task",
	get_issue: "reads one task",
	get_issues: "lists tasks",
	search_issues: "searches tasks",
	get_issue_comments: "reads a task's comments",
	add_issue_comment: "adds a comment to a task",
	deploy_gates: "writes the task's gates; it can also change or withdraw a gate (recorded)",
	transition_issue: "moves a task to another status; Done is refused while a required check fails, unless your agent waives that check (the waiver is recorded)",
	verify_gates: "runs the task's checklist",
	batch_verify_gates: "runs the checklists of several tasks in one call",
	report_gate_results: "records the checklist results your agent ran",
	get_gate_status: "reads the task's checklist results",
	get_practice_app: "reads the sample practice app",
	my_work: "reads your tasks, ranked, with what to pick up next"
};

//#endregion
//#region ../mcp-harnesses/dist/node/exec.js
/** Upper bound on a client CLI invocation. `claude mcp add` is a local config
* edit — anything approaching this is hung, not slow. */
const COMMAND_TIMEOUT_MS = 3e4;
/** Keep a failing client's diagnostics readable in a multi-client report. */
const MAX_STDERR = 2e3;
/**
* The variables a client CLI is spawned with: the real environment minus every
* catalog `configDirEnv`, then `env.vars` on top (ENG-6696). A config
* directory therefore reaches the child only when the caller's env carries it
* — the one the probe read — so `claude` never writes a file the installer
* did not look at, while PATH and the rest still come through.
*/
function childVars(env) {
	const vars = { ...process.env };
	for (const h of HARNESSES) if (h.configDirEnv) delete vars[h.configDirEnv];
	return {
		...vars,
		...env.vars
	};
}
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
* Everything decided before a command is spawned, shared by both runners: an
* outcome when it must not run, else how to run it.
*
* Resolution uses {@link whichPathSync} — a pure `PATH` scan that spawns
* nothing, so the "is this installed" check can never itself be the thing
* that hangs. It returns the resolved path rather than a boolean because the
* extension decides how the command must be launched.
*/
function prepare(argv, opts) {
	const env = opts.env ?? defaultEnv();
	const dryRun = opts.dryRun ?? false;
	const [bin, ...args] = argv;
	if (!bin) return { skip: {
		executed: false,
		ok: false,
		reason: "empty-command"
	} };
	if (dryRun) return { skip: {
		executed: false,
		ok: true,
		reason: "dry-run"
	} };
	const binPath = whichPathSync(bin, env);
	if (!binPath) return { skip: {
		executed: false,
		ok: true,
		reason: "binary-not-found"
	} };
	const useShell = needsShell(binPath);
	if (useShell && (binPath.includes("\"") || args.some((a) => SHELL_METACHARACTERS.test(a)))) return { skip: {
		executed: false,
		ok: false,
		reason: "unsafe-argument"
	} };
	return { spawn: {
		binPath: useShell ? `"${binPath}"` : binPath,
		args,
		options: {
			timeout: COMMAND_TIMEOUT_MS,
			env: {
				...childVars(env),
				HOME: env.homedir,
				USERPROFILE: env.homedir
			},
			cwd: env.cwd,
			...useShell ? { shell: true } : {}
		}
	} };
}
/** A command that ran and failed (or could not start), as an outcome. */
function failureOutcome(err) {
	const e = err;
	const exitCode = typeof e.status === "number" ? e.status : typeof e.code === "number" ? e.code : void 0;
	const raw = typeof e.stderr === "string" ? e.stderr : e.stderr?.toString("utf8") ?? "";
	return {
		executed: true,
		ok: false,
		...exitCode === void 0 ? {} : { exitCode },
		stderr: (raw.trim() || e.message || "command failed").slice(0, MAX_STDERR)
	};
}
/** Run a harness CLI invocation, or explain why it was not run. */
function runHarnessCommandSync(argv, opts = {}) {
	const prepared = prepare(argv, opts);
	if ("skip" in prepared) return prepared.skip;
	const { binPath, args, options } = prepared.spawn;
	try {
		execFileSync(binPath, args, {
			...options,
			encoding: "utf8",
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			]
		});
		return {
			executed: true,
			ok: true
		};
	} catch (err) {
		return failureOutcome(err);
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
	const path$1 = resolveConfigPath(harness, env, scope);
	if (!path$1) return { reason: "no-location" };
	return { path: path$1 };
}
/**
* What the client currently holds for this scope, read from its own config.
*
* `url` is present for a `native-http` entry (`{ type: 'http', url }`); for an
* `mcp-remote` entry the URL is the last argv element. Absent `url` with
* `present: true` means an entry we cannot interpret — treated as a mismatch
* rather than assumed correct.
*/
function currentEntry(harness, env, scope, serverName) {
	const configPath = resolveConfigPath(harness, env, scope);
	if (!configPath) return { present: false };
	const adapter = adapterFor(harness);
	const entry = readServerEntry(harness, scope, configPath, projectKeyFor(env), (t) => {
		const read = adapter.readAt(t, []);
		return read.kind === "value" ? read.value : void 0;
	}, serverName);
	if (entry === void 0 || entry === null) return { present: false };
	const url = entryUrl(harness, entry);
	return url === void 0 ? { present: true } : {
		present: true,
		url
	};
}
/** `claude mcp remove` argv — the inverse of the catalog's add command. */
function removeCommandArgv(scope, serverName) {
	return [
		"claude",
		"mcp",
		"remove",
		"--scope",
		scope,
		serverName
	];
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
function drive(steps, run) {
	let step = steps.next();
	while (!step.done) step = steps.next(run(step.value.argv, step.value.opts));
	return step.value;
}
/** Merge (or preview) our MCP into a harness config. */
function installHarnessSync(harness, mcpUrl, opts = {}) {
	return drive(installSteps(harness, mcpUrl, opts), opts.runCommand ?? runHarnessCommandSync);
}
function* installSteps(harness, mcpUrl, opts) {
	const env = opts.env ?? defaultEnv();
	const dryRun = opts.dryRun ?? false;
	const scope = opts.scope ?? defaultScope(harness);
	const serverName = opts.serverName ?? DEFAULT_SERVER_NAME;
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
		const argv = renderHarnessCommand(harness, mcpUrl, scope, serverName);
		const base = {
			wrote: false,
			path: "",
			command: argv.join(" "),
			dryRun,
			scope
		};
		const existing$1 = currentEntry(harness, env, scope, serverName);
		if (existing$1.present) {
			if (existing$1.url === mcpUrl) return {
				...base,
				ok: true,
				executed: false,
				alreadyConfigured: true
			};
			if (!existing$1.url) return {
				...base,
				ok: false,
				executed: false,
				alreadyConfigured: false,
				reason: "unrecognized-entry"
			};
			if (opts.replaceExisting) return yield* replaceSteps(harness, argv, existing$1.url, {
				env,
				dryRun,
				scope,
				serverName,
				execute: opts.execute ?? true
			});
			return {
				...base,
				ok: false,
				executed: false,
				alreadyConfigured: false,
				reason: "url-mismatch",
				...existing$1.url ? { currentUrl: existing$1.url } : {}
			};
		}
		const outcome = opts.execute ?? true ? yield {
			argv,
			opts: {
				env,
				dryRun
			}
		} : {
			executed: false,
			ok: true,
			reason: "not-requested"
		};
		return {
			...base,
			ok: outcome.ok,
			executed: outcome.executed,
			...outcome.ok ? {} : { commandError: notRunError(outcome) },
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
	const { path: path$1 } = target;
	const entryValue = buildServerEntry(harness, mcpUrl, scope, serverName)[serverName];
	const modPath = entryPathFor(harness, scope, projectKeyFor(env), serverName);
	const adapter = adapterFor(harness);
	const existing = readTextOrNull(path$1);
	const baseText = existing && existing.trim() ? existing : adapter.empty;
	const current = adapter.readAt(baseText, modPath);
	if (current.kind === "unsupported") return unsupportedShape(path$1, dryRun, scope, current.detail);
	const alreadyConfigured = current.kind === "value" && sameValue(current.value, entryValue);
	const held = current.kind === "value" && !alreadyConfigured;
	const heldUrl = held ? entryUrl(harness, current.value) : void 0;
	if (held && heldUrl !== mcpUrl && opts.replaceExisting === false) return {
		ok: false,
		wrote: false,
		path: path$1,
		alreadyConfigured: false,
		dryRun,
		scope,
		reason: heldUrl === void 0 ? "unrecognized-entry" : "url-mismatch",
		...heldUrl === void 0 ? {} : { currentUrl: heldUrl }
	};
	const replaced = heldUrl !== void 0 && heldUrl !== mcpUrl ? { replacedUrl: heldUrl } : {};
	let nextText;
	try {
		nextText = adapter.setAt(baseText, modPath, entryValue);
	} catch (err) {
		if (err instanceof UnsupportedConfigShapeError) return unsupportedShape(path$1, dryRun, scope, err.detail);
		throw err;
	}
	const shared = {};
	if (def.projectPath) {
		const root = resolveProjectRoot(env);
		const ignored = root.isRepo ? isGitIgnored(env, root.root, path$1) : void 0;
		if (ignored !== void 0) shared.gitIgnored = ignored;
	}
	if (alreadyConfigured) return {
		ok: true,
		wrote: false,
		path: path$1,
		alreadyConfigured: true,
		dryRun,
		scope,
		preview: nextText,
		...shared
	};
	const backupPath = backupPathFor(path$1, adapter.backupSuffix);
	if (dryRun) return {
		ok: true,
		wrote: false,
		path: path$1,
		alreadyConfigured: false,
		dryRun: true,
		scope,
		preview: nextText,
		...replaced,
		...backupPath ? { backupPath } : {},
		...shared
	};
	const finalText = nextText.endsWith("\n") ? nextText : `${nextText}\n`;
	try {
		mkdirSync(dirname(path$1), { recursive: true });
		if (backupPath) backupOnce(path$1, backupPath);
		writeConfigAtomic(path$1, finalText);
	} catch (err) {
		return writeFailed(path$1, scope, err);
	}
	return {
		ok: true,
		wrote: true,
		path: path$1,
		alreadyConfigured: false,
		dryRun: false,
		scope,
		preview: finalText,
		...replaced,
		...backupPath ? { backupPath } : {},
		...shared
	};
}
/**
* Repoint a `cli-command` client: remove the entry, add the new one, and put
* the previous one back if the add fails (ENG-6300 D6, R1 K-002). The client's
* CLI will not overwrite an entry, so a replace is two commands — and a failed
* second command must not leave the user with no entry at all without saying
* so.
*/
/**
* What went wrong with a failed command: its stderr, else why it was never
* run — so a refusal never reads as "unknown reason" (ENG-6737).
*/
function notRunError(outcome) {
	return outcome.stderr ?? (outcome.reason ? `not run: ${outcome.reason}` : void 0);
}
function* replaceSteps(harness, addArgv, previousUrl, ctx) {
	const removeArgv = removeCommandArgv(ctx.scope, ctx.serverName);
	const base = {
		wrote: false,
		path: "",
		command: `${removeArgv.join(" ")} && ${addArgv.join(" ")}`,
		dryRun: ctx.dryRun,
		scope: ctx.scope,
		alreadyConfigured: false,
		replacedUrl: previousUrl
	};
	if (ctx.dryRun || !ctx.execute) return {
		...base,
		ok: true,
		executed: false
	};
	const removed = yield {
		argv: removeArgv,
		opts: { env: ctx.env }
	};
	if (!removed.executed) return {
		...base,
		ok: removed.ok,
		executed: false,
		...removed.ok ? {} : { commandError: notRunError(removed) }
	};
	if (!removed.ok) return {
		...base,
		ok: false,
		executed: true,
		commandError: `could not remove the existing entry: ${removed.stderr ?? "unknown error"}`
	};
	const added = yield {
		argv: addArgv,
		opts: { env: ctx.env }
	};
	if (added.ok) return {
		...base,
		ok: true,
		executed: true
	};
	const restore = yield {
		argv: renderHarnessCommand(harness, previousUrl, ctx.scope, ctx.serverName),
		opts: { env: ctx.env }
	};
	return {
		...base,
		ok: false,
		executed: true,
		commandError: notRunError(added) ?? "unknown error",
		restored: restore.ok && restore.executed,
		...restore.ok && restore.executed ? {} : { restoreError: notRunError(restore) ?? "the restore command did not run" }
	};
}
/**
* Where the one-shot backup of an existing `path` lives, for an adapter that
* asks for one — `undefined` when the format does not, or when there is no
* original to protect yet.
*/
function backupPathFor(path$1, suffix) {
	if (!suffix || !existsSync(path$1)) return void 0;
	return `${path$1}${suffix}`;
}
/** Copy the original once. An existing backup is never overwritten. */
function backupOnce(path$1, backupPath) {
	if (existsSync(backupPath)) return;
	copyFileSync(path$1, backupPath);
}
/** The refusal every format shares: the file is there, and we will not touch it. */
function unsupportedShape(path$1, dryRun, scope, detail) {
	return {
		ok: false,
		wrote: false,
		path: path$1,
		alreadyConfigured: false,
		dryRun,
		scope,
		reason: "unsupported-config-shape",
		detail
	};
}
/** The filesystem said no: report it per client instead of aborting the run. */
function writeFailed(path$1, scope, err) {
	return {
		ok: false,
		wrote: false,
		path: path$1,
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
function writeConfigAtomic(path$1, text) {
	let target = path$1;
	let mode;
	try {
		target = realpathSync(path$1);
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
/** Resolve the descriptor's permission file for a scope, or why it cannot be. */
function resolvePermissionFile(harness, desc, scope, env) {
	const file = desc.file[scope];
	if (!file || !scopeDef(harness, scope)) return { reason: "unsupported-scope" };
	if (file === SAME_FILE_AS_MCP_CONFIG) {
		const target = resolveTarget(harness, env, scope);
		if ("reason" in target) return { reason: target.reason === "not-a-repo" || target.reason === "no-location" ? target.reason : "unsupported-scope" };
		return target;
	}
	if (file.startsWith("~")) {
		if (harness.configDirEnv && desc.configDirReplaces) return { path: expandConfigPath(file, {
			...harness,
			configDirReplaces: desc.configDirReplaces
		}, env) };
		return { path: expandTilde(file, env.homedir) };
	}
	const root = resolveProjectRoot(env);
	if (!root.isRepo) return { reason: "not-a-repo" };
	return {
		path: join(root.root, ...file.split("/")),
		repoRoot: root.root
	};
}
/**
* Whether git ignores `file` inside the work tree at `repoRoot`: `true` /
* `false` from `git check-ignore`, `undefined` when git cannot say (not
* installed, not a work tree). Never throws. Git runs in the injected machine
* environment — `HOME` is `env.homedir`, so the user's global excludes file
* counts and a test's temp home isolates it — and the `GIT_*` per-process
* variables are dropped so a parent git (a hook) cannot redirect the check to
* another repository.
*/
function isGitIgnored(env, repoRoot, file) {
	const childEnv = {
		...env.vars ?? {},
		HOME: env.homedir,
		PATH: env.pathVar || process.env.PATH
	};
	for (const key of [
		"GIT_DIR",
		"GIT_WORK_TREE",
		"GIT_INDEX_FILE",
		"GIT_COMMON_DIR"
	]) delete childEnv[key];
	try {
		const r = spawnSync("git", [
			"check-ignore",
			"-q",
			"--",
			file
		], {
			cwd: repoRoot,
			env: childEnv,
			stdio: "ignore",
			timeout: 5e3
		});
		if (r.status === 0) return true;
		if (r.status === 1) return false;
		return;
	} catch {
		return;
	}
}
function permissionAdapter(desc) {
	return desc.format === "toml" ? tomlAdapter : jsoncAdapter;
}
/**
* Pre-approve the non-destructive Levr tools in a harness's own permission
* file, so its agent can call them without asking each time.
*
* MERGE-ONLY and NON-DESTRUCTIVE: entries are appended to what the file
* already holds; an existing entry is reported in `alreadyPresent` and never
* duplicated; a `tool-map` key the user already set to something else is
* reported in `conflicting` and left alone. Comments survive (the edit is an
* in-place text patch, never a re-serialize), and the write is atomic
* ({@link writeConfigAtomic}: a sibling temp file, then rename), so an
* interrupted write leaves the original file intact.
*
* Error direction: fail_closed. An existing file that cannot be read or
* parsed, or that holds the key in a shape we will not restructure (e.g.
* `permissions.allow` is a string), aborts with
* `unsupported-config-shape` and writes NOTHING — never a clobber. Every
* failure is returned, not thrown, so the caller can report "permissions not
* added" and carry on (the MCP install itself already succeeded).
*/
function preapproveTools(harness, scope, serverName = DEFAULT_SERVER_NAME, opts = {}) {
	const env = opts.env ?? defaultEnv();
	const dryRun = opts.dryRun ?? false;
	const desc = harness.autoApprove;
	const base = {
		ok: false,
		file: "",
		scope,
		fileExists: false,
		added: [],
		alreadyPresent: [],
		conflicting: [],
		addedEntries: [],
		wrote: false,
		dryRun,
		keyPath: desc ? desc.keyPath.join(".") : "",
		...desc?.toolValue ? { toolValue: desc.toolValue } : {},
		...desc?.caveat ? { caveat: desc.caveat } : {}
	};
	if (!desc) return {
		...base,
		reason: "no-descriptor"
	};
	const resolved = resolvePermissionFile(harness, desc, scope, env);
	if ("reason" in resolved) return {
		...base,
		reason: resolved.reason
	};
	const file = resolved.path;
	base.fileExists = existsSync(file);
	if (resolved.repoRoot !== void 0) {
		const ignored = isGitIgnored(env, resolved.repoRoot, file);
		if (ignored !== void 0) base.gitIgnored = ignored;
	}
	const fail = (reason, detail) => ({
		...base,
		file,
		reason,
		...detail ? { detail } : {}
	});
	const adapter = permissionAdapter(desc);
	if (desc.shape === "allow-list" && !adapter.appendToArray) return fail("unsupported-format", `${desc.format} permission files cannot be appended to in place`);
	const existing = readTextOrNull(file);
	if (existing === null && existsSync(file)) return fail("unsupported-config-shape", "file exists but cannot be read");
	const baseText = existing && existing.trim() ? existing : adapter.empty;
	const whole = adapter.readAt(baseText, []);
	if (whole.kind === "unsupported") return fail("unsupported-config-shape", whole.detail);
	const root = whole.kind === "value" ? whole.value : {};
	const keyPath = [...desc.keyPath];
	const currentAtKey = getAtPath(root, keyPath);
	const wanted = (opts.tools ?? LEVR_PREAPPROVED_TOOLS).map((tool) => ({
		tool,
		entry: desc.entry(serverName, tool)
	}));
	const seen = /* @__PURE__ */ new Set();
	const unique = wanted.filter((w) => seen.has(w.entry) ? false : (seen.add(w.entry), true));
	const addedEntries = [];
	const alreadyPresent = [];
	const conflicting = [];
	let nextText = baseText;
	try {
		if (desc.shape === "allow-list") {
			if (currentAtKey !== void 0 && !Array.isArray(currentAtKey)) return fail("unsupported-config-shape", `${base.keyPath} exists but is not a list — refusing to restructure it`);
			if (currentAtKey === void 0 && desc.appendOnlyToExistingKey) return fail("allowlist-key-absent", `${harness.label} uses the allowlist in its own Settings while ${base.keyPath} is absent from ${file}, and creating it would replace that allowlist. To pre-approve, add these in ${harness.label} Settings (or to an existing ${base.keyPath} in that file): ${unique.map((w) => w.entry).join(", ")}`);
			const have = new Set((currentAtKey ?? []).filter((v) => typeof v === "string"));
			for (const w of unique) if (have.has(w.entry)) alreadyPresent.push(w.entry);
			else addedEntries.push(w);
			const values = addedEntries.map((w) => w.entry);
			if (values.length > 0) nextText = currentAtKey === void 0 ? adapter.setAt(baseText, keyPath, values) : adapter.appendToArray(baseText, keyPath, values);
		} else {
			if (currentAtKey !== void 0 && (currentAtKey === null || typeof currentAtKey !== "object" || Array.isArray(currentAtKey))) return fail("unsupported-config-shape", `${base.keyPath} exists but is not an object — refusing to restructure it`);
			const map = currentAtKey ?? {};
			const value = desc.toolValue ?? {};
			for (const w of unique) {
				const cur = map[w.entry];
				if (cur === void 0) {
					addedEntries.push(w);
					continue;
				}
				const curObj = cur !== null && typeof cur === "object" && !Array.isArray(cur) ? cur : void 0;
				if (curObj !== void 0 && Object.entries(value).every(([k, v]) => curObj[k] === v)) alreadyPresent.push(w.entry);
				else conflicting.push(w.entry);
			}
			for (const w of addedEntries) nextText = adapter.setAt(nextText, [...keyPath, w.entry], { ...value });
		}
	} catch (err) {
		if (err instanceof UnsupportedConfigShapeError) return fail("unsupported-config-shape", err.detail);
		throw err;
	}
	const added = addedEntries.map((w) => w.entry);
	const result = {
		...base,
		ok: true,
		file,
		added,
		addedEntries,
		alreadyPresent,
		conflicting
	};
	if (dryRun || added.length === 0) return result;
	const finalText = nextText.endsWith("\n") ? nextText : `${nextText}\n`;
	try {
		mkdirSync(dirname(file), { recursive: true });
		writeConfigAtomic(file, finalText);
	} catch (err) {
		return {
			...fail("write-failed", err instanceof Error ? err.message : String(err)),
			added: [],
			addedEntries: []
		};
	}
	return {
		...result,
		wrote: true
	};
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
function entryState(s, url) {
	if (s?.alreadyConfigured && s.currentUrl === url) return "same-url";
	if (s?.besideUrl === url) return "beside";
	if (!s?.alreadyConfigured) return "absent";
	return s.currentUrl === void 0 ? "unrecognized" : "other-url";
}
/**
* The scope an install would land in: the requested one, or, for a harness
* that cannot do it, its own default, which is where the fallback goes.
*/
function landingScope(d, scope) {
	const inScope = scope ? d.scopes.find((s) => s.scope === scope) : void 0;
	if (inScope) return inScope;
	const harness = getHarness(d.id);
	return harness ? d.scopes.find((s) => s.scope === defaultScope(harness)) : void 0;
}
/** Where an entry points, in the user's terms: the workspace, else the URL. */
function describeTarget(url) {
	const key = workspaceKeyOf(url);
	return key ? `workspace ${key}` : url;
}
/**
* Harness ids to pre-select in interactive mode, and to take under `--yes`:
* detected + installable + not already set up for THIS url. Judged in the
* scope we are about to install into, not the harness's default one.
*
* An entry pointing at another URL is selected (ENG-6736): it is not set up
* for the workspace asked for, and skipping it would report success while
* leaving the client on the old one. Interactively the user is then asked
* what to do with it; under `--yes` the installer refuses it (url-mismatch,
* exit 1) unless `--replace` or `--name` was given. An entry with no URL we
* can read is someone else's, and is never picked on the user's behalf.
*/
function autoSelectIds(detected, scope, url) {
	return detected.filter((d) => {
		if (!d.available || !d.installed) return false;
		const state = entryState(landingScope(d, scope), url);
		return state === "absent" || state === "other-url";
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
function clientChoices(detected, scope, url, serverName = DEFAULT_SERVER_NAME) {
	const preselect = new Set(autoSelectIds(detected, scope, url));
	const beside = besideName(serverName, url);
	return detected.filter((d) => d.available).map((d) => {
		const inScope = d.scopes.find((s) => s.scope === scope);
		const harness = getHarness(d.id);
		let hint;
		if (!inScope) hint = `no ${scope} scope — will use ${harness ? defaultScope(harness) : DEFAULT_SCOPE}`;
		else if (entryState(inScope, url) === "same-url") hint = `already set up (${scope})`;
		else if (entryState(inScope, url) === "beside") hint = `already set up as ${beside ?? "a second entry"} (${scope})`;
		else if (inScope.currentUrl !== void 0) hint = `points at ${describeTarget(inScope.currentUrl)} (${scope})`;
		else if (inScope.alreadyConfigured) hint = `its ${serverName} entry holds no Levr URL (${scope})`;
		else hint = d.installed ? "detected" : "not detected";
		return {
			value: d.id,
			label: d.label,
			hint,
			selected: preselect.has(d.id)
		};
	});
}
/**
* The selected clients whose entry is not this URL's: each needs a decision —
* switch it, add beside it, or leave it — before anything is installed
* (ENG-6736). A client already set up beside it is listed too, as `beside`,
* so it is installed under that name (and reads as already set up) rather
* than refused under the main one. Pure, so it is testable without a TTY.
*/
function entryConflicts(selection, detected, scope, url, serverName) {
	const conflicts = [];
	const beside = besideName(serverName, url);
	for (const id of selection) {
		const d = detected.find((x) => x.id === id);
		if (!d) continue;
		const landing = landingScope(d, scope);
		const state = entryState(landing, url);
		if (state === "absent" || state === "same-url") continue;
		const offer = state === "beside" || !landing?.besideConfigured;
		conflicts.push({
			id,
			label: d.label,
			state,
			...landing?.currentUrl ? { currentUrl: landing.currentUrl } : {},
			...beside && offer ? { besideName: beside } : {},
			...beside && !offer ? { besideTaken: beside } : {}
		});
	}
	return conflicts;
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
		ids: detected.filter((d) => d.available).map((d) => d.id),
		unknown: []
	};
	const ids = [];
	const unknown = [];
	for (const c of options.clients ?? []) if (!getHarness(c)) unknown.push(c);
	else ids.push(c);
	return {
		ids,
		unknown
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
		const override = plan.overrides?.get(id);
		outcomes.push({
			id,
			label: harness.label,
			result: install(harness, plan.mcpUrl, plan.dryRun, effective, override),
			...canHonor ? {} : named ? {} : { fallbackFrom: plan.scope },
			...override?.serverName ? { entryName: override.serverName } : {}
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
	const detected = deps.detect(url);
	const scope = options.scope ?? DEFAULT_SCOPE;
	let ids;
	let unknown = [];
	const byName = !options.all && (options.clients?.length ?? 0) > 0;
	if (options.all || byName) {
		const requested = resolveRequestedIds(options, detected);
		ids = requested.ids;
		unknown = requested.unknown;
	} else ids = autoSelectIds(detected, scope, url);
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
		dryRun: options.dryRun
	};
}
/** Why an install was refused, in the user's terms rather than the enum's. */
function failureText(o, switchCommand, entryName) {
	const r = o.result;
	const harness = getHarness(o.id);
	switch (r.reason) {
		case "unsupported-scope": return `no ${r.scope} scope` + (harness ? ` (supports: ${supportedScopes(harness).join(", ")})` : "");
		case "not-a-repo": return "project scope needs a git repository (run from inside one)";
		case "scope-collision": return `${r.scope} scope resolves to the same file as ${r.collidesWith ?? "another"} scope here — refusing rather than overwriting it`;
		case "url-mismatch": return "already configured with a different URL" + (r.currentUrl ? ` (${r.currentUrl})` : "") + (switchCommand ? `; run \`${switchCommand}\` to switch it, or add --name <other> to keep both` : `; ${removeHow(o, entryName)}, then re-run`);
		case "unrecognized-entry": return "an entry of that name already exists but holds no Levr URL we can read; remove it from the client's config by hand, or add this one with --name <other>";
		case "write-failed": return `its config could not be written` + (r.detail ? ` (${r.detail})` : "") + `; check the file's permissions and re-run`;
		case "unsupported-config-shape": return `its config could not be edited safely` + (r.detail ? ` (${r.detail})` : "") + `; fix the file or add the entry by hand`;
		default:
			if (r.commandError) return `\`${r.command}\` (${r.commandError})${restoreText(r)}` + alreadyExistsHint(o, r.commandError, entryName);
			return "no config location on this platform";
	}
}
/**
* The client's CLI refused because the entry already exists, in a config the
* installer did not read — otherwise it would have reported already set up,
* or a url-mismatch naming --replace. --replace cannot reach an entry it
* cannot see, so the way out is another name, or removing that entry with the
* client's own CLI (ENG-6696).
*/
function alreadyExistsHint(o, commandError, entryName) {
	if (!/already exists/i.test(commandError)) return "";
	const name = entryName ?? DEFAULT_SERVER_NAME;
	const scope = /already exists in (user|project|local) config/i.exec(commandError)?.[1]?.toLowerCase() ?? o.result.scope;
	return `; to keep it, add this one beside it with --name <other>; to switch it, remove it with ${o.id === "claude-code" ? `\`claude mcp remove --scope ${scope} ${name}\`` : "the client's own CLI"} and re-run`;
}
/**
* Where to remove an entry by hand: the exact command for Claude Code, else
* the config file it sits in (ENG-6736).
*/
function removeHow(o, entryName) {
	const name = entryName ?? DEFAULT_SERVER_NAME;
	const r = o.result;
	if (o.id === "claude-code") return `remove it with \`claude mcp remove --scope ${r.scope} ${name}\``;
	return r.path ? `remove the ${name} entry from ${r.path}` : `remove the ${name} entry from the client's config`;
}
/** What happened to the entry a failed `--replace` removed (ENG-6300 D6). */
function restoreText(r) {
	if (r.restored === void 0) return "";
	if (r.restored) return `; the previous entry was restored with its URL (${r.replacedUrl}) — any other settings it had were not`;
	return `; the previous entry (${r.replacedUrl}) could NOT be restored` + (r.restoreError ? ` (${r.restoreError})` : "") + " — this client has no Levr entry of that name now";
}
/** One human-readable status line per outcome. */
function outcomeLine(o, dryRun, switchCommand, entryName) {
	const r = o.result;
	const harness = getHarness(o.id);
	const scopeNote = harness ? scopeDef(harness, r.scope)?.note : void 0;
	const caveat = scopeNote ? ` [${scopeNote}]` : "";
	const unshared = r.gitIgnored === true && r.scope === "project" ? " [path is git-ignored — not shared via git]" : "";
	const note = (o.entryName ? ` [as ${o.entryName}]` : "") + (o.fallbackFrom ? ` [${o.fallbackFrom} scope unsupported — used ${r.scope}]` : "");
	const where = r.path ? ` → ${r.path}` : "";
	const backup = r.backupPath ? dryRun ? ` [original would be backed up to ${r.backupPath}]` : ` [original backed up to ${r.backupPath}]` : "";
	const replaced = r.replacedUrl ? dryRun ? ` [would replace ${r.replacedUrl}]` : ` [replaced ${r.replacedUrl}]` : "";
	if (!r.ok) {
		if (o.entryName) return `${o.label}: failed [as ${o.entryName}] — ${failureText(o, void 0, o.entryName)}`;
		return `${o.label}: failed — ${failureText(o, switchCommand, entryName)}`;
	}
	if (r.alreadyConfigured) return `${o.label}: already set up (${r.scope})${where}${note}${unshared}${caveat}`;
	if (r.command) {
		if (r.executed) return `${o.label}: installed (${r.scope}) via \`${r.command}\`${replaced}${note}${caveat}`;
		return `${o.label} (${r.scope}): run \`${r.command}\`${replaced}${note}${caveat}`;
	}
	if (dryRun) return `${o.label}: would update (${r.scope})${where} (dry run — no changes)${backup}${replaced}${note}${unshared}${caveat}`;
	if (r.wrote) return `${o.label}: installed (${r.scope})${where}${backup}${replaced}${note}${unshared}${caveat}`;
	return `${o.label}: no change (${r.scope})${where}${note}${unshared}${caveat}`;
}
/** Render a report as a plain multi-line summary (used by the CLI + tests). */
function formatReport(report) {
	const lines = [];
	lines.push(`MCP URL: ${report.url} (${report.urlSource})`);
	if (report.outcomes.length === 0 && (report.left ?? []).length === 0) lines.push("No clients selected.");
	else for (const o of report.outcomes) lines.push(outcomeLine(o, report.dryRun, report.switchCommand, report.entryName));
	for (const l of report.left ?? []) {
		const why = l.currentUrl ? `points at ${describeTarget(l.currentUrl)}` : `its ${report.entryName ?? DEFAULT_SERVER_NAME} entry holds no Levr URL`;
		const taken = l.besideTaken ? `; ${l.besideTaken} is taken too, so add this one with --name <other>` : "";
		lines.push(`${l.label}: left as it was (${why}${taken})`);
	}
	if (report.unknownClients.length > 0) lines.push(`Unknown clients (skipped): ${report.unknownClients.join(", ")}`);
	if (report.outcomes.some((o) => o.id === "claude-code" && o.result.ok)) lines.push(PLUGIN_TIP);
	return lines.join("\n");
}
/** The one note about the Claude Code plugin (ENG-4335 D6). */
const PLUGIN_TIP = "Tip: the Levr plugin adds /levr:work, /levr:file and /levr:done. Run /plugin install levr@levr in Claude Code (marketplace: BitModern/levr).";
/** Next-steps blurb after a run. */
function nextStepsText(report) {
	if (report.dryRun) return "Dry run — re-run without --dry-run to apply these changes.";
	if (!report.outcomes.some((o) => o.result.ok && !o.result.alreadyConfigured && (o.result.wrote || o.result.executed || o.result.command))) return report.outcomes.some((o) => !o.result.ok) ? "Nothing was installed." : "Nothing to do.";
	const installed = report.outcomes.filter((o) => o.result.ok && !o.result.alreadyConfigured);
	const claudeCode = installed.find((o) => o.id === "claude-code");
	const onlyClaudeCode = claudeCode && installed.length === 1;
	const entry = claudeCode?.entryName ?? report.entryName ?? DEFAULT_SERVER_NAME;
	const lines = onlyClaudeCode ? [`Next: restart Claude Code, run /mcp, pick ${entry} and choose Authenticate —`, "it opens your browser once. Then ask it: \"What issues are assigned to me?\""] : claudeCode ? [
		"Next: restart the client(s) above. Most prompt you to authorize Levr",
		`once in the browser; Claude Code does not: run /mcp, pick ${entry} and`,
		"choose Authenticate, and it opens your browser once. Then ask it:",
		"\"What issues are assigned to me?\""
	] : ["Next: restart the client(s) above — each will prompt you to authorize", "Levr once in the browser. Then ask it: \"What issues are assigned to me?\""];
	const projectWrites = report.outcomes.filter((o) => o.result.scope === "project" && o.result.wrote);
	if (projectWrites.some((o) => o.result.gitIgnored !== true)) lines.push("", "Project-scoped config was written into this repository — commit it to", "share the Levr MCP with everyone who checks it out.");
	if (projectWrites.some((o) => o.result.gitIgnored === true)) lines.push("", "A project-scoped file above is git-ignored, so it stays on this machine.", "To share it, un-ignore that path (a `!` rule in .gitignore) or use --scope user.");
	return lines.join("\n");
}

//#endregion
//#region src/commands/mcp/addHandler.ts
function depsFor(entry) {
	const install = (harness, mcpUrl, dryRun, scope, override) => installHarnessSync(harness, mcpUrl, {
		dryRun,
		scope,
		serverName: override?.serverName ?? entry.serverName,
		replaceExisting: override?.replaceExisting ?? entry.replaceExisting
	});
	return {
		detect: (url) => detectSync(void 0, {
			serverName: entry.serverName,
			besideName: besideName(entry.serverName, url)
		}),
		install
	};
}
/**
* The login that makes `--workspace <x>` work. With the hint, the login
* skips the workspace picker for that workspace and selects it (ENG-6694).
* Double quotes: the one quoting POSIX shells and cmd.exe both take.
*/
function loginCommandFor(workspace) {
	if (workspace === void 0) return "levr auth login";
	return `levr auth login --workspace ${/^[A-Za-z0-9_.@:/-]+$/.test(workspace) ? workspace : `"${workspace.replace(/"/g, "\\\"")}"`}`;
}
/**
* The workspaces of the logged-in user. Reads the session only; it never
* reads or changes the workspace the CLI has selected. `workspace` is the
* `--workspace` value, for the refusal to name the exact login to run.
*/
async function loadSites(workspace) {
	let auth;
	try {
		auth = await resolveToken();
	} catch (err) {
		const cause = err instanceof Error ? err.message : "Not authenticated. Run 'levr auth login' first.";
		if (workspace === void 0) return {
			ok: false,
			error: cause
		};
		return {
			ok: false,
			error: `${cause.replace(" or set LEVR_TOKEN environment variable", "")}\nTo pin this entry, log in naming the workspace: ${loginCommandFor(workspace)} (add --device-code on a headless machine), then re-run this command.`
		};
	}
	if (auth.type === "pat") return {
		ok: false,
		error: `--workspace needs a login session, not a personal access token. Run '${loginCommandFor(workspace)}'.`
	};
	configureClient(auth);
	try {
		return {
			ok: true,
			sites: await fetchSites()
		};
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : "Could not list your workspaces."
		};
	}
}
/**
* The same `levr mcp add` run with `--replace`, for refusals: every flag the
* user passed is kept, so the suggestion targets the same server, scope and
* clients, and the workspace that was actually chosen.
*/
function switchCommandFor(flags, urlKey) {
	const parts = ["levr mcp add"];
	if (flags.all) parts.push("--all");
	for (const client of flags.client ?? []) parts.push(`--client ${client}`);
	if (flags.yes) parts.push("--yes");
	if (flags.scope) parts.push(`--scope ${flags.scope}`);
	if (flags.url) parts.push(`--url ${flags.url}`);
	const workspace = urlKey ?? flags.workspace;
	if (workspace) parts.push(`--workspace ${workspace}`);
	if (flags.name) parts.push(`--name ${flags.name}`);
	parts.push("--replace");
	return parts.join(" ");
}
async function mcpAddHandler(flags) {
	const serverName = flags.name ?? DEFAULT_SERVER_NAME;
	if (!isValidEntryName(serverName)) {
		this.logger.error(`Invalid --name ${JSON.stringify(serverName)}: use 1-64 letters, digits, "-" or "_", not starting with "-".`);
		this.process.exitCode = 1;
		return;
	}
	const entry = {
		serverName,
		replaceExisting: flags.replace ?? false
	};
	let url;
	let source;
	try {
		({url, source} = resolveMcpUrl(flags.url));
	} catch (err) {
		this.logger.error(err instanceof Error ? err.message : "Could not resolve the MCP URL.");
		this.process.exitCode = 1;
		return;
	}
	let urlKey;
	if (flags.workspace !== void 0) {
		if (isScopedMcpUrl(url)) {
			this.logger.error(`The MCP URL ${url} already names a workspace. Drop --workspace, or pass the URL without its /w/<url_key> suffix.`);
			this.process.exitCode = 1;
			return;
		}
		if (!servedBySessionApi(url)) {
			this.logger.error(`--workspace looks workspaces up on ${getApiUrl()}, where you are logged in, but the MCP URL ${url} is on another server. Log in to that server (LEVR_URL=<its API> levr auth login), or drop --workspace.`);
			this.process.exitCode = 1;
			return;
		}
		const loaded = await loadSites(flags.workspace);
		if (!loaded.ok) {
			this.logger.error(loaded.error);
			this.process.exitCode = 1;
			return;
		}
		let site;
		try {
			site = findWorkspaceByKeyOrName(loaded.sites, flags.workspace);
		} catch (err) {
			this.logger.error(err instanceof Error ? err.message : "Unknown workspace.");
			this.process.exitCode = 1;
			return;
		}
		urlKey = site.workspace_url_key;
		url = scopedMcpUrl(url, urlKey);
		source = `${source}, workspace ${site.workspace_name}`;
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
		const report = {
			...runNonInteractive(options, url, source, depsFor(entry)),
			switchCommand: switchCommandFor(flags, urlKey),
			entryName: entry.serverName
		};
		this.process.stdout.write(`${formatReport(report)}\n`);
		if (!isScopedMcpUrl(url) && servedBySessionApi(url)) {
			const hint = await workspaceHint();
			if (hint) this.process.stdout.write(`\n${hint}\n`);
		}
		this.process.stdout.write(`\n${nextStepsText(report)}\n`);
		if (report.unknownClients.length > 0 || hasFailure(report)) this.process.exitCode = 1;
		await offerPreapproval(this, report.outcomes, {
			mode: "non-interactive",
			dryRun: options.dryRun,
			flag: flags["preapprove-tools"] ?? false,
			serverName: entry.serverName
		});
		return;
	}
	await interactive(this, options.dryRun, url, source, flags, entry, urlKey);
}
/**
* The sentence every disclosure carries, verbatim. It must stay literally
* true of every tool in `LEVR_PREAPPROVED_TOOLS` (code review F-027).
* deploy_gates and transition_issue stay pre-approved (user decision
* 2026-10-15): deploy_gates can change or withdraw a gate and
* transition_issue can waive one, so the disclosure says that instead of
* promising otherwise.
*/
const PREAPPROVE_EXPLANATION = "These let your agent call these Levr tools without asking each time. None of them can delete anything. deploy_gates can change or withdraw a task's gates, and transition_issue can waive a failing required gate to finish a task; every change and waiver is recorded on the gate.";
/** The confirmation question. The default is Yes (user decision 2026-11-11). */
const PREAPPROVE_QUESTION = "Add these permissions? (Y/n)";
/** Clients this run installed into that can take a pre-approval in that scope. */
function preapproveCandidates(outcomes) {
	const out = [];
	for (const o of outcomes) {
		if (!o.result.ok) continue;
		const harness = getHarness(o.id);
		if (!harness?.autoApprove?.file[o.result.scope]) continue;
		out.push({
			harness,
			scope: o.result.scope
		});
	}
	return out;
}
/** "get_issue: reads one task" for an entry's tool. */
function describeTool(tool) {
	const description = LEVR_PREAPPROVED_TOOL_DESCRIPTIONS[tool];
	return description ? `${tool}: ${description}` : tool;
}
/**
* Who the permission file reaches (code review F-030): a `project` file sits
* in the repository and is usually committed, so it grants the tools to
* everyone on the repo — unless the repository ignores it, in which case the
* sharing claim is false and the note says the file stays on this machine,
* matching the install line's `[path is git-ignored — not shared via git]`
* (ENG-7147, mirrors ENG-7134); a `local` file is personal, and when it is
* about to be created somewhere git does not ignore, the user is told so (we
* never edit their .gitignore).
*/
function sharingNote(plan) {
	if (plan.scope === "project") {
		if (plan.gitIgnored === true) return "This file is in your repository but git-ignored, so these permissions stay on this machine. To share them, un-ignore that path (a `!` rule in .gitignore) or use --scope user.";
		return "This file is in your repository and is usually committed: these permissions are shared via git with everyone who uses this repo.";
	}
	if (plan.scope === "local") {
		const note = "This file is personal to you in this repository.";
		if (!plan.fileExists && plan.gitIgnored === false) return `${note} It does not exist yet and git does not ignore it, so it would be committed by a "git add" of that folder: add it to .gitignore if you do not want to share it.`;
		return note;
	}
	return null;
}
/**
* The full disclosure for one client: the exact file, who it is shared with,
* every entry that would be added (each with what its tool does), what is
* already there, what the entries mean, any caveat, and how to undo it.
* Printed BEFORE anything is written, in every mode.
*/
function buildPreapproveDisclosure(label, plan) {
	const lines = [];
	lines.push(`${label}: pre-approve Levr tools`);
	lines.push(`File: ${plan.file}`);
	const sharing = sharingNote(plan);
	if (sharing) lines.push(sharing);
	const valueNote = plan.toolValue ? ` (each set to ${JSON.stringify(plan.toolValue)})` : "";
	lines.push(`Entries to add under "${plan.keyPath}"${valueNote}:`);
	for (const e of plan.addedEntries) lines.push(`  ${e.entry}  (${describeTool(e.tool)})`);
	if (plan.alreadyPresent.length > 0) lines.push(`Already present, left as is: ${plan.alreadyPresent.join(", ")}`);
	if (plan.conflicting.length > 0) lines.push(`Set differently by you, left as is: ${plan.conflicting.join(", ")}`);
	lines.push(PREAPPROVE_EXPLANATION);
	if (plan.caveat) lines.push(plan.caveat);
	lines.push(`To undo: remove these entries from "${plan.keyPath}" in ${plan.file}: ` + plan.added.join(", "));
	return lines.join("\n");
}
function preapproveFailureText(r) {
	if (r.reason === "allowlist-key-absent" && r.detail) return `permissions not added (${r.detail})`;
	return `permissions not added (${r.detail ? `${r.reason}: ${r.detail}` : r.reason ?? "unknown"})`;
}
/**
* Whether a not-`ok` result counts against an explicit `--preapprove-tools`
* (code review F-031). `allowlist-key-absent` is the writer declining on
* purpose to protect the user's own allowlist — the safe outcome, so it is
* reported but never fails the run.
*/
function isPreapproveFailure(r) {
	return !r.ok && r.reason !== "allowlist-key-absent";
}
/**
* Nothing to add (code review F-052): "already pre-approved" only when every
* entry is already there. Entries the user set differently (a Zed deny) are
* named as theirs and left alone — never claimed as approved.
*/
function nothingToAddText(label, plan) {
	if (plan.conflicting.length === 0) return `${label}: Levr tools are already pre-approved in ${plan.file}.`;
	const lines = [`${label}: nothing added to ${plan.file}.`, `Set differently by you, left as is: ${plan.conflicting.join(", ")}`];
	if (plan.alreadyPresent.length > 0) lines.push(`Already pre-approved: ${plan.alreadyPresent.join(", ")}`);
	return lines.join("\n");
}
/**
* After a successful install, offer to pre-approve Levr's non-destructive
* tools in each client that has a documented per-tool allow key.
*
* - Interactive: print the disclosure, then ask with No as the default.
* - Non-interactive: never write unless `--preapprove-tools` was passed; with
*   it, print the same disclosure to stderr before writing.
* - `--dry-run`: print the disclosure and write nothing.
*
* Error direction: fail_fallback(continue). A failure is reported as
* "permissions not added" and the run carries on to the next client. When
* `--preapprove-tools` was passed, the user ASKED for the write, so a
* failure sets exit code 1 once every client has been tried (code review
* F-031). An interactive "No" and `--dry-run` are never failures.
*
* Cancelling a prompt (Ctrl+C) stops the whole offer: no further client is
* asked, and each is reported "permissions not added" (code review F-063).
*/
async function offerPreapproval(ctx, outcomes, opts) {
	const candidates = preapproveCandidates(outcomes);
	if (candidates.length === 0) return;
	const out = (s) => ctx.process.stdout.write(`${s}\n`);
	if (opts.mode === "non-interactive" && !opts.flag && !opts.dryRun) {
		out("\nTip: re-run with --preapprove-tools to let your agent call Levr's non-destructive tools without asking each time (add --dry-run to see exactly what it would write).");
		return;
	}
	let failed = false;
	for (const [index, { harness, scope }] of candidates.entries()) {
		const plan = preapproveTools(harness, scope, opts.serverName, { dryRun: true });
		if (!plan.ok) {
			out(`\n${harness.label}: ${preapproveFailureText(plan)}`);
			if (!opts.dryRun && isPreapproveFailure(plan)) failed = true;
			continue;
		}
		if (plan.added.length === 0) {
			out(`\n${nothingToAddText(harness.label, plan)}`);
			continue;
		}
		const disclosure = buildPreapproveDisclosure(harness.label, plan);
		if (opts.dryRun) {
			out(`\n${disclosure}\n(dry run: nothing written)`);
			continue;
		}
		if (opts.mode === "non-interactive") ctx.process.stderr.write(`\n${disclosure}\n`);
		else {
			out(`\n${disclosure}`);
			const p = await import("@clack/prompts");
			const answer = await p.confirm({
				message: PREAPPROVE_QUESTION,
				initialValue: true
			});
			if (p.isCancel(answer)) {
				out(`${harness.label}: permissions not added.`);
				for (const rest of candidates.slice(index + 1)) out(`${rest.harness.label}: permissions not added (cancelled).`);
				break;
			}
			if (answer !== true) {
				out(`${harness.label}: permissions not added.`);
				continue;
			}
		}
		const written = preapproveTools(harness, scope, opts.serverName, { dryRun: false });
		if (!written.ok) {
			out(`${harness.label}: ${preapproveFailureText(written)}`);
			if (isPreapproveFailure(written)) failed = true;
			continue;
		}
		out(`${harness.label}: added ${written.added.length} permission ${written.added.length === 1 ? "entry" : "entries"} to ${written.file}.`);
	}
	if (opts.flag && failed) ctx.process.exitCode = 1;
}
/**
* For an unpinned entry: the `--workspace` choices. Without a session there is
* no list to show, so it says how to get one. Never fails the run.
*/
async function workspaceHint() {
	const loaded = await loadSites();
	if (!loaded.ok) return "This entry is not pinned to a workspace. To pin one, run 'levr auth login', then re-run with --workspace <url_key>.";
	if (loaded.sites.length === 0) return null;
	return "This entry is not pinned to a workspace. To pin it, re-run with --workspace <url_key>:\n" + describeWorkspaces(loaded.sites);
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
async function interactive(ctx, dryRun, baseUrl, baseSource, flags, entry, resolvedUrlKey) {
	const p = await import("@clack/prompts");
	const requestedScope = flags.scope;
	const deps = depsFor(entry);
	let url = baseUrl;
	let urlSource = baseSource;
	let urlKey = resolvedUrlKey;
	p.intro("Levr MCP setup");
	if (!isScopedMcpUrl(url) && servedBySessionApi(url)) {
		const loaded = await loadSites();
		if (loaded.ok && loaded.sites.length > 1) {
			const picked = await p.select({
				message: "Which workspace should this entry use?",
				options: loaded.sites.map((s) => ({
					value: s.workspace_url_key,
					label: s.workspace_name,
					hint: s.workspace_url_key
				}))
			});
			if (p.isCancel(picked)) {
				p.cancel("Cancelled.");
				ctx.process.exitCode = 1;
				return;
			}
			const site = loaded.sites.find((s) => s.workspace_url_key === picked);
			urlKey = picked;
			url = scopedMcpUrl(url, picked);
			urlSource = `${urlSource}, workspace ${site?.workspace_name ?? picked}`;
		}
	}
	p.note(`${url}\n(${urlSource})`, "MCP endpoint");
	const detected = deps.detect(url);
	const installable = detected.filter((d) => d.available);
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
	const rows = clientChoices(detected, scope, url, entry.serverName);
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
	const overrides = /* @__PURE__ */ new Map();
	const left = [];
	for (const c of entryConflicts(selection, detected, scope, url, entry.serverName)) {
		if (c.state === "beside") {
			if (c.besideName) overrides.set(c.id, {
				serverName: c.besideName,
				replaceExisting: false
			});
			continue;
		}
		if (c.state === "other-url" && entry.replaceExisting) continue;
		const where = c.currentUrl ? `points at ${describeTarget(c.currentUrl)}` : "holds no Levr URL";
		const options = [];
		if (c.state === "other-url") options.push({
			value: "switch",
			label: `Switch it to ${describeTarget(url)}`,
			hint: "replaces the entry"
		});
		if (c.besideName) options.push({
			value: "beside",
			label: `Add beside it as ${c.besideName}`,
			hint: "keeps both; each repeats every tool"
		});
		options.push({
			value: "leave",
			label: "Leave it"
		});
		const answer = options.length === 1 ? "leave" : await p.select({
			message: `${c.label}: its ${entry.serverName} entry ${where}` + (c.besideTaken ? `, and ${c.besideTaken} is taken too` : ""),
			options
		});
		if (p.isCancel(answer)) {
			p.cancel("Cancelled.");
			ctx.process.exitCode = 1;
			return;
		}
		if (answer === "switch") overrides.set(c.id, { replaceExisting: true });
		else if (answer === "beside" && c.besideName) overrides.set(c.id, {
			serverName: c.besideName,
			replaceExisting: false
		});
		else left.push({
			id: c.id,
			label: c.label,
			...c.currentUrl ? { currentUrl: c.currentUrl } : {},
			...c.besideTaken ? { besideTaken: c.besideTaken } : {}
		});
	}
	const leftIds = new Set(left.map((l) => l.id));
	const toInstall = selection.filter((id) => !leftIds.has(id));
	const spin = p.spinner();
	spin.start(dryRun ? "Previewing changes" : "Installing");
	const outcomes = installSelected(toInstall, {
		mcpUrl: url,
		dryRun,
		scope,
		namedIds: /* @__PURE__ */ new Set(),
		overrides
	}, deps.install);
	spin.stop(dryRun ? "Preview ready" : "Done");
	const report = {
		url,
		urlSource,
		scope,
		outcomes,
		unknownClients: [],
		dryRun,
		switchCommand: switchCommandFor(flags, urlKey),
		entryName: entry.serverName,
		left
	};
	p.note(formatReport(report), "Results");
	await offerPreapproval(ctx, outcomes, {
		mode: "interactive",
		dryRun,
		flag: flags["preapprove-tools"] ?? false,
		serverName: entry.serverName
	});
	p.outro(nextStepsText(report));
	if (hasFailure(report)) ctx.process.exitCode = 1;
}

//#endregion
export { mcpAddHandler };