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
