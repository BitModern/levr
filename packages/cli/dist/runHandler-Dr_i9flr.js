import { executeInspect } from "./inspect-DI7vOwHq.js";
import { client, configureClient } from "./sdk-client-B4FMd_Fa.js";
import "./env-CvjMSRd7.js";
import "./token-refresh-CJB7Qlxy.js";
import { resolveToken } from "./resolve-token-ByZq05Us.js";
import "./workspace-store-Bmw104Qa.js";
import { resolveWorkspace } from "./resolve-workspace-BbK3uYQc.js";
import { existsSync } from "node:fs";
import { constants as constants$1 } from "node:os";
import { spawnSync } from "node:child_process";

//#region ../sdk-public/dist/gen/issue/functions.js
/** GET /v1/issue */
const issueFindAllV1 = (options) => {
	return (options?.client ?? client).get({
		security: [{
			scheme: "bearer",
			type: "http"
		}],
		url: "/v1/issue",
		...options
	});
};

//#endregion
//#region ../sdk-public/dist/gen/issue-gate-verification/functions.js
/** POST /v1/issue/{id}/verify-gates */
const issueGateVerificationVerifyGatesV1 = (options) => {
	return (options?.client ?? client).post({
		security: [{
			scheme: "bearer",
			type: "http"
		}],
		url: "/v1/issue/{id}/verify-gates",
		...options
	});
};
/** POST /v1/issue/{id}/gate-results */
const issueGateVerificationReportGateResultsV1 = (options) => {
	return (options?.client ?? client).post({
		security: [{
			scheme: "bearer",
			type: "http"
		}],
		url: "/v1/issue/{id}/gate-results",
		...options
	});
};

//#endregion
//#region src/commands/gates/gate-runner.ts
/**
* ENG-5967 F — run a deliverable's gate `local_commands` and build the
* `report_gate_results` payload from RAW facts.
*
* The contract with the server (`POST /v1/issue/:id/gate-results`, the same
* one the `report_gate_results` MCP tool takes):
*
*  - each `local_commands[]` entry is run EXACTLY as returned, through
*    `/bin/bash -c` (`chooseShell`), from the current directory — no rewriting and no
*    splitting. The server decided what to run; this reports what happened.
*    `levr gates run` prints each command first; there is no local
*    allowlist — the server validates every command it hands out
*    (`validateGateCommand`, review R3-01) and returns one that fails as a
*    verification error;
*  - one result per command, carrying its `link_id`, `gate_type`, `step_id`
*    and `rule_hash`, and ONE raw step: the command, its exit code and the
*    last `GATE_STEP_TAIL_LIMIT` chars of stdout and stderr. A compound
*    command (`cd <ws> && yarn test:unit …`) stays one step: the server
*    judges it per top-level command (review R2-01), so reporting it whole
*    is as strict as the MCP executor's split;
*  - `status` is only the exit code's opinion. The server re-derives every
*    verdict from the steps (a test runner by its exit code and output, an
*    L4 judge by the verdict it stated), which is why the output must be the
*    command's own — a terminal proxy that rewrites it (RTK's `PASS (8)
*    FAIL (0)`) hides the signals the server reads. Spawning the commands
*    from this process means no proxy ever sees them.
*
* The qinetic-mcp executor used to split `&&` chains and rewrite paths for
* the Levr monorepo — the opposite of "exactly as returned" — and was
* retired (ENG-6175). The CLI reports each command whole.
*
* An INSPECT op (ENG-6179) is the one exception to "spawn it": its display
* command is `npx '@levr-one/cli@<spec>' gates inspect '<op json>'`, and
* spawning that would run whatever CLI version npm resolves for the pin,
* which may not have `gates inspect` at all. This CLI has it, so an inspect
* op runs IN PROCESS (`inspectOpOf` → `executeInspect`, through
* `@levr/shared`'s `GateOpSchema`, which the bundle inlines). The step
* still reports the command exactly as issued, with this run's exit code
* and output, so the server judges it the same way.
*/
/** The server's `GATE_STEP_TAIL_LIMIT` (`@levr/shared`), in chars. */
const GATE_STEP_TAIL_LIMIT = 4e3;
/** How long one command may run before it is killed (15 min). */
const GATE_COMMAND_TIMEOUT_MS = 900 * 1e3;
/**
* How long an L4 semantic judge may run (3 min) — ENG-4469.
*
* The L4 templates used to carry their own `timeout 120`, which bounded the
* judge on Linux and broke it on stock macOS (no GNU `timeout`). With the
* wrapper gone, the runner holds the budget, as qinetic-mcp's executor does
* with the same 180s. A hung judge (agy waiting on a prompt that never
* renders) would otherwise hold `levr gates run` for the full 15 minutes.
*/
const GATE_SEMANTIC_TIMEOUT_MS = 180 * 1e3;
/** The kill budget for one command: semantic judges get the shorter one. */
function commandTimeoutMs(command) {
	return command.technique === "semantic" ? GATE_SEMANTIC_TIMEOUT_MS : GATE_COMMAND_TIMEOUT_MS;
}
/** Keep the END of a stream — where runner summaries and verdicts are. */
function tail(value, limit = GATE_STEP_TAIL_LIMIT) {
	const s = value ?? "";
	return s.length <= limit ? s : s.slice(-limit);
}
/**
* No POSIX shell to run gate commands in — ENG-5967 F-020. Thrown by
* `chooseShell`; `levr gates run` turns it into a refusal before anything
* runs or is reported.
*/
var NoPosixShellError = class extends Error {
	constructor(platform) {
		super(platform === "win32" ? "Gate commands are bash, and no `bash` or `sh` was found on PATH. Install Git for Windows (Git Bash — https://git-scm.com/download/win) or run levr inside WSL, then re-run. Nothing was run or reported." : "Gate commands are bash, and neither /bin/bash nor /bin/sh exists on this machine. Install bash, then re-run. Nothing was run or reported.");
		this.name = "NoPosixShellError";
	}
};
/**
* The shell a gate command runs in — ENG-5967 F-020.
*
* Gate commands are written for, and run by the qinetic-mcp executor with,
* `/bin/bash` (`execSync(…, { shell: '/bin/bash' })`), and some use bash-only
* syntax (`${#v}`, arrays, `shopt`, `[[ ]]`). So:
*
*  - POSIX (`process.platform !== 'win32'`): `/bin/bash -c` when it exists,
*    else `/bin/sh -c` (a minimal image without bash; a bash-only command
*    then fails loudly with a syntax error, never silently passes);
*  - Windows: `bash -c` from PATH (Git Bash, WSL), else `sh -c` from PATH.
*
* With NEITHER, `NoPosixShellError` — never `cmd.exe`. cmd has no POSIX
* semantics at all (`&&` aside, quoting, `$(…)`, `test`, pipes into `grep`
* all differ), so a gate "run" there reports failures that say nothing about
* the code; refusing, and naming what to install, is the honest answer.
*
* `has` answers whether a shell is available — an absolute path is checked
* on disk, a bare name by trying to run it. Injectable for tests.
*/
function chooseShell(platform = process.platform, has = shellExists) {
	const file = (platform === "win32" ? ["bash", "sh"] : ["/bin/bash", "/bin/sh"]).find((c) => has(c));
	if (!file) throw new NoPosixShellError(platform);
	return {
		file,
		args: (c) => ["-c", c]
	};
}
function shellExists(shell) {
	if (shell.startsWith("/")) return existsSync(shell);
	return spawnSync(shell, ["-c", "exit 0"], { stdio: "ignore" }).status === 0;
}
/**
* Run one command with the chosen shell (`chooseShell`), synchronously, in
* the current directory. A command that was killed (a signal, our timeout,
* ENOBUFS) or never started reports 128 + the signal number, else 126, and
* says why at the END of stderr, where the reported tail keeps it — never 0
* and never 1. A 1 reads as "grep matched nothing" on the server, and Node
* can report ENOBUFS with a numeric status (ENG-5106 L1 review round 4
* F-010/F-011).
*/
const runInShell = (command, timeoutMs = GATE_COMMAND_TIMEOUT_MS) => {
	const shell = chooseShell();
	const r = spawnSync(shell.file, shell.args(command), {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		timeout: timeoutMs
	});
	const stderr = (r.stderr ?? "") + (r.error ? `\n[runner] ${r.error.message}` : "") + (r.signal ? `\n[runner] killed by ${r.signal}` : "");
	const killed = r.error !== void 0 || r.signal !== null;
	const signalNumber = r.signal ? constants$1.signals[r.signal] : void 0;
	return {
		exitCode: killed ? typeof signalNumber === "number" ? 128 + signalNumber : 126 : r.status ?? 126,
		stdout: r.stdout ?? "",
		stderr
	};
};
/** The report entry for one command and what running it produced. */
function toReportResult(command, outcome) {
	const step = {
		command: command.command,
		exit_code: outcome.exitCode,
		stdout_tail: tail(outcome.stdout),
		stderr_tail: tail(outcome.stderr),
		...command.step_id ? { step_id: command.step_id } : {}
	};
	return {
		gate_type: command.gate_type,
		link_id: command.link_id,
		status: outcome.exitCode === 0 ? "pass" : "fail",
		output: tail(`${outcome.stdout}${outcome.stderr}`),
		...command.expected !== void 0 ? { expected: command.expected } : {},
		...command.step_id ? { step_id: command.step_id } : {},
		...command.rule_hash ? { rule_hash: command.rule_hash } : {},
		steps: [step]
	};
}
/**
* The display form the server renders for an inspect op:
* `npx '@levr-one/cli@<spec>' gates inspect '<json>'` (POSIX quoting, where a
* `'` inside is written `'\''`). Also accepts a bare `levr gates inspect`.
*/
const INSPECT_DISPLAY_RE = /^\s*(?:npx(?:\s+--?[A-Za-z][\w-]*)*\s+(?:'@levr-one\/cli(?:@[^']*)?'|@levr-one\/cli(?:@\S*)?)|levr)\s+gates\s+inspect\s+'((?:[^']|'\\'')*)'\s*$/;
/**
* The inspect op JSON a local command carries, or `null` when it is not an
* inspect op. The envelope's `op` is authoritative; the display string is
* parsed only when the envelope is absent (an older server).
*/
function inspectOpOf(command) {
	const op = command.op?.op;
	if (op && typeof op === "object") return op.op === "inspect" ? JSON.stringify(op) : null;
	const match = INSPECT_DISPLAY_RE.exec(command.command);
	if (!match) return null;
	return (match[1] ?? "").replace(/'\\''/g, "'");
}
/**
* Where a command runs: inspect ops in this process, everything else in the
* shell `chooseShell` picks. Shown by `--dry-run` so a reader knows which
* printed `npx … gates inspect` lines never spawn anything.
*/
function runsWhere(command) {
	return inspectOpOf(command) === null ? "shell" : "in-process";
}
/**
* The server's approval for a command (`server_approved`, `confirm`,
* `denied`) and why, from the op envelope; `undefined` from an older server.
* Display only: nothing here asks for a confirmation yet (that is D10,
* ENG-6183), so a `confirm` command still runs.
*/
function approvalOf(command) {
	const approval = command.op?.["approval"];
	if (typeof approval !== "string") return void 0;
	const basis = command.op?.["approval_basis"];
	return typeof basis === "string" ? {
		approval,
		approval_basis: basis
	} : { approval };
}
/**
* True when at least one command must be spawned in a shell (anything that
* is not an inspect op), so a missing shell matters.
*/
function needsShell(commands) {
	return commands.some((command) => inspectOpOf(command) === null);
}
/**
* Run every command, in order, and build the `results[]` payload.
* `onBefore` is called BEFORE each command runs (to print it), `onEach`
* after, with its result.
*/
function runLocalCommands(commands, run = runInShell, onEach, onBefore, inspect = executeInspect) {
	return commands.map((command, index) => {
		onBefore?.(command, index);
		const opJson = inspectOpOf(command);
		const result = toReportResult(command, opJson !== null ? inspect(opJson) : run(command.command, commandTimeoutMs(command)));
		onEach?.(command, result);
		return result;
	});
}

//#endregion
//#region src/commands/gates/ci-oidc.ts
/**
* GitHub Actions OIDC for `levr gates run --ci` (ENG-6177).
*
* The workflow needs `permissions: id-token: write` (documented with the
* pin in D13). When the runner env vars are absent, the CLI still declares
* CI and the server records `unverified` — it never invents a token.
*
* `fail_retry`: a report or verify that answers `OIDC_JWKS_UNAVAILABLE`
* (503) is retried twice with backoff, then the command exits non-zero.
* Nothing was recorded for those attempts.
*
* ENG-5987 review H7: the token is minted for ONE workspace
* (`levr:<workspace_id>`, matching the server's `ciOidcAudience`), is
* requested fresh right before each verify and report (an Actions token lives
* minutes, and a long suite outlived the one fetched at start-up), and the
* request is bounded by a timeout so a hung token endpoint cannot hang CI.
* The run's commit (`GITHUB_SHA`) is sent as `commit_sha`, which the server
* now requires before it will stamp `oidc_verified`.
*/
const CI_OIDC_HEADER = "X-Levr-CI-OIDC";
const CI_DECLARED_HEADER = "X-Levr-CI-Declared";
const OIDC_JWKS_UNAVAILABLE = "OIDC_JWKS_UNAVAILABLE";
const RETRY_DELAYS_MS = [250, 750];
const TOKEN_REQUEST_TIMEOUT_MS = 1e4;
const COMMIT_SHA = /^[0-9a-f]{40}$/i;
/** The audience the server expects — `levr:<workspace_id>`. */
function ciOidcAudience(workspaceId) {
	return `levr:${workspaceId}`;
}
/** The commit this Actions run checked out, when the runner says so. */
function ciCommitSha(env = process.env) {
	const sha = env["GITHUB_SHA"]?.trim();
	return sha && COMMIT_SHA.test(sha) ? sha : void 0;
}
function actionsOidcEnvFrom(env = process.env) {
	return {
		ACTIONS_ID_TOKEN_REQUEST_URL: env["ACTIONS_ID_TOKEN_REQUEST_URL"],
		ACTIONS_ID_TOKEN_REQUEST_TOKEN: env["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]
	};
}
/**
* Request an Actions OIDC token for `audience`. Returns null when the runner
* did not expose the env vars, the request failed, or it did not answer
* within `timeoutMs` — the caller still sends the declaration header, and
* the server records `unverified`.
*/
async function requestActionsOidcToken(audience, env = actionsOidcEnvFrom(), fetchImpl = globalThis.fetch, timeoutMs = TOKEN_REQUEST_TIMEOUT_MS) {
	const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
	const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
	if (!url || !requestToken) return null;
	let endpoint;
	try {
		endpoint = new URL(url);
	} catch {
		return null;
	}
	endpoint.searchParams.set("audience", audience);
	try {
		const response = await fetchImpl(endpoint, {
			headers: { Authorization: `bearer ${requestToken}` },
			signal: AbortSignal.timeout(timeoutMs)
		});
		if (!response.ok) return null;
		const body = await response.json();
		return typeof body.value === "string" && body.value.length > 0 ? body.value : null;
	} catch {
		return null;
	}
}
/** Headers for verify and report. Declaration is `1` whenever `--ci` is set. */
function ciRequestHeaders(token) {
	const headers = { [CI_DECLARED_HEADER]: "1" };
	if (token) headers[CI_OIDC_HEADER] = token;
	return headers;
}
function isOidcJwksUnavailable(result) {
	if (result.response?.status !== 503) return false;
	return JSON.stringify(result.error ?? "").includes(OIDC_JWKS_UNAVAILABLE);
}
/**
* Run `fn` and, on `OIDC_JWKS_UNAVAILABLE`, retry twice. Any other result
* is returned as-is. `fail_retry(2)`.
*/
async function withOidcJwksRetry(fn, sleep = delay) {
	let result = await fn();
	for (const wait of RETRY_DELAYS_MS) {
		if (!isOidcJwksUnavailable(result)) return result;
		await sleep(wait);
		result = await fn();
	}
	return result;
}
function delay(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

//#endregion
//#region src/commands/gates/runHandler.ts
/** ENG-6070 review R5 M3 — dead gates are named, with their remedy. */
function printDeadGates(out, dead) {
	for (const d of dead ?? []) out(`  DEAD ${d.test_name ? `"${d.test_name}"` : d.link_id}${d.required === false ? " (advisory)" : ""}: ${d.reason === "test_deleted" ? "its test was deleted" : "the gate was removed"}${d.remedy ? ` — ${d.remedy}` : ""}`);
}
/**
* ENG-6070 review R5 M3 — exit 0 only on `all_pass` with no REQUIRED dead
* gate (an older server's summary can still count a dead gate's old pass).
*/
function exitCodeOf(summary) {
	const requiredDead = (summary.dead_gates ?? []).some((d) => d.required !== false);
	return summary.status === "all_pass" && !requiredDead ? 0 : 1;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
* Seams for tests: the shell runner (production: `chooseShell`'s bash), the
* in-process inspect runner (ENG-6180 review C1), and the shell resolution
* checked BEFORE anything runs (F-020).
*/
const gatesRunDeps = {
	run: runInShell,
	inspect: (opJson) => executeInspect(opJson),
	resolveShell: () => chooseShell()
};
/**
* `levr gates run <issue>` — ENG-5967 F. Verify the deliverable's gates, run
* each `local_commands` entry exactly as returned, report the raw facts, and
* list any guided gates (which a person or agent performs and reports with
* `report_gate_results` step_results — this command never reports them).
*
* ENG-5967 F-008 — the commands come from the server, so nothing runs unseen:
*  - every command is printed BEFORE it runs (to stderr under `--json`, so
*    the JSON on stdout stays parseable);
*  - `--dry-run` lists the commands and the report entries they would
*    produce, and runs NOTHING.
* There is no local allowlist (user decision 2026-09-25, review R3-01): the
* SERVER validates every local command it renders (`validateGateCommand`)
* and returns one that fails as a verification error, never as a command.
*
* Exit code: 0 when the server's summary after the report is `all_pass`
* (or, with nothing to run, already all_pass); 1 otherwise, so a CI step can
* gate on it.
*/
async function gatesRunHandler(flags, issue) {
	if (flags.verbose) this.logger.setVerbose(true);
	const out = (s) => this.process.stdout.write(`${s}\n`);
	let auth;
	try {
		auth = await resolveToken();
	} catch (err) {
		this.logger.error(err instanceof Error ? err.message : "Authentication failed.");
		this.process.exitCode = 1;
		return;
	}
	configureClient(auth);
	const setCiHeaders = (oidc) => {
		const current = client.getConfig();
		client.setConfig({
			...current,
			headers: {
				...current.headers,
				...ciRequestHeaders(oidc)
			}
		});
	};
	if (flags.ci) setCiHeaders(null);
	let workspaceId;
	if (auth.type === "jwt") try {
		const ws = await resolveWorkspace(flags["workspace-id"]);
		workspaceId = ws.workspaceId;
		client.setConfig({
			...client.getConfig(),
			workspaceId: ws.workspaceId
		});
	} catch (err) {
		this.logger.error(err instanceof Error ? err.message : "Workspace resolution failed.");
		this.process.exitCode = 1;
		return;
	}
	let issueId = issue;
	if (!UUID_RE.test(issue)) {
		const found = await issueFindAllV1({ query: {
			"filter.identifier": [`$eq:${issue}`],
			limit: 1
		} });
		const row = found.data?.data?.[0];
		if (found.error || !row) {
			this.logger.error(`Issue ${issue} not found in this workspace.`);
			this.process.exitCode = 1;
			return;
		}
		issueId = row.id;
		workspaceId ??= row.workspace_id;
	}
	const commitSha = flags.ci ? ciCommitSha() : void 0;
	const refreshCiToken = async () => {
		if (!flags.ci) return;
		if (!workspaceId) workspaceId = (await issueFindAllV1({ query: {
			"filter.id": [`$eq:${issueId}`],
			limit: 1
		} })).data?.data?.[0]?.workspace_id;
		setCiHeaders(workspaceId ? await requestActionsOidcToken(ciOidcAudience(workspaceId)) : null);
	};
	const ciBody = commitSha ? { commit_sha: commitSha } : {};
	await refreshCiToken();
	const verified = await withOidcJwksRetry(() => issueGateVerificationVerifyGatesV1({
		path: { id: issueId },
		...commitSha ? { body: ciBody } : {}
	}));
	if (verified.error) {
		this.logger.error(`verify-gates failed (${String(verified.response?.status ?? "unknown")}): ${JSON.stringify(verified.error)}`);
		this.process.exitCode = 1;
		return;
	}
	const summary = verified.data;
	const commands = summary.local_commands ?? [];
	const tasks = summary.manual_tasks ?? [];
	const label = summary.deliverable ?? issue;
	if (commands.length === 0) {
		if (!flags.json) {
			out(`${label}: no local commands to run (status ${summary.status ?? "unknown"}, ${summary.gates_passing ?? 0}/${summary.gates_total ?? 0} gates passing).`);
			printDeadGates(out, summary.dead_gates);
			printManualTasks(out, tasks);
		} else out(JSON.stringify({ verify: summary }, null, 2));
		this.process.exitCode = exitCodeOf(summary);
		return;
	}
	if (flags["dry-run"]) {
		out(JSON.stringify({
			dry_run: true,
			deliverable: label,
			commands: commands.map((c) => ({
				test_name: c.test_name ?? c.gate_type,
				gate_type: c.gate_type,
				link_id: c.link_id,
				command: c.command,
				runs: runsWhere(c),
				...approvalOf(c),
				...c.expected !== void 0 ? { expected: c.expected } : {},
				...c.step_id ? { step_id: c.step_id } : {},
				...c.rule_hash ? { rule_hash: c.rule_hash } : {}
			})),
			report_entry_shape: {
				gate_type: "<gate_type>",
				link_id: "<link_id>",
				status: "pass | fail (exit code 0 or not)",
				output: "<last 4000 chars of stdout+stderr>",
				step_id: "<step_id>",
				rule_hash: "<rule_hash>",
				steps: [{
					command: "<command, exactly as above>",
					exit_code: "<n>",
					stdout_tail: "<last 4000 chars>",
					stderr_tail: "<last 4000 chars>"
				}]
			}
		}, null, 2));
		if (!flags.json) printManualTasks(out, tasks);
		return;
	}
	if (needsShell(commands)) try {
		gatesRunDeps.resolveShell();
	} catch (error) {
		if (!(error instanceof NoPosixShellError)) throw error;
		this.logger.error(error.message);
		this.process.exitCode = 1;
		return;
	}
	const announce = (s) => flags.json ? this.process.stderr.write(`${s}\n`) : out(s);
	const results = runLocalCommands(commands, gatesRunDeps.run, (_command, result) => {
		if (flags.json) return;
		out(`  [exit ${result.steps[0].exit_code}]`);
	}, (command, index) => {
		announce(`[${index + 1}/${commands.length}] ${command.test_name ?? command.gate_type}: ${command.command}`);
	}, gatesRunDeps.inspect);
	await refreshCiToken();
	const reported = await withOidcJwksRetry(() => issueGateVerificationReportGateResultsV1({
		path: { id: issueId },
		body: {
			results,
			...ciBody
		}
	}));
	if (reported.error) {
		this.logger.error(`gate-results failed (${String(reported.response?.status ?? "unknown")}): ${JSON.stringify(reported.error)}`);
		this.process.exitCode = 1;
		return;
	}
	const after = reported.data;
	if (flags.json) out(JSON.stringify({
		results,
		report: after
	}, null, 2));
	else {
		out("");
		out(`${after.deliverable ?? label}: ${after.status ?? "unknown"} — ${after.gates_passing ?? 0}/${after.gates_total ?? 0} gates passing`);
		for (const g of after.gates ?? []) {
			if (g.status === "pass") continue;
			out(`  ${String(g.status).toUpperCase()} ${g.test_name ?? g.gate_type}: ${String(g.actual ?? "").slice(0, 300)}`);
		}
		for (const r of after.receipts ?? []) if (!r.accepted) out(`  REJECTED ${r.link_id}: ${r.reason ?? ""}`);
		printDeadGates(out, after.dead_gates ?? summary.dead_gates);
		printManualTasks(out, tasks);
	}
	this.process.exitCode = exitCodeOf({
		...after,
		dead_gates: after.dead_gates ?? summary.dead_gates
	});
}
function printManualTasks(out, tasks) {
	if (tasks.length === 0) return;
	out("");
	out(`${tasks.length} guided gate(s) — perform each and report what you OBSERVED with report_gate_results step_results[] (not run by this command):`);
	for (const t of tasks) {
		out(`  - [${t.link_id}] ${t.test_name ?? t.gate_type}: ${t.instruction}`);
		if (t.expected) out(`    expected: ${t.expected}`);
	}
}

//#endregion
export { gatesRunHandler };