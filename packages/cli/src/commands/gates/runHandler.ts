import {
  client,
  issueFindAllV1,
  issueGateVerificationReportGateResultsV1,
  issueGateVerificationVerifyGatesV1,
} from '@levr/sdk';
import type { LocalContext } from '../../context.js';
import { resolveToken } from '../../auth/resolve-token.js';
import { resolveWorkspace } from '../../workspace/resolve-workspace.js';
import { configureClient } from '../../utils/sdk-client.js';
import {
  chooseShell,
  NoPosixShellError,
  runInShell,
  runLocalCommands,
  type GateLocalCommand,
  type GateManualTask,
  type ShellRunner,
} from './gate-runner.js';

export interface GatesRunFlags {
  'workspace-id'?: string;
  'dry-run': boolean;
  json: boolean;
  verbose: boolean;
}

/** The subset of the verify / report response this command reads. */
interface VerificationSummary {
  deliverable?: string;
  status?: string;
  gates_passing?: number;
  gates_total?: number;
  local_commands?: GateLocalCommand[];
  manual_tasks?: GateManualTask[];
  gates?: Array<{
    gate_type?: string;
    status?: string;
    test_name?: string;
    actual?: string;
  }>;
  receipts?: Array<{
    link_id: string;
    accepted: boolean;
    recorded_status?: string;
    reason?: string;
  }>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Seams for tests: the shell runner (production: `chooseShell`'s bash), and
 * the shell resolution checked BEFORE anything runs (F-020).
 */
export const gatesRunDeps: {
  run: ShellRunner;
  resolveShell: () => unknown;
} = { run: runInShell, resolveShell: () => chooseShell() };

/**
 * `levr gates run <issue>` — internal F. Verify the deliverable's gates, run
 * each `local_commands` entry exactly as returned, report the raw facts, and
 * list any guided gates (which a person or agent performs and reports with
 * `report_gate_results` step_results — this command never reports them).
 *
 * internal F-008 — the commands come from the server, so nothing runs unseen:
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
export async function gatesRunHandler(
  this: LocalContext,
  flags: GatesRunFlags,
  issue: string,
): Promise<void> {
  if (flags.verbose) this.logger.setVerbose(true);
  const out = (s: string) => this.process.stdout.write(`${s}\n`);

  let auth;
  try {
    auth = await resolveToken();
  } catch (err) {
    this.logger.error(
      err instanceof Error ? err.message : 'Authentication failed.',
    );
    this.process.exitCode = 1;
    return;
  }
  configureClient(auth);
  if (auth.type === 'jwt') {
    try {
      const ws = await resolveWorkspace(flags['workspace-id']);
      client.setConfig({ ...client.getConfig(), workspaceId: ws.workspaceId });
    } catch (err) {
      this.logger.error(
        err instanceof Error ? err.message : 'Workspace resolution failed.',
      );
      this.process.exitCode = 1;
      return;
    }
  }

  // An identifier (internal) or a UUID.
  let issueId = issue;
  if (!UUID_RE.test(issue)) {
    const found = await issueFindAllV1({
      query: { 'filter.identifier': [`$eq:${issue}`], limit: 1 },
    });
    const row = (found.data as { data?: Array<{ id: string }> } | undefined)
      ?.data?.[0];
    if (found.error || !row) {
      this.logger.error(`Issue ${issue} not found in this workspace.`);
      this.process.exitCode = 1;
      return;
    }
    issueId = row.id;
  }

  const verified = await issueGateVerificationVerifyGatesV1({
    path: { id: issueId },
  });
  if (verified.error) {
    this.logger.error(
      `verify-gates failed (${String(verified.response?.status ?? 'unknown')}): ${JSON.stringify(verified.error)}`,
    );
    this.process.exitCode = 1;
    return;
  }
  const summary = verified.data as VerificationSummary;
  const commands = summary.local_commands ?? [];
  const tasks = summary.manual_tasks ?? [];
  const label = summary.deliverable ?? issue;

  if (commands.length === 0) {
    if (!flags.json) {
      out(
        `${label}: no local commands to run (status ${summary.status ?? 'unknown'}, ` +
          `${summary.gates_passing ?? 0}/${summary.gates_total ?? 0} gates passing).`,
      );
      printManualTasks(out, tasks);
    } else {
      out(JSON.stringify({ verify: summary }, null, 2));
    }
    this.process.exitCode = summary.status === 'all_pass' ? 0 : 1;
    return;
  }

  if (flags['dry-run']) {
    // Lists, never executes: a dry run exists to let a person read what a
    // real run would do before anything touches their machine.
    out(
      JSON.stringify(
        {
          dry_run: true,
          deliverable: label,
          commands: commands.map((c) => ({
            test_name: c.test_name ?? c.gate_type,
            gate_type: c.gate_type,
            link_id: c.link_id,
            command: c.command,
            ...(c.expected !== undefined ? { expected: c.expected } : {}),
            ...(c.step_id ? { step_id: c.step_id } : {}),
            ...(c.rule_hash ? { rule_hash: c.rule_hash } : {}),
          })),
          // One report entry per command: this shape, with the exit code and
          // the output tails filled in by the run.
          report_entry_shape: {
            gate_type: '<gate_type>',
            link_id: '<link_id>',
            status: 'pass | fail (exit code 0 or not)',
            output: '<last 4000 chars of stdout+stderr>',
            step_id: '<step_id>',
            rule_hash: '<rule_hash>',
            steps: [
              {
                command: '<command, exactly as above>',
                exit_code: '<n>',
                stdout_tail: '<last 4000 chars>',
                stderr_tail: '<last 4000 chars>',
              },
            ],
          },
        },
        null,
        2,
      ),
    );
    if (!flags.json) printManualTasks(out, tasks);
    return;
  }

  // internal F-020 — no bash and no sh: refuse before running anything,
  // naming what to install. Never fall back to cmd.exe.
  try {
    gatesRunDeps.resolveShell();
  } catch (error) {
    if (!(error instanceof NoPosixShellError)) throw error;
    this.logger.error(error.message);
    this.process.exitCode = 1;
    return;
  }

  // Printed BEFORE each command runs; stderr under --json keeps stdout JSON.
  const announce = (s: string) =>
    flags.json ? this.process.stderr.write(`${s}\n`) : out(s);
  const results = runLocalCommands(
    commands,
    gatesRunDeps.run,
    (_command, result) => {
      if (flags.json) return;
      out(`  [exit ${result.steps[0]!.exit_code}]`);
    },
    (command, index) => {
      announce(
        `[${index + 1}/${commands.length}] ${command.test_name ?? command.gate_type}: ${command.command}`,
      );
    },
  );

  const reported = await issueGateVerificationReportGateResultsV1({
    path: { id: issueId },
    body: { results } as never,
  });
  if (reported.error) {
    this.logger.error(
      `gate-results failed (${String(reported.response?.status ?? 'unknown')}): ${JSON.stringify(reported.error)}`,
    );
    this.process.exitCode = 1;
    return;
  }
  const after = reported.data as VerificationSummary;

  if (flags.json) {
    out(JSON.stringify({ results, report: after }, null, 2));
  } else {
    out('');
    out(
      `${after.deliverable ?? label}: ${after.status ?? 'unknown'} — ` +
        `${after.gates_passing ?? 0}/${after.gates_total ?? 0} gates passing`,
    );
    for (const g of after.gates ?? []) {
      if (g.status === 'pass') continue;
      out(
        `  ${String(g.status).toUpperCase()} ${g.test_name ?? g.gate_type}: ${String(g.actual ?? '').slice(0, 300)}`,
      );
    }
    for (const r of after.receipts ?? []) {
      if (!r.accepted) out(`  REJECTED ${r.link_id}: ${r.reason ?? ''}`);
    }
    printManualTasks(out, tasks);
  }
  this.process.exitCode = after.status === 'all_pass' ? 0 : 1;
}

function printManualTasks(
  out: (s: string) => void,
  tasks: readonly GateManualTask[],
): void {
  if (tasks.length === 0) return;
  out('');
  out(
    `${tasks.length} guided gate(s) — perform each and report what you ` +
      `OBSERVED with report_gate_results step_results[] (not run by this command):`,
  );
  for (const t of tasks) {
    out(`  - [${t.link_id}] ${t.test_name ?? t.gate_type}: ${t.instruction}`);
    if (t.expected) out(`    expected: ${t.expected}`);
  }
}
