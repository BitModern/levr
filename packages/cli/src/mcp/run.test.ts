import { supportsScope } from '@levr/mcp-harnesses/node';
import type {
  DetectedHarness,
  DetectedScope,
  HarnessScope,
  InstallResult,
} from '@levr/mcp-harnesses/node';
import { describe, expect, it } from 'vitest';

import {
  autoSelectIds,
  clientChoices,
  formatReport,
  nextStepsText,
  offerableScopes,
  resolveRequestedIds,
  runNonInteractive,
  type InstallFn,
  type McpAddOptions,
  type RunReport,
} from './run.js';

/** One DetectedScope entry, for building multi-scope fixtures. */
function scopeState(
  scope: HarnessScope,
  available: boolean,
  alreadyConfigured = false,
): DetectedScope {
  return {
    scope,
    installKind: 'config-file',
    configPath: available ? `/fake/${scope}.json` : '',
    available,
    alreadyConfigured,
  };
}

function det(id: string, over: Partial<DetectedHarness> = {}): DetectedHarness {
  const base: Omit<DetectedHarness, 'scopes'> = {
    id,
    label: id,
    installed: false,
    alreadyConfigured: false,
    configPath: `/fake/${id}.json`,
    available: true,
    comingSoon: false,
    ...over,
  };
  return {
    ...base,
    // User-only by default, mirroring the majority of the catalog. Derived
    // from the top-level fields rather than hardcoded, because real detection
    // keeps the legacy mirror and the default scope in agreement — a fixture
    // where they disagree tests a state that cannot occur.
    scopes: over.scopes ?? [
      scopeState('user', base.available, base.alreadyConfigured),
    ],
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
  scope: 'user',
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
      scope: 'user',
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
            scope: 'user',
          },
        },
        {
          id: 'claude-code',
          label: 'Claude Code',
          result: {
            ok: true,
            wrote: false,
            path: '',
            command: 'claude mcp add --transport http --scope user levr URL',
            alreadyConfigured: false,
            dryRun: false,
            scope: 'user',
          },
        },
      ],
      unknownClients: ['bogus'],
      comingSoonClients: ['vscode'],
    };
    expect(formatReport(report)).toBe(
      [
        'MCP URL: https://ai.levr.now/api/v1/mcp (env:LEVR_MCP_URL)',
        'Cursor: installed (user) → /home/.cursor/mcp.json',
        'Claude Code (user): run `claude mcp add --transport http --scope user levr URL`',
        'Unknown clients (skipped): bogus',
        'Coming soon (skipped): vscode',
      ].join('\n'),
    );
  });
});

describe('scope selection', () => {
  // windsurf is user-only in the real catalog; cursor supports project.
  const REAL = [
    det('cursor', { installed: true }),
    det('windsurf', { installed: true }),
  ];

  /** Records the scope each harness was asked to install at. */
  function recordingInstall(): {
    fn: InstallFn;
    calls: Array<{ id: string; scope: string }>;
  } {
    const calls: Array<{ id: string; scope: string }> = [];
    const fn: InstallFn = (harness, _url, dryRun, scope): InstallResult => {
      calls.push({ id: harness.id, scope });
      // Mirror the library: an unsupported scope is refused, not written.
      const ok = supportsScope(harness, scope);
      return {
        ok,
        wrote: ok && !dryRun,
        path: ok ? `/fake/${harness.id}.json` : '',
        alreadyConfigured: false,
        dryRun,
        scope,
        ...(ok ? {} : { reason: 'unsupported-scope' as const }),
      };
    };
    return { fn, calls };
  }

  it('defaults to user scope when --scope is absent', () => {
    const { fn, calls } = recordingInstall();
    const report = runNonInteractive(options({ all: true }), URL, SOURCE, {
      detect: () => REAL,
      install: fn,
    });
    expect(report.scope).toBe('user');
    expect(calls.every((c) => c.scope === 'user')).toBe(true);
  });

  it('--all --scope project falls back for a user-only client, and says so', () => {
    const { fn, calls } = recordingInstall();
    const report = runNonInteractive(
      options({ all: true, scope: 'project' }),
      URL,
      SOURCE,
      { detect: () => REAL, install: fn },
    );
    // Cursor got what was asked; Windsurf was quietly incapable, so it fell
    // back to user — but the report must not be quiet about it.
    expect(calls).toEqual([
      { id: 'cursor', scope: 'project' },
      { id: 'windsurf', scope: 'user' },
    ]);
    const windsurf = report.outcomes.find((o) => o.id === 'windsurf');
    expect(windsurf?.fallbackFrom).toBe('project');
    expect(formatReport(report)).toContain(
      'project scope unsupported — used user',
    );
    // A fallback is not a failure.
    expect(report.outcomes.every((o) => o.result.ok)).toBe(true);
  });

  it('--client windsurf --scope project fails that client instead of falling back', () => {
    const { fn, calls } = recordingInstall();
    const report = runNonInteractive(
      options({ clients: ['windsurf'], scope: 'project' }),
      URL,
      SOURCE,
      { detect: () => REAL, install: fn },
    );
    // Naming the client AND the scope asserts the pairing — no silent landing
    // somewhere else.
    expect(calls).toEqual([{ id: 'windsurf', scope: 'project' }]);
    const outcome = report.outcomes[0];
    expect(outcome?.result.ok).toBe(false);
    expect(outcome?.fallbackFrom).toBeUndefined();
    expect(formatReport(report)).toContain(
      'Windsurf: failed — no project scope',
    );
  });

  it('names the supported scopes when it refuses', () => {
    const { fn } = recordingInstall();
    const report = runNonInteractive(
      options({ clients: ['windsurf'], scope: 'local' }),
      URL,
      SOURCE,
      { detect: () => REAL, install: fn },
    );
    expect(formatReport(report)).toContain('(supports: user)');
  });

  it("explains a not-a-repo refusal in the user's terms", () => {
    const fn: InstallFn = (_h, _url, dryRun, scope): InstallResult => ({
      ok: false,
      wrote: false,
      path: '',
      alreadyConfigured: false,
      dryRun,
      scope,
      reason: 'not-a-repo',
    });
    const report = runNonInteractive(
      options({ clients: ['cursor'], scope: 'project' }),
      URL,
      SOURCE,
      { detect: () => REAL, install: fn },
    );
    expect(formatReport(report)).toContain(
      'Cursor: failed — project scope needs a git repository (run from inside one)',
    );
  });

  it('reports the resolved path and scope on success', () => {
    const { fn } = recordingInstall();
    const report = runNonInteractive(
      options({ clients: ['cursor'], scope: 'project' }),
      URL,
      SOURCE,
      { detect: () => REAL, install: fn },
    );
    expect(formatReport(report)).toContain(
      'Cursor: installed (project) → /fake/cursor.json',
    );
  });

  it('tells the user to commit a project-scoped write', () => {
    const { fn } = recordingInstall();
    const report = runNonInteractive(
      options({ clients: ['cursor'], scope: 'project' }),
      URL,
      SOURCE,
      { detect: () => REAL, install: fn },
    );
    expect(nextStepsText(report)).toContain('commit it');
  });

  it('offers only scopes the selection can actually use here', () => {
    const detected = [
      det('cursor', {
        scopes: [scopeState('user', true), scopeState('project', true)],
      }),
      det('windsurf', { scopes: [scopeState('user', true)] }),
    ];
    expect(offerableScopes(['cursor', 'windsurf'], detected)).toEqual([
      'user',
      'project',
    ]);
    expect(offerableScopes(['windsurf'], detected)).toEqual(['user']);
    // Outside a repo D2 marks project unavailable, so it disappears here too.
    const noRepo = [
      det('cursor', {
        scopes: [scopeState('user', true), scopeState('project', false)],
      }),
    ];
    expect(offerableScopes(['cursor'], noRepo)).toEqual(['user']);
  });

  it('judges already-configured in the scope about to be used', () => {
    const detected = [
      det('cursor', {
        installed: true,
        scopes: [
          scopeState('user', true, true), // configured at user
          scopeState('project', true, false), // but not at project
        ],
      }),
    ];
    // Nothing to do at user scope...
    expect(autoSelectIds(detected, 'user')).toEqual([]);
    // ...but project scope is still unconfigured, so it stays selected.
    expect(autoSelectIds(detected, 'project')).toEqual(['cursor']);
  });
});

describe('cli-command execution reporting (D5)', () => {
  function cmdResult(over: Partial<InstallResult> = {}): InstallResult {
    return {
      ok: true,
      wrote: false,
      path: '',
      command: 'claude mcp add --transport http --scope user levr URL',
      alreadyConfigured: false,
      dryRun: false,
      scope: 'user',
      ...over,
    };
  }
  const report = (result: InstallResult): RunReport => ({
    url: URL,
    urlSource: SOURCE,
    scope: 'user',
    outcomes: [{ id: 'claude-code', label: 'Claude Code', result }],
    unknownClients: [],
    comingSoonClients: [],
    dryRun: false,
  });

  it('says it installed when it ran the command itself', () => {
    expect(formatReport(report(cmdResult({ executed: true })))).toContain(
      'Claude Code: installed (user) via `claude mcp add',
    );
  });

  it('still hands the command back when the CLI was not run', () => {
    expect(formatReport(report(cmdResult({ executed: false })))).toContain(
      'Claude Code (user): run `claude mcp add',
    );
  });

  it('reports a failed command as a failure, not as pending work', () => {
    const line = formatReport(
      report(
        cmdResult({ ok: false, executed: true, commandError: 'not logged in' }),
      ),
    );
    expect(line).toContain('Claude Code: failed');
    expect(line).toContain('not logged in');
    // Must not read as "here, run this" — that would look like work pending.
    expect(line).not.toContain('Claude Code (user): run');
  });

  it('counts an executed command as having done something', () => {
    expect(nextStepsText(report(cmdResult({ executed: true })))).toContain(
      'restart the client(s)',
    );
  });
});

describe('F-007 · the client picker is resolved for the scope in use', () => {
  const detected = [
    det('cursor', {
      installed: true,
      scopes: [
        scopeState('user', true, true), // configured at user
        scopeState('project', true, false), // NOT at project
      ],
    }),
    det('windsurf', { installed: true, scopes: [scopeState('user', true)] }),
  ];

  it('labels "already set up" against the chosen scope, not the default', () => {
    const atUser = clientChoices(detected, 'user');
    expect(atUser.find((c) => c.value === 'cursor')?.hint).toBe(
      'already set up (user)',
    );
    // Same client, same machine, different scope — and it is NOT set up there.
    const atProject = clientChoices(detected, 'project');
    expect(atProject.find((c) => c.value === 'cursor')?.hint).toBe('detected');
  });

  it('preselects on the chosen scope', () => {
    // Nothing to do at user; still work to do at project.
    expect(
      clientChoices(detected, 'user').find((c) => c.value === 'cursor')
        ?.selected,
    ).toBe(false);
    expect(
      clientChoices(detected, 'project').find((c) => c.value === 'cursor')
        ?.selected,
    ).toBe(true);
  });

  it('warns up front where a client that cannot do the scope will land', () => {
    // Better than a surprise fallback line after the install has happened.
    expect(
      clientChoices(detected, 'project').find((c) => c.value === 'windsurf')
        ?.hint,
    ).toBe('no project scope — will use user');
  });

  it('omits unavailable and coming-soon clients', () => {
    const rows = clientChoices(
      [
        ...detected,
        det('vscode', { comingSoon: true }),
        det('zed', { available: false }),
      ],
      'user',
    );
    expect(rows.map((r) => r.value)).toEqual(['cursor', 'windsurf']);
  });
});
