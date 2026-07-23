import { describe, it, expect, vi, beforeEach } from 'vitest';
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

import { mcpAddHandler } from './addHandler.js';

function det(id: string, over: Partial<DetectedHarness> = {}): DetectedHarness {
  return {
    id,
    label: id,
    installed: true,
    alreadyConfigured: false,
    configPath: `/fake/${id}.json`,
    available: true,
    comingSoon: false,
    ...over,
  };
}

function okResult(over: Partial<InstallResult> = {}): InstallResult {
  return {
    ok: true,
    wrote: true,
    path: '/fake/x.json',
    alreadyConfigured: false,
    dryRun: false,
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
});

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
