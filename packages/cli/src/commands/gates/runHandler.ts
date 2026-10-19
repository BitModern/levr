import {
  client,
  issueFindAllV1,
  issueGateVerificationReportGateResultsV1,
  issueGateVerificationVerifyGatesV1,
} from '@levr-one/sdk';
import type { LocalContext } from '../../context.js';
import { resolveToken } from '../../auth/resolve-token.js';
import { resolveWorkspace } from '../../workspace/resolve-workspace.js';
import { configureClient } from '../../utils/sdk-client.js';
import {
  approvalOf,
  chooseShell,
  needsShell,
  NoPosixShellError,
  runInShell,
  runLocalCommands,
  runsWhere,
  type GateLocalCommand,
  type GateManualTask,
  type InspectRunner,
  type ShellRunner,
} from './gate-runner.js';
import { executeInspect } from './inspect.js';
import {
  ciCommitSha,
  ciOidcAudience,
  ciRequestHeaders,
  requestActionsOidcToken,
  withOidcJwksRetry,
} from './ci-oidc.js';

export interface GatesRunFlags {
  'workspace-id'?: string;
  'dry-run': boolean;
  json: boolean;
  verbose: boolean;
  ci: boolean;
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
  /**
   * internal — gates that can never run (their test deleted, or the gate
   * removed). A required one keeps the status off `all_pass`.
   */
  dead_gates?: Array<{
    link_id: string;
    /** internal R8 — the gate's name: its test's name. */
    test_name?: string | null;
    reason?: string;
    required?: boolean;
    remedy?: string;
  }>;
}

/** internal review R5 M3 — dead gates are named, with their remedy. */
function printDeadGates(
  out: (s: string) => void,
  dead: VerificationSummary['dead_gates'],
): void {
  for (const d of dead ?? []) {
    out(
      `  DEAD ${d.test_name ? `"${d.test_name}"` : d.link_id}${d.required === false ? ' (advisory)' : ''}: ` +
        `${d.reason === 'test_deleted' ? 'its test was deleted' : 'the gate was removed'}` +
        `${d.remedy ? ` — ${d.remedy}` : ''}`,
    );
  }
}

/**
 * internal review R5 M3 — exit 0 only on `all_pass` with no REQUIRED dead
 * gate (an older server's summary can still count a dead gate's old pass).
 */
function exitCodeOf(summary: VerificationSummary): number {
  const requiredDead = (summary.dead_gates ?? []).some(
    (d) => d.required !== false,
  );
  return summary.status === 'all_pass' && !requiredDead ? 0 : 1;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Seams for tests: the shell runner (production: `chooseShell`'s bash), the
 * in-process inspect runner (internal review C1), and the shell resolution
 * checked BEFORE anything runs (F-020).
 */
export const gatesRunDeps: {
  run: ShellRunner;
  inspect: InspectRunner;
  resolveShell: () => unknown;
} = {
  run: runInShell,
  inspect: (opJson) => executeInspect(opJson),
  resolveShell: () => chooseShell(),
};

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
  // `--ci` declares CI on every request; the OIDC token itself is fetched
  // later, per request (review H7). After configureClient: that call
  // replaces the SDK config outright.
  const setCiHeaders = (oidc: string | null) => {
    const current = client.getConfig();
    client.setConfig({
      ...current,
      headers: { ...current.headers, ...ciRequestHeaders(oidc) },
    });
  };
  if (flags.ci) setCiHeaders(null);
  let workspaceId: string | undefined;
  if (auth.type === 'jwt') {
    try {
      const ws = await resolveWorkspace(flags['workspace-id']);
      workspaceId = ws.workspaceId;
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
    const row = (
      found.data as
        | { data?: Array<{ id: string; workspace_id?: string }> }
        | undefined
    )?.data?.[0];
    if (found.error || !row) {
      this.logger.error(`Issue ${issue} not found in this workspace.`);
      this.process.exitCode = 1;
      return;
    }
    issueId = row.id;
    workspaceId ??= row.workspace_id;
  }

  // Review H7 — the token is minted for one workspace and lives minutes, so
  // it is requested fresh right before each verify and report, never once at
  // start-up. A PAT carries no workspace the CLI can see, so the issue says.
  const commitSha = flags.ci ? ciCommitSha() : undefined;
  const refreshCiToken = async (): Promise<void> => {
    if (!flags.ci) return;
    if (!workspaceId) {
      const found = await issueFindAllV1({
        query: { 'filter.id': [`$eq:${issueId}`], limit: 1 },
      });
      workspaceId = (
        found.data as { data?: Array<{ workspace_id?: string }> } | undefined
      )?.data?.[0]?.workspace_id;
    }
    setCiHeaders(
      workspaceId
        ? await requestActionsOidcToken(ciOidcAudience(workspaceId))
        : null,
    );
  };
  const ciBody = commitSha ? { commit_sha: commitSha } : {};

  await refreshCiToken();
  const verified = await withOidcJwksRetry(() =>
    issueGateVerificationVerifyGatesV1({
      path: { id: issueId },
      ...(commitSha ? { body: ciBody as never } : {}),
    }),
  );
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
      printDeadGates(out, summary.dead_gates);
      printManualTasks(out, tasks);
    } else {
      out(JSON.stringify({ verify: summary }, null, 2));
    }
    this.process.exitCode = exitCodeOf(summary);
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
            // Where it runs, and what the server approved it as. Display
            // only: a `confirm` command is not prompted for yet (D10).
            runs: runsWhere(c),
            ...approvalOf(c),
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
  // naming what to install. Never fall back to cmd.exe. Inspect ops run in
  // process, so a run made only of them needs no shell.
  if (needsShell(commands)) {
    try {
      gatesRunDeps.resolveShell();
    } catch (error) {
      if (!(error instanceof NoPosixShellError)) throw error;
      this.logger.error(error.message);
      this.process.exitCode = 1;
      return;
    }
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
    gatesRunDeps.inspect,
  );

  await refreshCiToken();
  const reported = await withOidcJwksRetry(() =>
    issueGateVerificationReportGateResultsV1({
      path: { id: issueId },
      body: { results, ...ciBody } as never,
    }),
  );
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
    printDeadGates(out, after.dead_gates ?? summary.dead_gates);
    printManualTasks(out, tasks);
  }
  this.process.exitCode = exitCodeOf({
    ...after,
    dead_gates: after.dead_gates ?? summary.dead_gates,
  });
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
