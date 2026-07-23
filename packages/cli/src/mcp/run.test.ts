import type {
  DetectedHarness,
  InstallResult,
} from '@levr/mcp-harnesses/node';
import { describe, expect, it } from 'vitest';

import {
  autoSelectIds,
  formatReport,
  resolveRequestedIds,
  runNonInteractive,
  type InstallFn,
  type McpAddOptions,
  type RunReport,
} from './run.js';

function det(id: string, over: Partial<DetectedHarness> = {}): DetectedHarness {
  return {
    id,
    label: id,
    installed: false,
    alreadyConfigured: false,
    configPath: `/fake/${id}.json`,
    available: true,
    comingSoon: false,
    ...over,
  };
}

// cursor: detected & fresh · claude: already set up · zed: not detected
// vscode: coming soon · windsurf: unavailable on this platform
const DETECTED: DetectedHarness[] = [
  det('cursor', { installed: true }),
  det('claude', { installed: true, alreadyConfigured: true }),
  det('zed', { installed: false }),
  det('vscode', { installed: true, comingSoon: true }),
  det('windsurf', { available: false }),
];

// Echoes what it was asked to do; never touches the FS.
const fakeInstall: InstallFn = (harness, _url, dryRun): InstallResult => ({
  ok: true,
  wrote: !dryRun,
  path: `/fake/${harness.id}.json`,
  alreadyConfigured: false,
  dryRun,
});

function options(over: Partial<McpAddOptions> = {}): McpAddOptions {
  return {
    all: false,
    yes: false,
    dryRun: false,
    ...over,
  };
}

const URL = 'https://ai.levr.one/api/v1/mcp';
const SOURCE = 'derived:https://api.levr.one';

describe('selection', () => {
  it('autoSelectIds picks detected, installable, not-already-configured', () => {
    expect(autoSelectIds(DETECTED)).toEqual(['cursor']);
  });

  it('resolveRequestedIds --all takes every available, non-coming-soon', () => {
    expect(resolveRequestedIds({ all: true }, DETECTED).ids).toEqual([
      'cursor',
      'claude',
      'zed',
    ]);
  });

  it('resolveRequestedIds --client splits unknown and coming-soon', () => {
    expect(
      resolveRequestedIds(
        { all: false, clients: ['cursor', 'vscode', 'bogus'] },
        DETECTED,
      ),
    ).toEqual({ ids: ['cursor'], unknown: ['bogus'], comingSoon: ['vscode'] });
  });
});

describe('runNonInteractive', () => {
  const deps = { detect: () => DETECTED, install: fakeInstall };

  it('installs the requested client with a dry-run', () => {
    const report = runNonInteractive(
      options({ clients: ['cursor'], dryRun: true }),
      URL,
      SOURCE,
      deps,
    );
    expect(report.url).toBe(URL);
    expect(report.urlSource).toBe(SOURCE);
    expect(report.dryRun).toBe(true);
    expect(report.outcomes.map((o) => o.id)).toEqual(['cursor']);
    expect(report.outcomes[0]?.result.wrote).toBe(false);
  });

  it('--all installs every installable client', () => {
    const report = runNonInteractive(options({ all: true }), URL, SOURCE, deps);
    expect(report.outcomes.map((o) => o.id)).toEqual([
      'cursor',
      'claude',
      'zed',
    ]);
  });

  it('with only --yes, auto-selects detected clients', () => {
    const report = runNonInteractive(options({ yes: true }), URL, SOURCE, deps);
    expect(report.outcomes.map((o) => o.id)).toEqual(['cursor']);
  });

  it('reports unknown + coming-soon clients', () => {
    const report = runNonInteractive(
      options({ clients: ['cursor', 'vscode', 'bogus'] }),
      URL,
      SOURCE,
      deps,
    );
    expect(report.unknownClients).toEqual(['bogus']);
    expect(report.comingSoonClients).toEqual(['vscode']);
  });
});

describe('formatReport', () => {
  it('renders a golden summary', () => {
    const report: RunReport = {
      url: 'https://ai.levr.now/api/v1/mcp',
      urlSource: 'env:LEVR_MCP_URL',
      dryRun: false,
      outcomes: [
        {
          id: 'cursor',
          label: 'Cursor',
          result: {
            ok: true,
            wrote: true,
            path: '/home/.cursor/mcp.json',
            alreadyConfigured: false,
            dryRun: false,
          },
        },
        {
          id: 'claude-code',
          label: 'Claude Code',
          result: {
            ok: true,
            wrote: false,
            path: '',
            command: 'claude mcp add --transport http levr URL',
            alreadyConfigured: false,
            dryRun: false,
          },
        },
      ],
      unknownClients: ['bogus'],
      comingSoonClients: ['vscode'],
    };
    expect(formatReport(report)).toBe(
      [
        'MCP URL: https://ai.levr.now/api/v1/mcp (env:LEVR_MCP_URL)',
        'Cursor: installed → /home/.cursor/mcp.json',
        'Claude Code: run `claude mcp add --transport http levr URL`',
        'Unknown clients (skipped): bogus',
        'Coming soon (skipped): vscode',
      ].join('\n'),
    );
  });
});
