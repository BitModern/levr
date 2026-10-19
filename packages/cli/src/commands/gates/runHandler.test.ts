import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const flags = { 'dry-run': false, json: false, verbose: false, ci: false };

describe('internal F — levr gates run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.issueFindAllV1.mockResolvedValue({
      data: { data: [{ id: ISSUE_ID, workspace_id: 'ws-1' }] },
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
        runs: 'shell',
        expected: 'exit 0',
        step_id: 'step-3',
        rule_hash: 'e3.abc',
      },
    ]);
  });

  it('--ci declares CI and omits the OIDC header when Actions did not mint a token', async () => {
    const prevUrl = process.env['ACTIONS_ID_TOKEN_REQUEST_URL'];
    const prevToken = process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'];
    delete process.env['ACTIONS_ID_TOKEN_REQUEST_URL'];
    delete process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'];
    try {
      const { ctx } = context();
      await gatesRunHandler.call(ctx, { ...flags, ci: true }, ISSUE_ID);
      expect(sdk.client.setConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: { 'X-Levr-CI-Declared': '1' },
        }),
      );
      const headers = sdk.client.setConfig.mock.calls[0]?.[0] as {
        headers?: Record<string, string>;
      };
      expect(headers.headers?.['X-Levr-CI-OIDC']).toBeUndefined();
    } finally {
      if (prevUrl === undefined) {
        delete process.env['ACTIONS_ID_TOKEN_REQUEST_URL'];
      } else {
        process.env['ACTIONS_ID_TOKEN_REQUEST_URL'] = prevUrl;
      }
      if (prevToken === undefined) {
        delete process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'];
      } else {
        process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'] = prevToken;
      }
    }
  });

  it('--ci mints a fresh workspace-bound token before verify AND before report, and sends the commit (review H7)', async () => {
    const saved = {
      url: process.env['ACTIONS_ID_TOKEN_REQUEST_URL'],
      token: process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'],
      sha: process.env['GITHUB_SHA'],
    };
    process.env['ACTIONS_ID_TOKEN_REQUEST_URL'] = 'https://actions.test/token';
    process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'] = 'req';
    process.env['GITHUB_SHA'] = 'c'.repeat(40);
    let minted = 0;
    const audiences: Array<string | null> = [];
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input) => {
        const url = input instanceof URL ? input : new URL(input as string);
        audiences.push(url.searchParams.get('audience'));
        minted++;
        return Promise.resolve(
          new Response(JSON.stringify({ value: `tok-${minted}` })),
        );
      });
    // The OIDC header in force when each SDK call is made.
    const oidcAt: string[] = [];
    let lastHeaders: Record<string, string> = {};
    sdk.client.setConfig.mockImplementation(
      (cfg: { headers?: Record<string, string> }) => {
        if (cfg.headers) lastHeaders = cfg.headers;
      },
    );
    sdk.issueGateVerificationVerifyGatesV1.mockImplementationOnce(
      (opts: unknown) => {
        oidcAt.push(lastHeaders['X-Levr-CI-OIDC'] ?? '');
        verifyOpts = opts;
        return Promise.resolve({
          data: {
            deliverable: 'internal',
            local_commands: [
              { gate_type: 'file_exists', command: 'true', link_id: 'link-1' },
            ],
          },
        });
      },
    );
    let verifyOpts: unknown;
    sdk.issueGateVerificationReportGateResultsV1.mockImplementationOnce(
      (opts: unknown) => {
        oidcAt.push(lastHeaders['X-Levr-CI-OIDC'] ?? '');
        reportOpts = opts as ReportCall;
        return Promise.resolve({ data: { status: 'all_pass' } });
      },
    );
    let reportOpts: ReportCall | undefined;
    gatesRunDeps.run = vi.fn(() => ({ exitCode: 0, stdout: '', stderr: '' }));
    try {
      const { ctx } = context();
      await gatesRunHandler.call(ctx, { ...flags, ci: true }, ISSUE_ID);
      expect(audiences).toEqual(['levr:ws-1', 'levr:ws-1']);
      expect(oidcAt).toEqual(['tok-1', 'tok-2']);
      expect((verifyOpts as { body?: unknown }).body).toEqual({
        commit_sha: 'c'.repeat(40),
      });
      expect(
        (reportOpts?.body as unknown as { commit_sha?: string }).commit_sha,
      ).toBe('c'.repeat(40));
    } finally {
      fetchSpy.mockRestore();
      sdk.client.setConfig.mockReset();
      for (const [key, value] of [
        ['ACTIONS_ID_TOKEN_REQUEST_URL', saved.url],
        ['ACTIONS_ID_TOKEN_REQUEST_TOKEN', saved.token],
        ['GITHUB_SHA', saved.sha],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
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

describe('internal review C1 — inspect ops run in process', () => {
  const inspectOp = {
    op: 'inspect',
    check: 'contains',
    params: { path: 'note.txt', pattern: 'alpha' },
  };
  const display = `npx '@levr-one/cli@0.10.0' gates inspect '${JSON.stringify(inspectOp)}'`;
  let root = '';

  beforeEach(async () => {
    vi.clearAllMocks();
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-run-inspect-'));
    fs.writeFileSync(path.join(root, 'note.txt'), 'alpha\n');
    const { executeInspect } = await import('./inspect.js');
    gatesRunDeps.inspect = vi.fn((json: string) => executeInspect(json, root));
    gatesRunDeps.run = vi.fn(() => ({ exitCode: 251, stdout: '', stderr: '' }));
    // No shell at all: an all-inspect run must not need one.
    gatesRunDeps.resolveShell = () => {
      throw new NoPosixShellError('win32');
    };
    sdk.issueGateVerificationReportGateResultsV1.mockResolvedValue({
      data: { status: 'all_pass', gates: [], receipts: [] },
    });
  });

  afterEach(async () => {
    const fs = await import('node:fs');
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it('--dry-run shows where each command runs and its approval, and runs nothing', async () => {
    sdk.issueGateVerificationVerifyGatesV1.mockResolvedValue({
      data: {
        status: 'pending_local',
        local_commands: [
          {
            gate_type: 'file_contains',
            link_id: 'link-9',
            command: display,
            op: {
              contract_version: 1,
              op: inspectOp,
              approval: 'server_approved',
              approval_basis: 'kind',
            },
          },
          {
            gate_type: 'typecheck',
            link_id: 'link-10',
            command: "cd 'apps/web' && 'test' '-f' 'tsconfig.json'",
            op: {
              contract_version: 1,
              op: {
                op: 'argv',
                cwd: 'apps/web',
                argv: ['test', '-f', 'tsconfig.json'],
              },
              approval: 'confirm',
            },
          },
          // An older server: no envelope, so no approval is claimed.
          { gate_type: 'shell', link_id: 'link-11', command: 'true' },
        ],
      },
    });
    const { ctx, written } = context();
    await gatesRunHandler.call(ctx, { ...flags, 'dry-run': true }, ISSUE_ID);
    expect(gatesRunDeps.run).not.toHaveBeenCalled();
    expect(gatesRunDeps.inspect).not.toHaveBeenCalled();
    expect(sdk.issueGateVerificationReportGateResultsV1).not.toHaveBeenCalled();
    const listing = JSON.parse(written[0]!) as {
      commands: Array<Record<string, unknown>>;
    };
    expect(
      listing.commands.map((c) => [
        c['link_id'],
        c['runs'],
        c['approval'],
        c['approval_basis'],
      ]),
    ).toEqual([
      ['link-9', 'in-process', 'server_approved', 'kind'],
      ['link-10', 'shell', 'confirm', undefined],
      ['link-11', 'shell', undefined, undefined],
    ]);
  });

  it.each([
    [
      'the op envelope',
      { op: { contract_version: 1, op: inspectOp }, command: display },
    ],
    ['the display string alone (older server)', { command: display }],
  ])(
    'from %s: never spawns npx, reports the issued command with the in-process result',
    async (_label, shape) => {
      sdk.issueGateVerificationVerifyGatesV1.mockResolvedValue({
        data: {
          status: 'pending_local',
          local_commands: [
            { gate_type: 'file_contains', link_id: 'link-9', ...shape },
          ],
        },
      });
      const { ctx } = context();
      await gatesRunHandler.call(ctx, flags, ISSUE_ID);
      expect(gatesRunDeps.run).not.toHaveBeenCalled();
      expect(gatesRunDeps.inspect).toHaveBeenCalledWith(
        JSON.stringify(inspectOp),
      );
      const call = sdk.issueGateVerificationReportGateResultsV1.mock
        .calls[0]![0] as ReportCall;
      const step = (
        call.body.results[0]!['steps'] as Array<Record<string, unknown>>
      )[0]!;
      expect(step['command']).toBe(display);
      expect(step['exit_code']).toBe(0);
      expect(step['stdout_tail']).toBe('1\n');
      expect(ctx.process.exitCode).toBe(0);
    },
  );
});
