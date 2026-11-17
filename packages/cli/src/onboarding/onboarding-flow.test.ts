/**
 * Bare `levr` runs the onboarding wizard (internal, plan internal D9).
 *
 * The wizard is driven through injected deps: the prompts are scripted
 * answers and every step (sign-in, workspace, MCP, gates setup) is a fake
 * that records it was called, so nothing touches a terminal, the network or
 * a real client config.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FIRST_TASK_PROMPT_PREFIX,
  FIRST_TASK_TODO_PROMPT,
} from '@levr/shared';
import {
  browserInstallPlan,
  FIRST_TASK_PROMPT,
  EXIT_CANCELLED,
  runOnboarding,
  type OnboardingDeps,
  type OnboardingPrompts,
  type StepResult,
} from './onboarding-flow.js';
import { shouldRunOnboarding } from './interactive.js';

const CANCEL = Symbol('clack:cancel');

interface Scripted {
  /** Answers handed out in order to confirm/select calls. */
  answers: unknown[];
}

interface Recorder {
  prompts: OnboardingPrompts;
  /** Every line printed, in order, tagged with how it was printed. */
  lines: string[];
  /** The message of each confirm/select call, in order. */
  asked: string[];
  outro: string[];
  cancelled: string[];
}

function recorder(script: Scripted): Recorder {
  const lines: string[] = [];
  const asked: string[] = [];
  const outro: string[] = [];
  const cancelled: string[] = [];
  const next = (): unknown => {
    if (script.answers.length === 0) {
      throw new Error('prompt asked with no scripted answer');
    }
    return script.answers.shift();
  };
  const prompts: OnboardingPrompts = {
    intro: (m) => lines.push(`intro:${m}`),
    outro: (m) => {
      outro.push(m);
      lines.push(`outro:${m}`);
    },
    cancel: (m) => {
      cancelled.push(m);
      lines.push(`cancel:${m}`);
    },
    note: (m, title) => lines.push(`note:${title ?? ''}:${m}`),
    info: (m) => lines.push(`info:${m}`),
    success: (m) => lines.push(`success:${m}`),
    error: (m) => lines.push(`error:${m}`),
    confirm: (o) => {
      asked.push(o.message);
      return Promise.resolve(next() as boolean | symbol);
    },
    select: <T extends string>(o: { message: string }) => {
      asked.push(o.message);
      return Promise.resolve(next() as T | symbol);
    },
    isCancel: (v: unknown): v is symbol => v === CANCEL,
  };
  return { prompts, lines, asked, outro, cancelled };
}

interface FakeState {
  signedIn: boolean;
  workspaces: { id: string; name: string }[];
  pinned: string | null;
  levrClients: string[];
  otherClients: string[];
  /** What gates setup would still offer; null = cannot tell (asks). */
  gatesStatus: { missing: string[]; anyConfigured: boolean } | null;
  /** Clients with a levr-browser entry; null = every client has one. */
  browserClients: string[] | null;
  inRepo: boolean;
  calls: string[];
  mcpResult: () => Promise<StepResult>;
  /** A harness config file the fake MCP step writes to. */
  harnessConfig: string;
}

function fakeDeps(
  prompts: OnboardingPrompts,
  overrides: Partial<FakeState> = {},
): { deps: OnboardingDeps; state: FakeState } {
  const dir = mkdtempSync(join(tmpdir(), 'levr-onboarding-'));
  const harnessConfig = join(dir, 'mcp.json');
  writeFileSync(harnessConfig, '{\n  "mcpServers": {}\n}\n');
  const state: FakeState = {
    signedIn: false,
    workspaces: [
      { id: 'ws-1', name: 'Acme' },
      { id: 'ws-2', name: 'Beta' },
    ],
    pinned: null,
    levrClients: [],
    otherClients: ['Claude Code'],
    browserClients: null,
    gatesStatus: null,
    inRepo: true,
    calls: [],
    mcpResult: () => {
      writeFileSync(
        harnessConfig,
        '{\n  "mcpServers": { "levr": { "url": "x" } }\n}\n',
      );
      state.levrClients = ['Claude Code'];
      return Promise.resolve('ok');
    },
    harnessConfig,
    ...overrides,
  };
  const deps: OnboardingDeps = {
    prompts,
    hasValidCredentials: () => {
      state.calls.push('credentials');
      return Promise.resolve(state.signedIn);
    },
    signIn: (mode) => {
      state.calls.push(`signIn:${mode}`);
      state.signedIn = true;
      return Promise.resolve('ok');
    },
    listWorkspaces: () => {
      state.calls.push('listWorkspaces');
      return Promise.resolve(state.workspaces);
    },
    pinnedWorkspace: () => state.pinned,
    pinWorkspace: (id) => {
      state.calls.push(`pin:${id}`);
      state.pinned = id;
    },
    mcpClients: () => {
      const hasBrowser = (label: string) =>
        state.browserClients === null || state.browserClients.includes(label);
      return [
        ...state.levrClients.map((label) => ({
          label,
          hasLevr: true,
          hasBrowser: hasBrowser(label),
        })),
        ...state.otherClients
          .filter((l) => !state.levrClients.includes(l))
          .map((label) => ({
            label,
            hasLevr: false,
            hasBrowser: hasBrowser(label),
          })),
      ];
    },
    addMcp: () => {
      state.calls.push('addMcp');
      return state.mcpResult();
    },
    addBrowserMcp: () => {
      state.calls.push('addBrowserMcp');
      state.browserClients = [
        ...(state.browserClients ?? []),
        ...state.levrClients,
        ...state.otherClients,
      ];
      return Promise.resolve('ok');
    },
    inRepo: () => {
      state.calls.push('inRepo');
      return Promise.resolve(state.inRepo);
    },
    gatesStatus: () => Promise.resolve(state.gatesStatus),
    gatesSetup: () => {
      state.calls.push('gatesSetup');
      return Promise.resolve('ok');
    },
  };
  return { deps, state };
}

describe('shouldRunOnboarding (bare levr entry)', () => {
  const tty = { stdinIsTTY: true, stdoutIsTTY: true };

  it('runs the wizard for a bare levr in a terminal', () => {
    expect(shouldRunOnboarding({ argv: [], env: {}, ...tty })).toBe(true);
  });

  it('a non-TTY levr prints help: no wizard, so no prompt is ever made', () => {
    expect(
      shouldRunOnboarding({
        argv: [],
        env: {},
        stdinIsTTY: false,
        stdoutIsTTY: true,
      }),
    ).toBe(false);
    expect(
      shouldRunOnboarding({
        argv: [],
        env: {},
        stdinIsTTY: true,
        stdoutIsTTY: undefined,
      }),
    ).toBe(false);
  });

  it('CI=true levr prints help', () => {
    expect(shouldRunOnboarding({ argv: [], env: { CI: 'true' }, ...tty })).toBe(
      false,
    );
    expect(shouldRunOnboarding({ argv: [], env: { CI: '1' }, ...tty })).toBe(
      false,
    );
  });

  it('CI_TOKEN alone does NOT disable prompts (only the exact CI variable)', () => {
    expect(
      shouldRunOnboarding({ argv: [], env: { CI_TOKEN: 'abc' }, ...tty }),
    ).toBe(true);
    expect(
      shouldRunOnboarding({ argv: [], env: { CI_PIPELINE_ID: '7' }, ...tty }),
    ).toBe(true);
  });

  it('CI=false still runs the wizard', () => {
    expect(
      shouldRunOnboarding({ argv: [], env: { CI: 'false' }, ...tty }),
    ).toBe(true);
  });

  it('LEVR_NO_PROMPT and --non-interactive print help', () => {
    expect(
      shouldRunOnboarding({ argv: [], env: { LEVR_NO_PROMPT: '1' }, ...tty }),
    ).toBe(false);
    expect(
      shouldRunOnboarding({ argv: ['--non-interactive'], env: {}, ...tty }),
    ).toBe(false);
  });

  it('--help and every subcommand are left to Stricli', () => {
    for (const argv of [
      ['--help'],
      ['-h'],
      ['auth', 'login'],
      ['mcp', 'add'],
    ]) {
      expect(shouldRunOnboarding({ argv, env: {}, ...tty })).toBe(false);
    }
  });
});

describe('runOnboarding', () => {
  it('the first-task prompt is the shared framing', () => {
    expect(FIRST_TASK_PROMPT.startsWith(FIRST_TASK_PROMPT_PREFIX)).toBe(true);
    // The first-run task is the web app's starter task, word for word.
    expect(FIRST_TASK_PROMPT).toBe(FIRST_TASK_TODO_PROMPT);
    expect(FIRST_TASK_PROMPT).not.toContain('<describe your feature>');
  });

  it('with no credentials, no MCP entry, inside a repo, offers every step in order', async () => {
    const r = recorder({
      answers: ['signup', 'ws-2', true, true],
    });
    const { deps, state } = fakeDeps(r.prompts);

    const code = await runOnboarding(deps);

    expect(code).toBe(0);
    expect(state.calls).toEqual([
      'credentials',
      'signIn:signup',
      'listWorkspaces',
      'pin:ws-2',
      'addMcp',
      'inRepo',
      'gatesSetup',
    ]);
    expect(r.asked).toHaveLength(4);
    const all = r.lines.join('\n');
    // Welcome first; gates setup is asked before the first task is shown.
    expect(r.lines[0]).toMatch(/^intro:/);
    expect(all).toContain('levr --help');
    const firstTask = r.lines.findIndex((l) => l.includes(FIRST_TASK_PROMPT));
    expect(firstTask).toBeGreaterThan(-1);
    expect(r.lines[firstTask]).toContain(
      'open Claude Code in an empty folder and paste this',
    );
    expect(r.asked[3]).toContain('levr gates setup');
    expect(r.outro).toHaveLength(1);
    expect(all).not.toMatch(/come back to|return to the CLI/);
  });

  it('already signed in, MCP present and outside a repo: only the first task and the cd message', async () => {
    const r = recorder({ answers: [] });
    const { deps, state } = fakeDeps(r.prompts, {
      signedIn: true,
      pinned: 'ws-1',
      levrClients: ['Cursor'],
      otherClients: [],
      inRepo: false,
    });

    const code = await runOnboarding(deps);

    expect(code).toBe(0);
    expect(r.asked).toEqual([]);
    expect(state.calls).not.toContain('addMcp');
    expect(state.calls).not.toContain('gatesSetup');
    expect(state.calls.some((c) => c.startsWith('signIn'))).toBe(false);
    const all = r.lines.join('\n');
    expect(all).toContain(FIRST_TASK_PROMPT);
    expect(all).toContain('open Cursor in an empty folder and paste this');
    expect(all).toContain(
      'cd into one of your repos and run `levr gates setup`',
    );
    // Gates guidance comes before the first task, which is last.
    const gatesLine = r.lines.findIndex((l) =>
      l.includes('cd into one of your repos'),
    );
    const taskLine = r.lines.findIndex((l) => l.includes(FIRST_TASK_PROMPT));
    expect(gatesLine).toBeGreaterThan(-1);
    expect(taskLine).toBeGreaterThan(gatesLine);
  });

  it('a missing levr-browser entry is offered after the levr MCP step, and added on yes', async () => {
    const r = recorder({ answers: [true] });
    const { deps, state } = fakeDeps(r.prompts, {
      signedIn: true,
      pinned: 'ws-1',
      levrClients: ['Claude Code'],
      otherClients: [],
      browserClients: [],
      inRepo: false,
    });

    const code = await runOnboarding(deps);

    expect(code).toBe(0);
    expect(r.asked).toHaveLength(1);
    expect(r.asked[0]).toContain('Levr Browser MCP server (levr-browser)');
    expect(state.calls).toContain('addBrowserMcp');
    expect(state.calls).not.toContain('addMcp');
    const all = r.lines.join('\n');
    expect(all).toContain('Levr MCP is set up already in Claude Code.');
    // Offered before the first-task prompt.
    expect(state.calls.indexOf('addBrowserMcp')).toBeGreaterThan(-1);
    expect(all.indexOf(FIRST_TASK_PROMPT)).toBeGreaterThan(-1);
  });

  it('an existing levr-browser entry is reported, not offered', async () => {
    const r = recorder({ answers: [] });
    const { deps, state } = fakeDeps(r.prompts, {
      signedIn: true,
      pinned: 'ws-1',
      levrClients: ['Claude Code'],
      otherClients: [],
      browserClients: ['Claude Code'],
      inRepo: false,
    });

    const code = await runOnboarding(deps);

    expect(code).toBe(0);
    expect(r.asked).toEqual([]);
    expect(state.calls).not.toContain('addBrowserMcp');
    expect(r.lines.join('\n')).toContain(
      'Levr Browser MCP is set up already in Claude Code.',
    );
  });

  it('declining levr-browser prints its retry command and carries on', async () => {
    const r = recorder({ answers: [false] });
    const { deps, state } = fakeDeps(r.prompts, {
      signedIn: true,
      pinned: 'ws-1',
      levrClients: ['Claude Code'],
      otherClients: [],
      browserClients: [],
      inRepo: false,
    });

    const code = await runOnboarding(deps);

    expect(code).toBe(0);
    expect(state.calls).not.toContain('addBrowserMcp');
    const all = r.lines.join('\n');
    expect(all).toContain('levr mcp add --name levr-browser');
    expect(all).toContain(FIRST_TASK_PROMPT);
  });

  it('a repository already set up is reported, not asked again', async () => {
    const r = recorder({ answers: [] });
    const { deps, state } = fakeDeps(r.prompts, {
      signedIn: true,
      pinned: 'ws-1',
      levrClients: ['Claude Code'],
      otherClients: [],
      gatesStatus: { missing: [], anyConfigured: true },
    });

    const code = await runOnboarding(deps);

    expect(code).toBe(0);
    expect(r.asked).toEqual([]);
    expect(state.calls).not.toContain('gatesSetup');
    expect(r.lines.join('\n')).toContain(
      'Gates are set up for this repository already.',
    );
  });

  it('a partly set-up repository names what is missing, and Enter does not rerun setup', async () => {
    const r = recorder({ answers: [false] });
    let initial: boolean | undefined;
    const confirm = r.prompts.confirm.bind(r.prompts);
    r.prompts.confirm = (o) => {
      initial = o.initialValue;
      return confirm(o);
    };
    const { deps, state } = fakeDeps(r.prompts, {
      signedIn: true,
      pinned: 'ws-1',
      levrClients: ['Claude Code'],
      otherClients: [],
      gatesStatus: { missing: ['AST pattern'], anyConfigured: true },
    });

    const code = await runOnboarding(deps);

    expect(code).toBe(0);
    expect(r.asked[0]).toContain('Not configured yet: AST pattern.');
    expect(initial).toBe(false);
    expect(state.calls).not.toContain('gatesSetup');
  });

  it('cancelling at the workspace prompt exits 130 and writes no MCP entry', async () => {
    const r = recorder({ answers: ['login', CANCEL] });
    const { deps, state } = fakeDeps(r.prompts);
    const before = readFileSync(state.harnessConfig, 'utf8');

    const code = await runOnboarding(deps);

    expect(code).toBe(EXIT_CANCELLED);
    expect(code).toBe(130);
    expect(state.calls).not.toContain('addMcp');
    expect(state.calls.some((c) => c.startsWith('pin:'))).toBe(false);
    expect(readFileSync(state.harnessConfig, 'utf8')).toBe(before);
    expect(r.cancelled).toEqual(['Setup cancelled']);
    expect(r.outro).toEqual([]);
  });

  it('cancel exits 130 and writes nothing after the cancelled step', async () => {
    // Signed in, one workspace: the first prompt is the MCP confirm.
    const r = recorder({ answers: [CANCEL] });
    const { deps, state } = fakeDeps(r.prompts, {
      signedIn: true,
      workspaces: [{ id: 'ws-1', name: 'Acme' }],
    });
    const before = readFileSync(state.harnessConfig);

    const code = await runOnboarding(deps);

    expect(code).toBe(130);
    expect(r.asked).toHaveLength(1);
    expect(state.calls).not.toContain('addMcp');
    expect(state.calls).not.toContain('inRepo');
    expect(state.calls).not.toContain('gatesSetup');
    expect(readFileSync(state.harnessConfig).equals(before)).toBe(true);
    expect(r.cancelled).toEqual(['Setup cancelled']);
    expect(r.outro).toEqual([]);
    expect(r.lines.join('\n')).not.toContain(FIRST_TASK_PROMPT);
  });

  it('a cancel inside a reused step ends the wizard with 130', async () => {
    const r = recorder({ answers: ['signup'] });
    const { deps, state } = fakeDeps(r.prompts);
    deps.signIn = () => Promise.resolve('cancelled');

    const code = await runOnboarding(deps);

    expect(code).toBe(130);
    expect(state.calls).not.toContain('listWorkspaces');
    expect(r.outro).toEqual([]);
  });

  it('a failing step prints its retry command and continues', async () => {
    const r = recorder({ answers: [true, true] });
    const { deps, state } = fakeDeps(r.prompts, {
      signedIn: true,
      workspaces: [{ id: 'ws-1', name: 'Acme' }],
      mcpResult: () => Promise.reject(new Error('fetch failed: ECONNRESET')),
    });
    const before = readFileSync(state.harnessConfig, 'utf8');

    const code = await runOnboarding(deps);

    expect(code).toBe(0);
    const errors = r.lines.filter((l) => l.startsWith('error:'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('ECONNRESET');
    expect(errors[0]).toContain('levr mcp add');
    // The wizard still reached the first-task step and gates setup.
    expect(r.lines.join('\n')).toContain(FIRST_TASK_PROMPT);
    expect(state.calls).toContain('gatesSetup');
    expect(readFileSync(state.harnessConfig, 'utf8')).toBe(before);
    expect(r.outro).toHaveLength(1);
  });

  it('a failed sign-in prints levr auth login and still offers MCP setup', async () => {
    const r = recorder({ answers: ['login', false] });
    const { deps, state } = fakeDeps(r.prompts, { inRepo: false });
    deps.signIn = () => Promise.resolve('failed');

    const code = await runOnboarding(deps);

    expect(code).toBe(0);
    const errors = r.lines.filter((l) => l.startsWith('error:'));
    expect(errors.join('\n')).toContain('levr auth login');
    // No session: the workspace step needs one, so it is not attempted.
    expect(state.calls).not.toContain('listWorkspaces');
    expect(r.asked[1]).toMatch(/MCP/);
  });

  it('a failing gates setup prints levr gates setup as the retry', async () => {
    const r = recorder({ answers: [true] });
    const { deps } = fakeDeps(r.prompts, {
      signedIn: true,
      pinned: 'ws-1',
      levrClients: ['Claude Code'],
    });
    deps.gatesSetup = () => Promise.resolve('failed');

    const code = await runOnboarding(deps);

    expect(code).toBe(0);
    const errors = r.lines.filter((l) => l.startsWith('error:'));
    expect(errors.join('\n')).toContain('levr gates setup');
  });

  it('a stale pinned workspace is asked again', async () => {
    const r = recorder({ answers: ['ws-1'] });
    const { deps, state } = fakeDeps(r.prompts, {
      signedIn: true,
      pinned: 'gone',
      levrClients: ['Claude Code'],
      inRepo: false,
    });

    await runOnboarding(deps);

    expect(state.calls).toContain('pin:ws-1');
  });
});

describe('browserInstallPlan (levr-browser goes where levr is)', () => {
  const scope = (s: string, configured: boolean) =>
    ({ scope: s, alreadyConfigured: configured }) as never;

  it('the same clients at the same scopes, grouped by scope', () => {
    expect(
      browserInstallPlan([
        {
          id: 'claude-code',
          installed: true,
          scopes: [scope('user', false), scope('project', true)],
        },
        { id: 'cursor', installed: true, scopes: [scope('project', true)] },
        { id: 'codex', installed: true, scopes: [scope('user', true)] },
        { id: 'zed', installed: true, scopes: [scope('user', false)] },
      ]),
    ).toEqual([
      { scope: 'project', clients: ['claude-code', 'cursor'] },
      { scope: 'user', clients: ['codex'] },
    ]);
  });

  it('a client that is not installed, or no levr anywhere: nothing, so the installer asks', () => {
    expect(
      browserInstallPlan([
        { id: 'cursor', installed: false, scopes: [scope('user', true)] },
        { id: 'claude-code', installed: true, scopes: [scope('user', false)] },
      ]),
    ).toEqual([]);
  });
});
