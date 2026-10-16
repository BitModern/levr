/**
 * `levr mcp add` tool pre-approval with disclosure (internal, plan internal
 * §D9): opt-in, default No, nothing written without consent, and the exact
 * file and entries printed before any write.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DetectedHarness,
  HarnessDef,
  HarnessScope,
  InstallResult,
  PreapproveOptions,
  PreapproveResult,
} from '@levr/mcp-harnesses/node';
import type { LocalContext } from '../../context.js';

const { mockDetectSync, mockInstall, mockPreapprove, prompts, events } =
  vi.hoisted(() => {
    const events: string[] = [];
    return {
      events,
      mockDetectSync: vi.fn<() => DetectedHarness[]>(),
      mockInstall:
        vi.fn<(h: HarnessDef, url: string, opts: unknown) => InstallResult>(),
      mockPreapprove:
        vi.fn<
          (
            h: HarnessDef,
            scope: HarnessScope,
            serverName: string,
            opts?: PreapproveOptions,
          ) => PreapproveResult
        >(),
      prompts: {
        intro: vi.fn(),
        outro: vi.fn(),
        note: vi.fn(),
        cancel: vi.fn(),
        isCancel: vi.fn((_value?: unknown): boolean => false),
        select: vi.fn(),
        multiselect: vi.fn(),
        spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
        // Simulates the user pressing Enter: the prompt's own default wins.
        confirm: vi.fn((opts: { initialValue?: boolean }) =>
          Promise.resolve(opts.initialValue ?? false),
        ),
      },
    };
  });

vi.mock('@levr/mcp-harnesses/node', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@levr/mcp-harnesses/node')>();
  return {
    ...actual,
    detectSync: mockDetectSync,
    installHarnessSync: mockInstall,
    preapproveTools: mockPreapprove,
  };
});

vi.mock('@clack/prompts', () => prompts);

vi.mock('../../auth/credentials.js', () => ({
  readCredentials: vi.fn(() => null),
}));

import { buildPreapproveDisclosure, mcpAddHandler } from './addHandler.js';

const FILE = '/home/me/.claude/settings.json';
const TOOLS = ['get_context', 'get_issue', 'add_issue_comment'] as const;

function det(id: string): DetectedHarness {
  return {
    id,
    label: id,
    installed: true,
    alreadyConfigured: false,
    configPath: `/fake/${id}.json`,
    available: true,
    scopes: [
      {
        scope: 'user',
        installKind: 'config-file',
        configPath: `/fake/${id}.json`,
        available: true,
        alreadyConfigured: false,
      },
    ],
  };
}

function installed(): InstallResult {
  return {
    ok: true,
    wrote: true,
    path: '/fake/x.json',
    alreadyConfigured: false,
    dryRun: false,
    scope: 'user',
  };
}

const CANCEL = Symbol('clack:cancel');

function plan(dryRun: boolean): PreapproveResult {
  const addedEntries = TOOLS.map((tool) => ({
    tool,
    entry: `mcp__levr__${tool}`,
  }));
  return {
    ok: true,
    file: FILE,
    added: addedEntries.map((e) => e.entry),
    addedEntries,
    alreadyPresent: [],
    conflicting: [],
    wrote: !dryRun,
    dryRun,
    keyPath: 'permissions.allow',
    scope: 'user',
    fileExists: true,
  };
}

function createMockContext(): LocalContext & {
  stdout: string[];
  stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    process: {
      stdout: {
        write: vi.fn((s: string) => {
          stdout.push(s);
          events.push(`stdout:${s}`);
          return true;
        }),
      },
      stderr: {
        write: vi.fn((s: string) => {
          stderr.push(s);
          events.push(`stderr:${s}`);
          return true;
        }),
      },
      exitCode: 0,
    },
    logger: {
      error: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      debug: vi.fn(),
      setVerbose: vi.fn(),
    },
    stdout,
    stderr,
  } as unknown as LocalContext & { stdout: string[]; stderr: string[] };
}

const writes = () =>
  mockPreapprove.mock.calls.filter(([, , , opts]) => opts?.dryRun === false);

const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  vi.clearAllMocks();
  events.length = 0;
  mockDetectSync.mockReturnValue([det('claude-code')]);
  mockInstall.mockReturnValue(installed());
  mockPreapprove.mockImplementation((_h, _s, _n, opts) => {
    events.push(`preapprove:dryRun=${String(opts?.dryRun)}`);
    return plan(opts?.dryRun ?? false);
  });
  prompts.multiselect.mockResolvedValue(['claude-code']);
});

afterEach(() => {
  process.stdout.isTTY = originalIsTTY;
});

describe('mcp add: tool pre-approval', () => {
  it('defaults to no in interactive mode', async () => {
    process.stdout.isTTY = true;
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, {
      all: false,
      yes: false,
      'dry-run': false,
      'preapprove-tools': false,
    });

    expect(prompts.multiselect).toHaveBeenCalled();
    expect(prompts.confirm).toHaveBeenCalledTimes(1);
    const [question] = prompts.confirm.mock.calls[0] ?? [];
    expect(question).toMatchObject({
      message: 'Add these permissions? (y/N)',
      initialValue: false,
    });
    // The user pressed Enter: nothing was written.
    expect(writes()).toHaveLength(0);
    expect(ctx.stdout.join('')).toContain('permissions not added');
  });

  it('writes after an explicit yes in interactive mode', async () => {
    process.stdout.isTTY = true;
    prompts.confirm.mockResolvedValueOnce(true);
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, {
      all: false,
      yes: false,
      'dry-run': false,
      'preapprove-tools': false,
    });
    expect(writes()).toHaveLength(1);
    expect(ctx.stdout.join('')).toContain(
      `added 3 permission entries to ${FILE}`,
    );
  });

  it('writes nothing non-interactively without the flag', async () => {
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, {
      all: false,
      yes: true,
      'dry-run': false,
      'preapprove-tools': false,
      client: ['claude-code'],
    });

    expect(mockInstall).toHaveBeenCalledTimes(1);
    expect(writes()).toHaveLength(0);
    expect(prompts.confirm).not.toHaveBeenCalled();
    expect(ctx.stdout.join('')).toContain('--preapprove-tools');
    expect(ctx.process.exitCode).toBe(0);
  });

  it('prints the file path and every entry before writing', async () => {
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, {
      all: false,
      yes: true,
      'dry-run': false,
      'preapprove-tools': true,
      client: ['claude-code'],
    });

    expect(writes()).toHaveLength(1);
    const disclosure = ctx.stderr.join('');
    expect(disclosure).toContain(FILE);
    for (const tool of TOOLS) {
      expect(disclosure).toContain(`mcp__levr__${tool}`);
    }
    expect(disclosure).toContain('get_issue: reads one task');
    expect(disclosure).toContain('None of them can delete anything');
    // Code review F-027: the promise covers changing or loosening a check,
    // and the one tool that can waive one says so.
    expect(disclosure).toContain('deploy_gates can change or withdraw');
    expect(disclosure).toContain('transition_issue can waive a failing');
    expect(disclosure).toContain('To undo');

    // Ordering: the disclosure reached stderr BEFORE the real write.
    const disclosed = events.findIndex(
      (e) => e.startsWith('stderr:') && e.includes(FILE),
    );
    const wrote = events.indexOf('preapprove:dryRun=false');
    expect(disclosed).toBeGreaterThanOrEqual(0);
    expect(wrote).toBeGreaterThan(disclosed);
  });

  it('--dry-run prints the disclosure and writes nothing', async () => {
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, {
      all: false,
      yes: true,
      'dry-run': true,
      'preapprove-tools': true,
      client: ['claude-code'],
    });
    expect(writes()).toHaveLength(0);
    const out = ctx.stdout.join('');
    expect(out).toContain(FILE);
    expect(out).toContain('nothing written');
  });

  it('reports "permissions not added" and exits 1 when an explicit --preapprove-tools write fails', async () => {
    mockPreapprove.mockImplementation((_h, _s, _n, opts) =>
      opts?.dryRun === false
        ? {
            ...plan(false),
            ok: false,
            wrote: false,
            added: [],
            addedEntries: [],
            reason: 'write-failed',
            detail: 'EACCES',
          }
        : plan(true),
    );
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, {
      all: false,
      yes: true,
      'dry-run': false,
      'preapprove-tools': true,
      client: ['claude-code'],
    });
    expect(ctx.stdout.join('')).toContain('permissions not added');
    // Code review F-031: the user asked for the write; CI must see it failed.
    expect(ctx.process.exitCode).toBe(1);
  });

  it('exits 1 when --preapprove-tools cannot even plan the write', async () => {
    mockPreapprove.mockImplementation((_h, _s, _n, opts) => ({
      ...plan(opts?.dryRun ?? false),
      ok: false,
      wrote: false,
      added: [],
      addedEntries: [],
      reason: 'unsupported-config-shape',
      detail: 'permissions.allow exists but is not a list',
    }));
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, {
      all: false,
      yes: true,
      'dry-run': false,
      'preapprove-tools': true,
      client: ['claude-code'],
    });
    expect(writes()).toHaveLength(0);
    expect(ctx.stdout.join('')).toContain('permissions not added');
    expect(ctx.process.exitCode).toBe(1);
  });

  it('keeps exit 0 when the writer declines to create a Cursor allowlist', async () => {
    mockPreapprove.mockImplementation((_h, _s, _n, opts) => ({
      ...plan(opts?.dryRun ?? false),
      ok: false,
      wrote: false,
      added: [],
      addedEntries: [],
      reason: 'allowlist-key-absent',
      detail: 'Cursor uses the allowlist in its own Settings; add these …',
    }));
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, {
      all: false,
      yes: true,
      'dry-run': false,
      'preapprove-tools': true,
      client: ['claude-code'],
    });
    expect(ctx.stdout.join('')).toContain(
      'permissions not added (Cursor uses the allowlist in its own Settings',
    );
    expect(ctx.process.exitCode).toBe(0);
  });

  it('keeps exit 0 for an interactive "No" and for --dry-run', async () => {
    process.stdout.isTTY = true;
    const interactive = createMockContext();
    await mcpAddHandler.call(interactive, {
      all: false,
      yes: false,
      'dry-run': false,
      'preapprove-tools': true,
    });
    expect(writes()).toHaveLength(0);
    expect(interactive.process.exitCode).toBe(0);

    process.stdout.isTTY = originalIsTTY;
    mockPreapprove.mockImplementation((_h, _s, _n, opts) => ({
      ...plan(opts?.dryRun ?? false),
      ok: false,
      reason: 'unsupported-config-shape',
    }));
    const dry = createMockContext();
    await mcpAddHandler.call(dry, {
      all: false,
      yes: true,
      'dry-run': true,
      'preapprove-tools': true,
      client: ['claude-code'],
    });
    expect(dry.process.exitCode).toBe(0);
  });

  it('names entries the user set differently instead of claiming "already pre-approved"', async () => {
    mockPreapprove.mockImplementation((_h, _s, _n, opts) => ({
      ...plan(opts?.dryRun ?? false),
      added: [],
      addedEntries: [],
      alreadyPresent: ['mcp:levr:get_issue'],
      conflicting: ['mcp:levr:get_context'],
    }));
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, {
      all: false,
      yes: true,
      'dry-run': false,
      'preapprove-tools': true,
      client: ['claude-code'],
    });
    const out = ctx.stdout.join('');
    expect(out).not.toContain('already pre-approved in');
    expect(out).toContain(
      'Set differently by you, left as is: mcp:levr:get_context',
    );
    expect(out).toContain('Already pre-approved: mcp:levr:get_issue');
    expect(writes()).toHaveLength(0);
  });

  it('says "already pre-approved" when every entry is present', async () => {
    mockPreapprove.mockImplementation((_h, _s, _n, opts) => ({
      ...plan(opts?.dryRun ?? false),
      added: [],
      addedEntries: [],
      alreadyPresent: TOOLS.map((t) => `mcp__levr__${t}`),
    }));
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, {
      all: false,
      yes: true,
      'dry-run': false,
      'preapprove-tools': true,
      client: ['claude-code'],
    });
    expect(ctx.stdout.join('')).toContain(
      `Levr tools are already pre-approved in ${FILE}`,
    );
  });

  it('Ctrl+C on one client stops the offer for every remaining client', async () => {
    process.stdout.isTTY = true;
    mockDetectSync.mockReturnValue([det('claude-code'), det('cursor')]);
    prompts.multiselect.mockResolvedValue(['claude-code', 'cursor']);
    prompts.isCancel.mockImplementation((v?: unknown) => v === CANCEL);
    prompts.confirm.mockResolvedValueOnce(CANCEL as unknown as boolean);
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, {
      all: false,
      yes: false,
      'dry-run': false,
      'preapprove-tools': false,
    });
    expect(prompts.confirm).toHaveBeenCalledTimes(1);
    expect(writes()).toHaveLength(0);
    const out = ctx.stdout.join('');
    expect(out).toContain('Claude Code: permissions not added.');
    expect(out).toContain('Cursor: permissions not added (cancelled).');
    prompts.isCancel.mockImplementation(() => false);
  });

  it('offers nothing for a client without a descriptor', async () => {
    mockDetectSync.mockReturnValue([det('windsurf')]);
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, {
      all: false,
      yes: true,
      'dry-run': false,
      'preapprove-tools': true,
      client: ['windsurf'],
    });
    expect(mockPreapprove).not.toHaveBeenCalled();
  });
});

describe('buildPreapproveDisclosure: who the file is shared with (F-030)', () => {
  it('says a project file is shared via git', () => {
    const text = buildPreapproveDisclosure('Claude Code', {
      ...plan(true),
      scope: 'project',
      file: '/repo/.claude/settings.json',
    });
    expect(text).toContain('File: /repo/.claude/settings.json');
    expect(text).toContain('shared via git with everyone who uses this repo');
  });

  it('says a local file is personal, and warns when it would be created un-ignored', () => {
    const base = {
      ...plan(true),
      scope: 'local' as const,
      file: '/repo/.claude/settings.local.json',
    };
    const created = buildPreapproveDisclosure('Claude Code', {
      ...base,
      fileExists: false,
      gitIgnored: false,
    });
    expect(created).toContain('personal to you');
    expect(created).toContain('git does not ignore it');

    const ignored = buildPreapproveDisclosure('Claude Code', {
      ...base,
      fileExists: false,
      gitIgnored: true,
    });
    expect(ignored).toContain('personal to you');
    expect(ignored).not.toContain('git does not ignore it');
  });

  it('adds no sharing note for a user file', () => {
    const text = buildPreapproveDisclosure('Claude Code', plan(true));
    expect(text).not.toContain('shared via git');
    expect(text).not.toContain('personal to you');
  });
});
