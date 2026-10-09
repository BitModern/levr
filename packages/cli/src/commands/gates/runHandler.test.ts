import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ReportCall {
  path: { id: string };
  body: { results: Array<Record<string, unknown>> };
}

const sdk = vi.hoisted(() => ({
  issueFindAllV1: vi.fn(),
  issueGateVerificationVerifyGatesV1: vi.fn(),
  issueGateVerificationReportGateResultsV1: vi.fn(),
  client: { setConfig: vi.fn(), getConfig: vi.fn(() => ({})) },
}));
vi.mock('@levr-one/sdk', () => sdk);
vi.mock('../../auth/resolve-token.js', () => ({
  resolveToken: vi.fn(() => Promise.resolve({ type: 'pat', token: 't' })),
}));
vi.mock('../../utils/sdk-client.js', () => ({ configureClient: vi.fn() }));

import type { LocalContext } from '../../context.js';
import { NoPosixShellError } from './gate-runner.js';
import { gatesRunDeps, gatesRunHandler } from './runHandler.js';

const ISSUE_ID = '01a0d934-729d-7b5f-ac4e-f1551571453f';

function context() {
  const written: string[] = [];
  const errWritten: string[] = [];
  const ctx = {
    process: {
      stdout: { write: (s: string) => written.push(s) },
      stderr: { write: (s: string) => errWritten.push(s) },
      exitCode: undefined as number | undefined,
    },
    logger: {
      setVerbose: vi.fn(),
      error: vi.fn((m: string) => written.push(`error ${m}`)),
      info: vi.fn(),
      debug: vi.fn(),
    },
  } as unknown as LocalContext & { process: { exitCode?: number } };
  return { ctx, written, errWritten };
}

const flags = { 'dry-run': false, json: false, verbose: false };

describe('internal F — levr gates run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.issueFindAllV1.mockResolvedValue({
      data: { data: [{ id: ISSUE_ID }] },
    });
    sdk.issueGateVerificationVerifyGatesV1.mockResolvedValue({
      data: {
        deliverable: 'internal',
        status: 'pending_local',
        local_commands: [
          {
            gate_type: 'file_exists',
            command: 'yarn playwright test',
            expected: 'exit 0',
            link_id: 'link-1',
            test_name: 'E2E suite passes',
            step_id: 'step-3',
            rule_hash: 'e3.abc',
          },
        ],
        manual_tasks: [
          {
            gate_type: 'guided',
            instruction: 'Walk through the app at 375px',
            link_id: 'link-2',
            test_name: 'Manual walkthrough',
          },
        ],
      },
    });
    sdk.issueGateVerificationReportGateResultsV1.mockResolvedValue({
      data: {
        deliverable: 'internal',
        status: 'all_pass',
        gates_passing: 1,
        gates_total: 1,
        gates: [],
        receipts: [],
      },
    });
    gatesRunDeps.run = vi.fn(() => ({
      exitCode: 0,
      stdout: '  8 passed (2.0s)\n',
      stderr: '',
    }));
    gatesRunDeps.resolveShell = () => ({ file: '/bin/bash' });
  });

  // F-020 — no bash and no sh (a bare Windows box): refuse before anything
  // runs or is reported, and name what to install. Never cmd.exe.
  it('with no POSIX shell, REFUSES — nothing run, nothing reported, Git Bash / WSL named', async () => {
    const { ctx, written } = context();
    gatesRunDeps.resolveShell = () => {
      throw new NoPosixShellError('win32');
    };
    await gatesRunHandler.call(ctx, flags, ISSUE_ID);
    expect(gatesRunDeps.run).not.toHaveBeenCalled();
    expect(sdk.issueGateVerificationReportGateResultsV1).not.toHaveBeenCalled();
    expect(ctx.process.exitCode).toBe(1);
    expect(written.join('')).toMatch(/Git Bash[\s\S]*WSL/);
  });

  it('resolves an identifier, runs each command EXACTLY as given, and reports raw steps with step_id and rule_hash', async () => {
    const { ctx } = context();
    await gatesRunHandler.call(ctx, flags, 'internal');

    expect(sdk.issueFindAllV1).toHaveBeenCalledWith({
      query: { 'filter.identifier': ['$eq:internal'], limit: 1 },
    });
    expect(gatesRunDeps.run).toHaveBeenCalledWith(
      'yarn playwright test',
      expect.any(Number),
    );
    const call = sdk.issueGateVerificationReportGateResultsV1.mock
      .calls[0]![0] as ReportCall;
    expect(call.path).toEqual({ id: ISSUE_ID });
    expect(call.body.results).toEqual([
      {
        gate_type: 'file_exists',
        link_id: 'link-1',
        status: 'pass',
        output: '  8 passed (2.0s)\n',
        expected: 'exit 0',
        step_id: 'step-3',
        rule_hash: 'e3.abc',
        steps: [
          {
            command: 'yarn playwright test',
            exit_code: 0,
            stdout_tail: '  8 passed (2.0s)\n',
            stderr_tail: '',
            step_id: 'step-3',
          },
        ],
      },
    ]);
    expect(ctx.process.exitCode).toBe(0);
  });

  it('lists guided gates by their test name and never reports them', async () => {
    const { ctx, written } = context();
    await gatesRunHandler.call(ctx, flags, ISSUE_ID);
    expect(sdk.issueFindAllV1).not.toHaveBeenCalled();
    const text = written.join('');
    expect(text).toContain('Manual walkthrough: Walk through the app at 375px');
    const reported = (
      sdk.issueGateVerificationReportGateResultsV1.mock
        .calls[0]![0] as ReportCall
    ).body.results;
    expect(reported.map((r) => r['link_id'])).toEqual(['link-1']);
  });

  it('exits 1 when the server says the gates are not all passing', async () => {
    sdk.issueGateVerificationReportGateResultsV1.mockResolvedValue({
      data: {
        status: 'some_fail',
        gates: [{ status: 'fail', test_name: 'E2E suite passes', actual: 'x' }],
      },
    });
    const { ctx, written } = context();
    await gatesRunHandler.call(ctx, flags, ISSUE_ID);
    expect(ctx.process.exitCode).toBe(1);
    expect(written.join('')).toContain('FAIL E2E suite passes');
  });

  it('--dry-run lists the commands and runs NOTHING (F-008)', async () => {
    const { ctx, written } = context();
    await gatesRunHandler.call(ctx, { ...flags, 'dry-run': true }, ISSUE_ID);
    expect(gatesRunDeps.run).not.toHaveBeenCalled();
    expect(sdk.issueGateVerificationReportGateResultsV1).not.toHaveBeenCalled();
    const listing = JSON.parse(written[0]!) as {
      dry_run: boolean;
      commands: Array<Record<string, unknown>>;
    };
    expect(listing.dry_run).toBe(true);
    expect(listing.commands).toEqual([
      {
        test_name: 'E2E suite passes',
        gate_type: 'file_exists',
        link_id: 'link-1',
        command: 'yarn playwright test',
        expected: 'exit 0',
        step_id: 'step-3',
        rule_hash: 'e3.abc',
      },
    ]);
  });

  it('prints each command BEFORE it runs (F-008)', async () => {
    const { ctx, written } = context();
    const seenAtRun: string[] = [];
    gatesRunDeps.run = vi.fn(() => {
      seenAtRun.push(written.join(''));
      return { exitCode: 0, stdout: '  8 passed (2.0s)\n', stderr: '' };
    });
    await gatesRunHandler.call(ctx, flags, ISSUE_ID);
    expect(seenAtRun).toHaveLength(1);
    expect(seenAtRun[0]).toContain(
      '[1/1] E2E suite passes: yarn playwright test',
    );
  });

  it('under --json, announces commands on stderr so stdout stays one JSON document', async () => {
    const { ctx, written, errWritten } = context();
    await gatesRunHandler.call(ctx, { ...flags, json: true }, ISSUE_ID);
    expect(errWritten.join('')).toContain('yarn playwright test');
    expect(() => JSON.parse(written.join('')) as unknown).not.toThrow();
  });

  describe('no local allowlist — the server validates (R3-01, user decision 2026-09-25)', () => {
    beforeEach(() => {
      sdk.issueGateVerificationVerifyGatesV1.mockResolvedValue({
        data: {
          deliverable: 'internal',
          status: 'pending_local',
          local_commands: [
            {
              gate_type: 'shell',
              command: 'grep -c x f.ts',
              link_id: 'link-1',
              test_name: 'Harmless',
            },
            {
              gate_type: 'shell',
              command: 'bash -c \'cd apps/x && node -e "process.exit(0)"\'',
              link_id: 'link-2',
              test_name: 'Inline code',
            },
          ],
        },
      });
    });

    it('runs every command exactly as given, printing each first, and reports them all', async () => {
      const order: string[] = [];
      const { ctx, written } = context();
      gatesRunDeps.run = vi.fn((command: string) => {
        // Every line printed so far, then this run.
        order.push(
          ...written
            .filter((w) => w.startsWith('['))
            .map((w) => `print ${w.trim()}`)
            .filter((l) => !order.includes(l)),
        );
        order.push(`run ${command}`);
        return { exitCode: 0, stdout: '', stderr: '' };
      });
      await gatesRunHandler.call(ctx, flags, ISSUE_ID);
      expect(order).toEqual([
        'print [1/2] Harmless: grep -c x f.ts',
        'run grep -c x f.ts',
        `print [2/2] Inline code: bash -c 'cd apps/x && node -e "process.exit(0)"'`,
        `run bash -c 'cd apps/x && node -e "process.exit(0)"'`,
      ]);
      const call = sdk.issueGateVerificationReportGateResultsV1.mock
        .calls[0]![0] as ReportCall;
      expect(call.body.results.map((r) => r['link_id'])).toEqual([
        'link-1',
        'link-2',
      ]);
      expect(written.join('')).not.toContain('Refusing');
    });

    it('--dry-run lists every command with no refusal marker and runs nothing', async () => {
      const { ctx, written } = context();
      await gatesRunHandler.call(ctx, { ...flags, 'dry-run': true }, ISSUE_ID);
      expect(gatesRunDeps.run).not.toHaveBeenCalled();
      expect(
        sdk.issueGateVerificationReportGateResultsV1,
      ).not.toHaveBeenCalled();
      const listing = JSON.parse(written[0]!) as {
        commands: Array<Record<string, unknown>>;
      };
      expect(listing.commands.map((c) => c['command'])).toEqual([
        'grep -c x f.ts',
        `bash -c 'cd apps/x && node -e "process.exit(0)"'`,
      ]);
      for (const c of listing.commands) {
        expect(Object.keys(c)).not.toContain('refused_without_yes');
      }
    });
  });

  it('an unknown identifier is an error, not a verify of nothing', async () => {
    sdk.issueFindAllV1.mockResolvedValue({ data: { data: [] } });
    const { ctx } = context();
    await gatesRunHandler.call(ctx, flags, 'internal');
    expect(ctx.process.exitCode).toBe(1);
    expect(sdk.issueGateVerificationVerifyGatesV1).not.toHaveBeenCalled();
  });

  // internal review R5 M3 — a required dead gate means the deliverable
  // cannot pass: the command names it and exits 1 even when the (older)
  // server's report summary says all_pass.
  it('a required DEAD gate from verify is printed with its remedy, and the run exits 1 even on an all_pass report', async () => {
    const { ctx, written } = context();
    const verified: unknown = await sdk.issueGateVerificationVerifyGatesV1();
    sdk.issueGateVerificationVerifyGatesV1.mockResolvedValue({
      data: {
        ...(verified as { data: Record<string, unknown> }).data,
        dead_gates: [
          {
            link_id: 'link-dead',
            test_name: 'Dead',
            reason: 'test_deleted',
            required: true,
            remedy: 'Restore it by redeploying "Dead" with deploy_gates.',
          },
        ],
      },
    });
    await gatesRunHandler.call(ctx, flags, ISSUE_ID);
    expect(written.join('')).toContain('DEAD "Dead"');
    expect(written.join('')).toContain('deploy_gates');
    expect(ctx.process.exitCode).toBe(1);
  });

  it('an ADVISORY dead gate does not fail an all_pass run', async () => {
    const { ctx } = context();
    sdk.issueGateVerificationReportGateResultsV1.mockResolvedValue({
      data: {
        deliverable: 'internal',
        status: 'all_pass',
        gates_passing: 1,
        gates_total: 1,
        gates: [],
        receipts: [],
        dead_gates: [
          { link_id: 'link-dead', test_name: 'Old', required: false },
        ],
      },
    });
    await gatesRunHandler.call(ctx, flags, ISSUE_ID);
    expect(ctx.process.exitCode).toBe(0);
  });
});
