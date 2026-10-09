import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { constants as osConstants } from 'node:os';

/**
 * internal F — run a deliverable's gate `local_commands` and build the
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
export const GATE_STEP_TAIL_LIMIT = 4000;

/** How long one command may run before it is killed (15 min). */
export const GATE_COMMAND_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * How long an L4 semantic judge may run (3 min) — internal.
 *
 * The L4 templates used to carry their own `timeout 120`, which bounded the
 * judge on Linux and broke it on stock macOS (no GNU `timeout`). With the
 * wrapper gone, the runner holds the budget, as qinetic-mcp's executor does
 * with the same 180s. A hung judge (agy waiting on a prompt that never
 * renders) would otherwise hold `levr gates run` for the full 15 minutes.
 */
export const GATE_SEMANTIC_TIMEOUT_MS = 3 * 60 * 1000;

/** The kill budget for one command: semantic judges get the shorter one. */
export function commandTimeoutMs(command: GateLocalCommand): number {
  return command.technique === 'semantic'
    ? GATE_SEMANTIC_TIMEOUT_MS
    : GATE_COMMAND_TIMEOUT_MS;
}

/** One `local_commands[]` entry from `verify-gates`. */
export interface GateLocalCommand {
  gate_type: string;
  command: string;
  expected?: string;
  link_id: string;
  test_name?: string;
  /** internal — the gate definition's verification technique (a label). */
  technique?: string;
  step_id?: string;
  rule_hash?: string;
}

/** One `manual_tasks[]` entry — a guided gate a person or agent performs. */
export interface GateManualTask {
  gate_type: string;
  instruction: string;
  expected?: string;
  link_id: string;
  test_name?: string;
  step_ids?: string[];
}

/** The raw facts of one executed command. */
export interface RawGateStep {
  command: string;
  exit_code: number;
  stdout_tail: string;
  stderr_tail: string;
  step_id?: string;
}

/** One entry of the `report_gate_results` `results[]`. */
export interface GateReportResult {
  gate_type: string;
  link_id: string;
  status: 'pass' | 'fail';
  output: string;
  expected?: string;
  step_id?: string;
  rule_hash?: string;
  steps: RawGateStep[];
}

/** What running one command produced. */
export interface ShellOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type ShellRunner = (command: string, timeoutMs?: number) => ShellOutcome;

/** Keep the END of a stream — where runner summaries and verdicts are. */
export function tail(
  value: string | null | undefined,
  limit = GATE_STEP_TAIL_LIMIT,
): string {
  const s = value ?? '';
  return s.length <= limit ? s : s.slice(-limit);
}

/** How one command is handed to a shell. */
export interface ShellChoice {
  file: string;
  args: (command: string) => string[];
}

/**
 * No POSIX shell to run gate commands in — internal F-020. Thrown by
 * `chooseShell`; `levr gates run` turns it into a refusal before anything
 * runs or is reported.
 */
export class NoPosixShellError extends Error {
  constructor(platform: NodeJS.Platform) {
    super(
      platform === 'win32'
        ? 'Gate commands are bash, and no `bash` or `sh` was found on PATH. ' +
            'Install Git for Windows (Git Bash — https://git-scm.com/download/win) ' +
            'or run levr inside WSL, then re-run. Nothing was run or reported.'
        : 'Gate commands are bash, and neither /bin/bash nor /bin/sh exists on ' +
            'this machine. Install bash, then re-run. Nothing was run or reported.',
    );
    this.name = 'NoPosixShellError';
  }
}

/**
 * The shell a gate command runs in — internal F-020.
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
export function chooseShell(
  platform: NodeJS.Platform = process.platform,
  has: (shell: string) => boolean = shellExists,
): ShellChoice {
  const candidates =
    platform === 'win32' ? ['bash', 'sh'] : ['/bin/bash', '/bin/sh'];
  const file = candidates.find((c) => has(c));
  if (!file) throw new NoPosixShellError(platform);
  return { file, args: (c) => ['-c', c] };
}

function shellExists(shell: string): boolean {
  if (shell.startsWith('/')) return existsSync(shell);
  const r = spawnSync(shell, ['-c', 'exit 0'], { stdio: 'ignore' });
  return r.status === 0;
}

/**
 * Run one command with the chosen shell (`chooseShell`), synchronously, in
 * the current directory. A command that was killed (a signal, our timeout,
 * ENOBUFS) or never started reports 128 + the signal number, else 126, and
 * says why at the END of stderr, where the reported tail keeps it — never 0
 * and never 1. A 1 reads as "grep matched nothing" on the server, and Node
 * can report ENOBUFS with a numeric status (internal L1 review round 4
 * F-010/F-011).
 */
export const runInShell: ShellRunner = (
  command,
  timeoutMs = GATE_COMMAND_TIMEOUT_MS,
) => {
  const shell = chooseShell();
  const r = spawnSync(shell.file, shell.args(command), {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
  });
  const stderr =
    (r.stderr ?? '') +
    (r.error ? `\n[runner] ${r.error.message}` : '') +
    (r.signal ? `\n[runner] killed by ${r.signal}` : '');
  const killed = r.error !== undefined || r.signal !== null;
  const signalNumber = r.signal ? osConstants.signals[r.signal] : undefined;
  return {
    exitCode: killed
      ? typeof signalNumber === 'number'
        ? 128 + signalNumber
        : 126
      : (r.status ?? 126),
    stdout: r.stdout ?? '',
    stderr,
  };
};

/** The report entry for one command and what running it produced. */
export function toReportResult(
  command: GateLocalCommand,
  outcome: ShellOutcome,
): GateReportResult {
  const step: RawGateStep = {
    command: command.command,
    exit_code: outcome.exitCode,
    stdout_tail: tail(outcome.stdout),
    stderr_tail: tail(outcome.stderr),
    ...(command.step_id ? { step_id: command.step_id } : {}),
  };
  return {
    gate_type: command.gate_type,
    link_id: command.link_id,
    status: outcome.exitCode === 0 ? 'pass' : 'fail',
    output: tail(`${outcome.stdout}${outcome.stderr}`),
    ...(command.expected !== undefined ? { expected: command.expected } : {}),
    ...(command.step_id ? { step_id: command.step_id } : {}),
    ...(command.rule_hash ? { rule_hash: command.rule_hash } : {}),
    steps: [step],
  };
}

/**
 * Run every command, in order, and build the `results[]` payload.
 * `onBefore` is called BEFORE each command runs (to print it), `onEach`
 * after, with its result.
 */
export function runLocalCommands(
  commands: readonly GateLocalCommand[],
  run: ShellRunner = runInShell,
  onEach?: (command: GateLocalCommand, result: GateReportResult) => void,
  onBefore?: (command: GateLocalCommand, index: number) => void,
): GateReportResult[] {
  return commands.map((command, index) => {
    onBefore?.(command, index);
    const result = toReportResult(
      command,
      run(command.command, commandTimeoutMs(command)),
    );
    onEach?.(command, result);
    return result;
  });
}
