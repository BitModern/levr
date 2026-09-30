import "./env-CHeKHu5S.js";
import { client, configureClient, issueFindAllV1, issueGateVerificationReportGateResultsV1, issueGateVerificationVerifyGatesV1 } from "./sdk-client-DzIto-gE.js";
import "./workspace-store-DDOxnut1.js";
import { resolveWorkspace } from "./resolve-workspace-Bn3j_U7W.js";
import "./token-refresh-Cu5RpkLJ.js";
import { resolveToken } from "./resolve-token-DbQsmn03.js";
import { existsSync } from "node:fs";
import { constants } from "node:os";
import { spawnSync } from "node:child_process";

//#region src/commands/gates/gate-runner.ts
/**
* ENG-5967 F — run a deliverable's gate `local_commands` and build the
* `report_gate_results` payload from RAW facts.
*
* The contract with the server (`POST /v1/issue/:id/gate-results`, the same
* one the `report_gate_results` MCP tool takes):
*
*  - each `local_commands[]` entry is run EXACTLY as returned, through
*    `/bin/bash -c` (the shell the qinetic-mcp executor uses — see
*    `chooseShell`), from the current directory — no rewriting and no
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
* Why not the qinetic-mcp executor: it splits `&&` chains and rewrites paths
* for the Levr monorepo — the opposite of "exactly as returned". The CLI
* shares its wire contract, not its code, and imports
* no `@levr/*` value module (so the published bundle's inlined set is
* unchanged). The documented no-install helper
* (`packages/help-content/docs/gates/running-gates.mdx`) implements this same
* contract; `gate-runner.helper.test.ts` holds the two to identical output.
*/
/** The server's `GATE_STEP_TAIL_LIMIT` (`@levr/shared`), in chars. */
const GATE_STEP_TAIL_LIMIT = 4e3;
/** How long one command may run before it is killed (15 min). */
const GATE_COMMAND_TIMEOUT_MS = 900 * 1e3;
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
const runInShell = (command) => {
	const shell = chooseShell();
	const r = spawnSync(shell.file, shell.args(command), {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		timeout: GATE_COMMAND_TIMEOUT_MS
	});
	const stderr = (r.stderr ?? "") + (r.error ? `\n[runner] ${r.error.message}` : "") + (r.signal ? `\n[runner] killed by ${r.signal}` : "");
	const killed = r.error !== void 0 || r.signal !== null;
	const signalNumber = r.signal ? constants.signals[r.signal] : void 0;
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
* Run every command, in order, and build the `results[]` payload.
* `onBefore` is called BEFORE each command runs (to print it), `onEach`
* after, with its result.
*/
function runLocalCommands(commands, run = runInShell, onEach, onBefore) {
	return commands.map((command, index) => {
		onBefore?.(command, index);
		const result = toReportResult(command, run(command.command));
		onEach?.(command, result);
		return result;
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
* Seams for tests: the shell runner (production: `chooseShell`'s bash), and
* the shell resolution checked BEFORE anything runs (F-020).
*/
const gatesRunDeps = {
	run: runInShell,
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
	if (auth.type === "jwt") try {
		const ws = await resolveWorkspace(flags["workspace-id"]);
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
	}
	const verified = await issueGateVerificationVerifyGatesV1({ path: { id: issueId } });
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
	try {
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
	});
	const reported = await issueGateVerificationReportGateResultsV1({
		path: { id: issueId },
		body: { results }
	});
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