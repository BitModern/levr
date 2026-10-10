import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  DetectedHarness,
  HarnessDef,
  InstallResult,
} from '@levr/mcp-harnesses/node';
import type { LocalContext } from '../../context.js';

const { mockDetectSync, mockInstall } = vi.hoisted(() => ({
  mockDetectSync: vi.fn<() => DetectedHarness[]>(),
  mockInstall:
    vi.fn<(h: HarnessDef, url: string, opts: unknown) => InstallResult>(),
}));

vi.mock('@levr/mcp-harnesses/node', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@levr/mcp-harnesses/node')>();
  return {
    ...actual,
    detectSync: mockDetectSync,
    installHarnessSync: mockInstall,
  };
});

vi.mock('../../auth/credentials.js', () => ({
  readCredentials: vi.fn(() => null),
}));

const { mockResolveToken, mockFetchSites } = vi.hoisted(() => ({
  mockResolveToken: vi.fn(),
  mockFetchSites: vi.fn(),
}));
vi.mock('../../auth/resolve-token.js', () => ({
  resolveToken: mockResolveToken,
}));
vi.mock('../../utils/sdk-client.js', () => ({ configureClient: vi.fn() }));
vi.mock('../../workspace/resolve-workspace.js', () => ({
  fetchSites: mockFetchSites,
}));
// The resolver must never touch the CLI's own workspace selection.
vi.mock('../../workspace/workspace-store.js', () => ({
  loadWorkspace: vi.fn(() => {
    throw new Error('mcp add read the CLI workspace selection');
  }),
  saveWorkspace: vi.fn(() => {
    throw new Error('mcp add changed the CLI workspace selection');
  }),
  clearWorkspace: vi.fn(() => {
    throw new Error('mcp add cleared the CLI workspace selection');
  }),
}));

const prompts = vi.hoisted(() => {
  const CANCEL = Symbol('cancel');
  return {
    CANCEL,
    select: vi.fn(),
    multiselect: vi.fn(),
    isCancel: (v: unknown) => v === CANCEL,
    intro: vi.fn(),
    note: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
  };
});
vi.mock('@clack/prompts', () => prompts);

import { mcpAddHandler } from './addHandler.js';

function det(id: string, over: Partial<DetectedHarness> = {}): DetectedHarness {
  const base: Omit<DetectedHarness, 'scopes'> = {
    id,
    label: id,
    installed: true,
    alreadyConfigured: false,
    configPath: `/fake/${id}.json`,
    available: true,
    ...over,
  };
  return {
    ...base,
    // Derived, so the legacy top-level mirror and the default scope never
    // disagree — real detection keeps them in step.
    scopes: over.scopes ?? [
      {
        scope: 'user',
        installKind: 'config-file',
        configPath: base.configPath,
        available: base.available,
        alreadyConfigured: base.alreadyConfigured,
      },
    ],
  };
}

function okResult(over: Partial<InstallResult> = {}): InstallResult {
  return {
    ok: true,
    wrote: true,
    path: '/fake/x.json',
    alreadyConfigured: false,
    dryRun: false,
    scope: 'user',
    ...over,
  };
}

function createMockContext(): LocalContext & { output: string[] } {
  const output: string[] = [];
  return {
    process: {
      stdout: {
        write: vi.fn((s: string) => {
          output.push(s);
          return true;
        }),
      },
      stderr: { write: vi.fn() },
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
    output,
  } as unknown as LocalContext & { output: string[] };
}

// vitest runs without a TTY, so the handler naturally takes the
// non-interactive path — exactly the CI-facing surface under test.
beforeEach(() => {
  vi.clearAllMocks();
  mockDetectSync.mockReturnValue([det('cursor')]);
  mockInstall.mockReturnValue(okResult());
  // Default: not logged in, so an unpinned run prints how to log in rather
  // than a list of workspaces.
  mockResolveToken.mockRejectedValue(
    new Error("Not authenticated. Run 'levr auth login' first."),
  );
  mockFetchSites.mockResolvedValue([]);
});

const SITES = [
  {
    workspace_id: 'id-acme',
    workspace_name: 'Acme',
    workspace_url_key: 'acme',
  },
  {
    workspace_id: 'id-beta',
    workspace_name: 'Beta',
    workspace_url_key: 'beta',
  },
];
function loggedIn(): void {
  mockResolveToken.mockResolvedValue({ token: 'jwt', type: 'jwt' });
  mockFetchSites.mockResolvedValue(SITES);
}
/** Everything the handler reported through `logger.error`, joined. */
function loggedErrors(ctx: LocalContext): string {
  const { error } = ctx.logger as unknown as {
    error: { mock: { calls: unknown[][] } };
  };
  return error.mock.calls.flat().join('\n');
}
const BASE = {
  all: false,
  yes: true,
  'dry-run': false,
  client: ['cursor'],
  url: 'https://ai.levr.one/api/v1/mcp',
};

describe('mcpAddHandler (non-interactive)', () => {
  it('installs a requested client and exits 0', async () => {
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, {
      all: false,
      yes: true,
      'dry-run': false,
      client: ['cursor'],
    });

    expect(mockInstall).toHaveBeenCalledTimes(1);
    expect(ctx.output.join('')).toContain('Cursor: installed');
    expect(ctx.process.exitCode).toBe(0);
  });

  it('splits comma-separated and repeated --client values', async () => {
    mockDetectSync.mockReturnValue([det('cursor'), det('zed')]);
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, {
      all: false,
      yes: false,
      'dry-run': true,
      client: ['cursor, zed'],
    });

    expect(mockInstall).toHaveBeenCalledTimes(2);
    expect(ctx.process.exitCode).toBe(0);
  });

  it('exits 1 when a requested client id is unknown (review F1)', async () => {
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, {
      all: false,
      yes: true,
      'dry-run': false,
      client: ['bogus'],
    });

    expect(ctx.output.join('')).toContain('Unknown clients');
    expect(ctx.process.exitCode).toBe(1);
  });

  it('exits 1 when an install fails (review F1)', async () => {
    mockInstall.mockReturnValue(okResult({ ok: false, wrote: false }));
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, {
      all: true,
      yes: false,
      'dry-run': false,
    });

    expect(ctx.process.exitCode).toBe(1);
  });

  it('a legitimate no-op (already configured) stays exit 0', async () => {
    mockDetectSync.mockReturnValue([
      det('cursor', { alreadyConfigured: true }),
    ]);
    mockInstall.mockReturnValue(
      okResult({ wrote: false, alreadyConfigured: true }),
    );
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, {
      all: false,
      yes: true,
      'dry-run': false,
    });

    expect(ctx.process.exitCode).toBe(0);
  });

  it('passes the --url flag through to the install', async () => {
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, {
      all: false,
      yes: true,
      'dry-run': false,
      client: ['cursor'],
      url: 'https://custom/v1/mcp',
    });

    expect(mockInstall).toHaveBeenCalledWith(
      expect.anything(),
      'https://custom/v1/mcp',
      expect.anything(),
    );
    expect(ctx.output.join('')).toContain('https://custom/v1/mcp (flag)');
  });
});

describe('mcpAddHandler --workspace / --name / --replace (internal D6)', () => {
  it('--workspace <url_key> writes the scoped URL', async () => {
    loggedIn();
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, { ...BASE, workspace: 'beta' });

    expect(ctx.process.exitCode).toBe(0);
    expect(mockInstall).toHaveBeenCalledWith(
      expect.anything(),
      'https://ai.levr.one/api/v1/mcp/w/beta',
      expect.objectContaining({ serverName: 'levr', replaceExisting: false }),
    );
    expect(ctx.output.join('')).toContain('workspace Beta');
  });

  it('--workspace <name> resolves the name to its url_key', async () => {
    loggedIn();
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, { ...BASE, workspace: 'acme' });
    expect(mockInstall).toHaveBeenCalledWith(
      expect.anything(),
      'https://ai.levr.one/api/v1/mcp/w/acme',
      expect.anything(),
    );
  });

  it('--workspace when not logged in exits 1 and writes nothing (fail_closed)', async () => {
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, { ...BASE, workspace: 'acme' });
    expect(ctx.process.exitCode).toBe(1);
    expect(loggedErrors(ctx)).toContain('levr auth login');
    expect(mockInstall).not.toHaveBeenCalled();
  });

  it('--workspace with a personal access token exits 1', async () => {
    mockResolveToken.mockResolvedValue({ token: 'pat', type: 'pat' });
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, { ...BASE, workspace: 'acme' });
    expect(ctx.process.exitCode).toBe(1);
    expect(mockInstall).not.toHaveBeenCalled();
  });

  it('an unknown --workspace exits 1 listing name (url_key)', async () => {
    loggedIn();
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, { ...BASE, workspace: 'nope' });
    expect(ctx.process.exitCode).toBe(1);
    expect(loggedErrors(ctx)).toContain('Acme (acme)');
    expect(mockInstall).not.toHaveBeenCalled();
  });

  it('--workspace with a --url that already names a workspace exits 1', async () => {
    loggedIn();
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, {
      ...BASE,
      url: 'https://ai.levr.one/api/v1/mcp/w/acme',
      workspace: 'beta',
    });
    expect(ctx.process.exitCode).toBe(1);
    expect(mockInstall).not.toHaveBeenCalled();
  });

  it('--workspace with a --url on another server than the session exits 1', async () => {
    loggedIn();
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, {
      ...BASE,
      url: 'https://ai.levr.now/api/v1/mcp',
      workspace: 'acme',
    });
    expect(ctx.process.exitCode).toBe(1);
    expect(loggedErrors(ctx)).toContain('on another server');
    expect(mockFetchSites).not.toHaveBeenCalled();
    expect(mockInstall).not.toHaveBeenCalled();
  });

  it('an unpinned run on another server lists no workspaces from the session', async () => {
    loggedIn();
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, {
      ...BASE,
      url: 'https://ai.levr.now/api/v1/mcp',
    });
    expect(ctx.output.join('')).not.toContain('not pinned');
    expect(ctx.process.exitCode).toBe(0);
  });

  it('--name is passed to the installer', async () => {
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, { ...BASE, name: 'levr-beta' });
    expect(mockInstall).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ serverName: 'levr-beta' }),
    );
  });

  it('accepts names the pattern allows, including a leading underscore', async () => {
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, { ...BASE, name: '_levr-2' });
    expect(ctx.process.exitCode).toBe(0);
    expect(mockInstall).toHaveBeenCalled();
  });

  it.each(['--evil', '-x', 'has space', 'a;b', '', 'x'.repeat(65)])(
    'an invalid --name %j exits 1 before any write',
    async (name) => {
      const ctx = createMockContext();
      await mcpAddHandler.call(ctx, { ...BASE, name });
      expect(ctx.process.exitCode).toBe(1);
      expect(mockInstall).not.toHaveBeenCalled();
    },
  );

  it('--replace asks the installer to switch an existing entry', async () => {
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, { ...BASE, replace: true });
    expect(mockInstall).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ replaceExisting: true }),
    );
  });

  it('a refusal names the current URL and the exact switch command', async () => {
    loggedIn();
    mockInstall.mockReturnValue(
      okResult({
        ok: false,
        wrote: false,
        reason: 'url-mismatch',
        currentUrl: 'https://ai.levr.one/api/v1/mcp/w/acme',
      }),
    );
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, { ...BASE, workspace: 'beta' });
    const out = ctx.output.join('');
    expect(ctx.process.exitCode).toBe(1);
    expect(out).toContain('https://ai.levr.one/api/v1/mcp/w/acme');
    // Every flag of the run is kept, so the suggestion targets the same
    // server, clients and workspace.
    expect(out).toContain(
      'levr mcp add --client cursor --yes --url https://ai.levr.one/api/v1/mcp --workspace beta --replace',
    );
  });

  it('without --workspace, a non-interactive run writes the unscoped URL and lists the choices (fail_fallback)', async () => {
    loggedIn();
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, BASE);
    expect(mockInstall).toHaveBeenCalledWith(
      expect.anything(),
      'https://ai.levr.one/api/v1/mcp',
      expect.anything(),
    );
    const out = ctx.output.join('');
    expect(out).toContain('--workspace <url_key>');
    expect(out).toContain('Beta (beta)');
    expect(ctx.process.exitCode).toBe(0);
  });

  it('without a session, the unpinned run says how to pin one and succeeds', async () => {
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, BASE);
    const out = ctx.output.join('');
    expect(out).toContain(
      "run 'levr auth login', then re-run with --workspace",
    );
    expect(ctx.process.exitCode).toBe(0);
  });

  it('a pinned run prints no pinning hint', async () => {
    loggedIn();
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, { ...BASE, workspace: 'acme' });
    expect(ctx.output.join('')).not.toContain('not pinned');
  });
});

describe('mcpAddHandler refusal output (internal)', () => {
  it('a refused --name install names that entry in the remove hint, and prints no restart', async () => {
    mockDetectSync.mockReturnValue([det('claude-code')]);
    mockInstall.mockReturnValue(
      okResult({
        ok: false,
        wrote: false,
        path: '',
        executed: true,
        command:
          'claude mcp add --transport http --scope user levr-beta https://ai.levr.one/api/v1/mcp',
        commandError: 'MCP server levr-beta already exists in user config',
      }),
    );
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, {
      ...BASE,
      client: ['claude-code'],
      name: 'levr-beta',
    });
    const out = ctx.output.join('');
    expect(ctx.process.exitCode).toBe(1);
    expect(out).toContain('`claude mcp remove --scope user levr-beta`');
    expect(out).toContain('--name <other>');
    expect(out).not.toContain('restart');
    expect(out).toContain('Nothing was installed.');
  });
});

describe('mcpAddHandler interactive workspace picker (internal D6)', () => {
  const INTERACTIVE = {
    all: false,
    yes: false,
    'dry-run': false,
    scope: 'user' as const,
    url: 'https://ai.levr.one/api/v1/mcp',
  };
  let wasTTY: boolean | undefined;
  beforeEach(() => {
    wasTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
    });
    prompts.multiselect.mockResolvedValue(['cursor']);
  });
  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: wasTTY,
      configurable: true,
    });
  });

  it('asks which workspace, by name, when there are several, and pins the pick', async () => {
    loggedIn();
    prompts.select.mockResolvedValue('beta');
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, INTERACTIVE);

    expect(prompts.select).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          expect.objectContaining({ value: 'acme', label: 'Acme' }),
          expect.objectContaining({ value: 'beta', label: 'Beta' }),
        ],
      }),
    );
    expect(mockInstall).toHaveBeenCalledWith(
      expect.anything(),
      'https://ai.levr.one/api/v1/mcp/w/beta',
      expect.anything(),
    );
  });

  it('cancelling the workspace pick exits 1 and installs nothing', async () => {
    loggedIn();
    prompts.select.mockResolvedValue(prompts.CANCEL);
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, INTERACTIVE);
    expect(ctx.process.exitCode).toBe(1);
    expect(mockInstall).not.toHaveBeenCalled();
  });

  it('does not ask with a single workspace, and keeps the unpinned URL', async () => {
    mockResolveToken.mockResolvedValue({ token: 'jwt', type: 'jwt' });
    mockFetchSites.mockResolvedValue([SITES[0]]);
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, INTERACTIVE);
    expect(prompts.select).not.toHaveBeenCalled();
    expect(mockInstall).toHaveBeenCalledWith(
      expect.anything(),
      'https://ai.levr.one/api/v1/mcp',
      expect.anything(),
    );
  });

  it('does not ask when not logged in', async () => {
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, INTERACTIVE);
    expect(prompts.select).not.toHaveBeenCalled();
  });

  it('does not ask when --workspace is given, and its refusal keeps --workspace', async () => {
    loggedIn();
    mockInstall.mockReturnValue(
      okResult({
        ok: false,
        wrote: false,
        reason: 'url-mismatch',
        currentUrl: 'https://ai.levr.one/api/v1/mcp/w/acme',
      }),
    );
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, { ...INTERACTIVE, workspace: 'beta' });
    expect(prompts.select).not.toHaveBeenCalled();
    const notes = prompts.note.mock.calls.map((c) => String(c[0])).join('\n');
    expect(notes).toContain(
      'levr mcp add --scope user --url https://ai.levr.one/api/v1/mcp --workspace beta --replace',
    );
  });

  it('a non-interactive run never prompts', async () => {
    loggedIn();
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, { ...INTERACTIVE, yes: true });
    expect(prompts.select).not.toHaveBeenCalled();
    expect(prompts.multiselect).not.toHaveBeenCalled();
  });
});

describe('mcpAddHandler: an entry pointing at another workspace (internal)', () => {
  const ACME = 'https://ai.levr.one/api/v1/mcp/w/acme';
  const BETA = 'https://ai.levr.one/api/v1/mcp/w/beta';
  /** cursor, with a levr entry at user scope pointing at `currentUrl`. */
  function pointingAt(
    currentUrl: string | null,
    besideConfigured = false,
  ): DetectedHarness {
    return det('cursor', {
      alreadyConfigured: true,
      scopes: [
        {
          scope: 'user',
          installKind: 'config-file',
          configPath: '/fake/cursor.json',
          available: true,
          alreadyConfigured: true,
          ...(currentUrl ? { currentUrl } : {}),
          ...(besideConfigured ? { besideConfigured } : {}),
        },
      ],
    });
  }
  const installOpts = (): Record<string, unknown> =>
    mockInstall.mock.calls[0]?.[2] as Record<string, unknown>;

  describe('interactive', () => {
    const INTERACTIVE = {
      all: false,
      yes: false,
      'dry-run': false,
      scope: 'user' as const,
      url: 'https://ai.levr.one/api/v1/mcp',
      workspace: 'beta',
    };
    let wasTTY: boolean | undefined;
    beforeEach(() => {
      wasTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        configurable: true,
      });
      loggedIn();
      mockDetectSync.mockReturnValue([pointingAt(ACME)]);
      prompts.multiselect.mockResolvedValue(['cursor']);
    });
    afterEach(() => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: wasTTY,
        configurable: true,
      });
    });
    const notes = (): string =>
      prompts.note.mock.calls.map((c) => String(c[0])).join('\n');

    it('pre-selects the client and says where its entry points', async () => {
      prompts.select.mockResolvedValue('leave');
      await mcpAddHandler.call(createMockContext(), INTERACTIVE);
      expect(prompts.multiselect).toHaveBeenCalledWith(
        expect.objectContaining({
          options: [
            expect.objectContaining({
              value: 'cursor',
              hint: 'points at workspace acme (user)',
            }),
          ],
          initialValues: ['cursor'],
        }),
      );
    });

    it('asks switch / add beside / leave', async () => {
      prompts.select.mockResolvedValue('leave');
      await mcpAddHandler.call(createMockContext(), INTERACTIVE);
      expect(prompts.select).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'cursor: its levr entry points at workspace acme',
          options: [
            expect.objectContaining({
              value: 'switch',
              label: 'Switch it to workspace beta',
            }),
            expect.objectContaining({
              value: 'beside',
              label: 'Add beside it as levr-beta',
            }),
            expect.objectContaining({ value: 'leave', label: 'Leave it' }),
          ],
        }),
      );
    });

    it('an entry with no Levr URL is asked about once, without "switch"', async () => {
      mockDetectSync.mockReturnValue([pointingAt(null)]);
      prompts.select.mockResolvedValue('leave');
      await mcpAddHandler.call(createMockContext(), INTERACTIVE);
      expect(prompts.multiselect).toHaveBeenCalledWith(
        expect.objectContaining({
          options: [
            expect.objectContaining({
              hint: 'its levr entry holds no Levr URL (user)',
            }),
          ],
        }),
      );
      expect(prompts.select).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'cursor: its levr entry holds no Levr URL',
          options: [
            expect.objectContaining({ value: 'beside' }),
            expect.objectContaining({ value: 'leave' }),
          ],
        }),
      );
    });

    it('does not offer "Add beside it" when that name already holds another entry', async () => {
      mockDetectSync.mockReturnValue([pointingAt(ACME, true)]);
      prompts.select.mockResolvedValue('leave');
      await mcpAddHandler.call(createMockContext(), INTERACTIVE);
      expect(prompts.select).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'cursor: its levr entry points at workspace acme, and levr-beta is taken too',
          options: [
            expect.objectContaining({ value: 'switch' }),
            expect.objectContaining({ value: 'leave' }),
          ],
        }),
      );
    });

    it('with neither "switch" nor "Add beside it" possible, leaves it without asking', async () => {
      mockDetectSync.mockReturnValue([pointingAt(null, true)]);
      const ctx = createMockContext();
      await mcpAddHandler.call(ctx, INTERACTIVE);
      expect(prompts.select).not.toHaveBeenCalled();
      expect(mockInstall).not.toHaveBeenCalled();
      expect(notes()).toContain(
        'cursor: left as it was (its levr entry holds no Levr URL; levr-beta is taken too, so add this one with --name <other>)',
      );
      expect(ctx.process.exitCode).toBe(0);
    });

    it('"Add beside it" never replaces, even under --replace', async () => {
      mockDetectSync.mockReturnValue([pointingAt(null)]);
      prompts.select.mockResolvedValue('beside');
      await mcpAddHandler.call(createMockContext(), {
        ...INTERACTIVE,
        replace: true,
      });
      expect(installOpts()).toMatchObject({
        serverName: 'levr-beta',
        replaceExisting: false,
      });
    });

    it('"Switch it" replaces the entry', async () => {
      prompts.select.mockResolvedValue('switch');
      const ctx = createMockContext();
      await mcpAddHandler.call(ctx, INTERACTIVE);
      expect(mockInstall).toHaveBeenCalledWith(
        expect.anything(),
        BETA,
        expect.anything(),
      );
      expect(installOpts()).toMatchObject({
        serverName: 'levr',
        replaceExisting: true,
      });
      expect(ctx.process.exitCode).toBe(0);
    });

    it('"Add beside it" writes a second entry named for the workspace', async () => {
      prompts.select.mockResolvedValue('beside');
      await mcpAddHandler.call(createMockContext(), INTERACTIVE);
      expect(installOpts()).toMatchObject({
        serverName: 'levr-beta',
        replaceExisting: false,
      });
      expect(notes()).toContain('[as levr-beta]');
    });

    it('"Leave it" installs nothing, says so, and succeeds', async () => {
      prompts.select.mockResolvedValue('leave');
      const ctx = createMockContext();
      await mcpAddHandler.call(ctx, INTERACTIVE);
      expect(mockInstall).not.toHaveBeenCalled();
      expect(notes()).toContain(
        'cursor: left as it was (points at workspace acme)',
      );
      expect(prompts.outro).toHaveBeenLastCalledWith('Nothing to do.');
      expect(ctx.process.exitCode).toBe(0);
    });

    it('cancelling the question exits 1 and installs nothing', async () => {
      prompts.select.mockResolvedValue(prompts.CANCEL);
      const ctx = createMockContext();
      await mcpAddHandler.call(ctx, INTERACTIVE);
      expect(ctx.process.exitCode).toBe(1);
      expect(mockInstall).not.toHaveBeenCalled();
    });

    it('--replace already answered it: no question, the entry is switched', async () => {
      await mcpAddHandler.call(createMockContext(), {
        ...INTERACTIVE,
        replace: true,
      });
      expect(prompts.select).not.toHaveBeenCalled();
      expect(installOpts()).toMatchObject({ replaceExisting: true });
    });

    it('an entry with no Levr URL is not pre-selected, and is never offered a switch', async () => {
      mockDetectSync.mockReturnValue([pointingAt(null)]);
      prompts.select.mockResolvedValue('leave');
      await mcpAddHandler.call(createMockContext(), INTERACTIVE);
      expect(prompts.multiselect).toHaveBeenCalledWith(
        expect.objectContaining({ initialValues: [] }),
      );
      const options = (
        prompts.select.mock.calls[0]?.[0] as { options: { value: string }[] }
      ).options.map((o) => o.value);
      expect(options).toEqual(['beside', 'leave']);
    });

    it('an entry already on this workspace is "already set up", not pre-selected, not asked', async () => {
      mockDetectSync.mockReturnValue([pointingAt(BETA)]);
      prompts.multiselect.mockResolvedValue([]);
      await mcpAddHandler.call(createMockContext(), INTERACTIVE);
      expect(prompts.multiselect).toHaveBeenCalledWith(
        expect.objectContaining({
          options: [expect.objectContaining({ hint: 'already set up (user)' })],
          initialValues: [],
        }),
      );
      expect(prompts.select).not.toHaveBeenCalled();
    });
  });

  describe('--yes', () => {
    const YES = {
      all: false,
      yes: true,
      'dry-run': false,
      url: 'https://ai.levr.one/api/v1/mcp',
      workspace: 'beta',
    };
    beforeEach(() => {
      loggedIn();
      mockDetectSync.mockReturnValue([pointingAt(ACME)]);
    });

    it('no longer skips the client: the refusal is reported and the run exits 1', async () => {
      mockInstall.mockReturnValue(
        okResult({
          ok: false,
          wrote: false,
          reason: 'url-mismatch',
          currentUrl: ACME,
        }),
      );
      const ctx = createMockContext();
      await mcpAddHandler.call(ctx, YES);
      expect(mockInstall).toHaveBeenCalledWith(
        expect.anything(),
        BETA,
        expect.anything(),
      );
      expect(installOpts()).toMatchObject({ replaceExisting: false });
      const out = ctx.output.join('');
      expect(out).toContain(
        'Cursor: failed — already configured with a different URL',
      );
      expect(out).toContain('--replace');
      expect(ctx.process.exitCode).toBe(1);
    });

    it('--yes --replace switches it', async () => {
      const ctx = createMockContext();
      await mcpAddHandler.call(ctx, { ...YES, replace: true });
      expect(installOpts()).toMatchObject({ replaceExisting: true });
      expect(ctx.process.exitCode).toBe(0);
    });

    it('--yes --name reads the entry under that name', async () => {
      await mcpAddHandler.call(createMockContext(), {
        ...YES,
        name: 'levr-beta',
      });
      expect(mockDetectSync).toHaveBeenCalledWith(undefined, {
        serverName: 'levr-beta',
        besideName: 'levr-beta-beta',
      });
    });

    it('an entry already on this workspace is still skipped', async () => {
      mockDetectSync.mockReturnValue([pointingAt(BETA)]);
      const ctx = createMockContext();
      await mcpAddHandler.call(ctx, YES);
      expect(mockInstall).not.toHaveBeenCalled();
      expect(ctx.process.exitCode).toBe(0);
    });
  });
});

describe('mcpAddHandler: re-running after "Add beside it" (internal)', () => {
  const ACME = 'https://ai.levr.one/api/v1/mcp/w/acme';
  const BETA = 'https://ai.levr.one/api/v1/mcp/w/beta';
  const besideSetUp = (): DetectedHarness =>
    det('cursor', {
      alreadyConfigured: true,
      scopes: [
        {
          scope: 'user',
          installKind: 'config-file',
          configPath: '/fake/cursor.json',
          available: true,
          alreadyConfigured: true,
          currentUrl: ACME,
          besideUrl: BETA,
        },
      ],
    });
  beforeEach(() => {
    loggedIn();
    mockDetectSync.mockReturnValue([besideSetUp()]);
  });

  it('--yes leaves it alone and exits 0', async () => {
    const ctx = createMockContext();
    await mcpAddHandler.call(ctx, {
      all: false,
      yes: true,
      'dry-run': false,
      url: 'https://ai.levr.one/api/v1/mcp',
      workspace: 'beta',
    });
    expect(mockDetectSync).toHaveBeenCalledWith(undefined, {
      serverName: 'levr',
      besideName: 'levr-beta',
    });
    expect(mockInstall).not.toHaveBeenCalled();
    expect(ctx.process.exitCode).toBe(0);
  });

  describe('interactive', () => {
    let wasTTY: boolean | undefined;
    beforeEach(() => {
      wasTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        configurable: true,
      });
    });
    afterEach(() => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: wasTTY,
        configurable: true,
      });
    });

    it('under --replace, a client already set up beside it is still not replaced', async () => {
      prompts.multiselect.mockResolvedValue(['cursor']);
      mockInstall.mockReturnValue(
        okResult({ wrote: false, alreadyConfigured: true }),
      );
      await mcpAddHandler.call(createMockContext(), {
        all: false,
        yes: false,
        'dry-run': false,
        scope: 'user' as const,
        url: 'https://ai.levr.one/api/v1/mcp',
        workspace: 'beta',
        replace: true,
      });
      expect(mockInstall.mock.calls[0]?.[2]).toMatchObject({
        serverName: 'levr-beta',
        replaceExisting: false,
      });
    });

    it('is not pre-selected, and if ticked is installed under the beside name without a question', async () => {
      prompts.multiselect.mockResolvedValue(['cursor']);
      mockInstall.mockReturnValue(
        okResult({ wrote: false, alreadyConfigured: true }),
      );
      const ctx = createMockContext();
      await mcpAddHandler.call(ctx, {
        all: false,
        yes: false,
        'dry-run': false,
        scope: 'user' as const,
        url: 'https://ai.levr.one/api/v1/mcp',
        workspace: 'beta',
      });
      expect(prompts.multiselect).toHaveBeenCalledWith(
        expect.objectContaining({
          options: [
            expect.objectContaining({
              hint: 'already set up as levr-beta (user)',
            }),
          ],
          initialValues: [],
        }),
      );
      expect(prompts.select).not.toHaveBeenCalled();
      expect(mockInstall.mock.calls[0]?.[2]).toMatchObject({
        serverName: 'levr-beta',
      });
      expect(ctx.process.exitCode).toBe(0);
    });
  });
});
