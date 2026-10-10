import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  detectSync,
  installHarnessSync,
  supportsScope,
  type HarnessEnv,
} from '@levr/mcp-harnesses/node';
import type {
  DetectedHarness,
  DetectedScope,
  HarnessScope,
  InstallResult,
} from '@levr/mcp-harnesses/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PLUGIN_TIP,
  autoSelectIds,
  besideName,
  clientChoices,
  entryConflicts,
  entryState,
  formatReport,
  installSelected,
  nextStepsText,
  offerableScopes,
  resolveRequestedIds,
  runNonInteractive,
  type InstallFn,
  type McpAddOptions,
  type RunDeps,
  type RunReport,
} from './run.js';

const URL = 'https://ai.levr.one/api/v1/mcp';
const SOURCE = 'derived:https://api.levr.one';

/**
 * One DetectedScope entry, for building multi-scope fixtures. A configured
 * scope points at URL unless told otherwise; `null` is an entry with no URL.
 */
function scopeState(
  scope: HarnessScope,
  available: boolean,
  alreadyConfigured = false,
  currentUrl: string | null = URL,
): DetectedScope {
  return {
    scope,
    installKind: 'config-file',
    configPath: available ? `/fake/${scope}.json` : '',
    available,
    alreadyConfigured,
    ...(alreadyConfigured && currentUrl !== null ? { currentUrl } : {}),
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
// windsurf: unavailable on this platform
const DETECTED: DetectedHarness[] = [
  det('cursor', { installed: true }),
  det('claude', { installed: true, alreadyConfigured: true }),
  det('zed', { installed: false }),
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

describe('selection', () => {
  it('autoSelectIds picks detected, installable, not-already-configured', () => {
    expect(autoSelectIds(DETECTED, undefined, URL)).toEqual(['cursor']);
  });

  it('resolveRequestedIds --all takes every available client', () => {
    expect(resolveRequestedIds({ all: true }, DETECTED).ids).toEqual([
      'cursor',
      'claude',
      'zed',
    ]);
  });

  it('resolveRequestedIds --client splits known from unknown', () => {
    expect(
      resolveRequestedIds(
        { all: false, clients: ['cursor', 'bogus'] },
        DETECTED,
      ),
    ).toEqual({ ids: ['cursor'], unknown: ['bogus'] });
  });

  it('resolveRequestedIds --client accepts VS Code as installable (internal)', () => {
    // The regression this guards: VS Code sat in a coming-soon bucket for as
    // long as its catalog entry was deferred, and `mcp add --client vscode`
    // silently skipped it. It is a real, installable id now — and since
    // internal retired the bucket, a known id can only ever be installable.
    expect(
      resolveRequestedIds({ all: false, clients: ['vscode'] }, DETECTED),
    ).toEqual({ ids: ['vscode'], unknown: [] });
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

  it('--all attempts exactly the available fixtures — derived, not listed', () => {
    const installable = DETECTED.filter((d) => d.available).map((d) => d.id);
    // Guard the fixture: below this floor the derived comparison proves
    // nothing, and a fixture edit must fail here rather than pass quietly.
    expect(installable.length).toBeGreaterThanOrEqual(3);
    const report = runNonInteractive(options({ all: true }), URL, SOURCE, deps);
    expect(report.outcomes.map((o) => o.id)).toEqual(installable);
  });

  it('with only --yes, auto-selects detected clients', () => {
    const report = runNonInteractive(options({ yes: true }), URL, SOURCE, deps);
    expect(report.outcomes.map((o) => o.id)).toEqual(['cursor']);
  });

  it('reports unknown clients', () => {
    const report = runNonInteractive(
      options({ clients: ['cursor', 'bogus'] }),
      URL,
      SOURCE,
      deps,
    );
    expect(report.unknownClients).toEqual(['bogus']);
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
    };
    expect(formatReport(report)).toBe(
      [
        'MCP URL: https://ai.levr.now/api/v1/mcp (env:LEVR_MCP_URL)',
        'Cursor: installed (user) → /home/.cursor/mcp.json',
        'Claude Code (user): run `claude mcp add --transport http --scope user levr URL`',
        'Unknown clients (skipped): bogus',
        // internal D6: the golden report has an ok Claude Code outcome, so it
        // ends with the one plugin line.
        PLUGIN_TIP,
      ].join('\n'),
    );
  });

  // internal D6. The tip is keyed on the harness ID and the outcome being ok,
  // not on installKind: Codex is also a cli-command harness and must not get
  // a Claude Code plugin tip.
  function reportFor(outcomes: RunReport['outcomes']): RunReport {
    return {
      url: 'https://ai.levr.now/api/v1/mcp',
      urlSource: 'default',
      scope: 'user',
      dryRun: false,
      outcomes,
      unknownClients: [],
    };
  }
  const okCommand = (id: string, label: string) => ({
    id,
    label,
    result: {
      ok: true,
      wrote: false,
      path: '',
      command: `${id} mcp add levr URL`,
      executed: true,
      alreadyConfigured: false,
      dryRun: false,
      scope: 'user' as const,
    },
  });

  it('prints the plugin tip once for claude-code', () => {
    const out = formatReport(
      reportFor([
        okCommand('claude-code', 'Claude Code'),
        // A second Claude Code outcome (project + user scope in one run) must
        // not print the tip twice.
        okCommand('claude-code', 'Claude Code'),
      ]),
    );
    expect(out.split('\n').filter((l) => l === PLUGIN_TIP)).toHaveLength(1);
    expect(out.endsWith(PLUGIN_TIP)).toBe(true);
    expect(PLUGIN_TIP).toContain('/plugin install levr@levr');
    expect(PLUGIN_TIP).toContain('BitModern/levr');
  });

  it('prints the tip when Claude Code was already configured', () => {
    // "Already set up" is still a Claude Code user who may not know the
    // plugin exists; the tip is about the plugin, not about this run.
    const already = okCommand('claude-code', 'Claude Code');
    already.result = { ...already.result, alreadyConfigured: true };
    expect(formatReport(reportFor([already]))).toContain(PLUGIN_TIP);
  });

  it('omits the plugin tip for other harnesses', () => {
    const out = formatReport(
      reportFor([
        okCommand('codex', 'Codex'),
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
      ]),
    );
    expect(out).not.toContain(PLUGIN_TIP);
    expect(out).not.toContain('/plugin install');
  });

  it('omits the plugin tip when the Claude Code install failed', () => {
    const failed = okCommand('claude-code', 'Claude Code');
    failed.result = { ...failed.result, ok: false, executed: false };
    expect(formatReport(reportFor([failed]))).not.toContain(PLUGIN_TIP);
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
    expect(autoSelectIds(detected, 'user', URL)).toEqual([]);
    // ...but project scope is still unconfigured, so it stays selected.
    expect(autoSelectIds(detected, 'project', URL)).toEqual(['cursor']);
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

  // internal: `claude mcp add` refused an entry the installer could not see.
  const alreadyExists = (): InstallResult =>
    cmdResult({
      ok: false,
      executed: true,
      command:
        'claude mcp add --transport http --scope user levr-beta https://x/mcp',
      commandError: 'MCP server levr-beta already exists in user config',
    });

  it('says how to recover when the client says the entry already exists', () => {
    const line = formatReport({
      ...report(alreadyExists()),
      entryName: 'levr-beta',
    });
    expect(line).toContain('Claude Code: failed');
    expect(line).toContain('--name <other>');
    expect(line).toContain('`claude mcp remove --scope user levr-beta`');
  });

  it('names the scope the client reports, not the one we asked for', () => {
    const line = formatReport({
      ...report(
        cmdResult({
          ok: false,
          executed: true,
          commandError: 'MCP server levr already exists in local config',
        }),
      ),
      entryName: 'levr',
    });
    expect(line).toContain('`claude mcp remove --scope local levr`');
  });

  it('adds no recovery hint to an unrelated command failure', () => {
    const line = formatReport(
      report(
        cmdResult({ ok: false, executed: true, commandError: 'not logged in' }),
      ),
    );
    expect(line).not.toContain('--name <other>');
  });

  it('does not tell the user to restart when nothing was installed', () => {
    const next = nextStepsText(report(alreadyExists()));
    expect(next).not.toContain('restart');
    expect(next).toBe('Nothing was installed.');
  });

  it('does not tell the user to restart for a refused url-mismatch', () => {
    const next = nextStepsText(
      report(
        cmdResult({
          ok: false,
          executed: false,
          reason: 'url-mismatch',
          currentUrl: 'https://other/mcp',
        }),
      ),
    );
    expect(next).not.toContain('restart');
  });

  it('does not tell the user to restart a client that was already set up', () => {
    expect(
      nextStepsText(
        report(cmdResult({ executed: false, alreadyConfigured: true })),
      ),
    ).toBe('Nothing to do.');
  });
});

describe('config-file failure and backup reporting (internal D5)', () => {
  function fileResult(over: Partial<InstallResult> = {}): InstallResult {
    return {
      ok: true,
      wrote: true,
      path: '/home/.codex/config.toml',
      alreadyConfigured: false,
      dryRun: false,
      scope: 'user',
      ...over,
    };
  }
  const report = (result: InstallResult, dryRun = false): RunReport => ({
    url: URL,
    urlSource: SOURCE,
    scope: 'user',
    outcomes: [{ id: 'codex', label: 'Codex CLI', result }],
    unknownClients: [],
    dryRun,
  });

  it('reports a refused config shape as a failure carrying the adapter detail', () => {
    const line = formatReport(
      report(
        fileResult({
          ok: false,
          wrote: false,
          reason: 'unsupported-config-shape',
          detail: 'mcp_servers.levr exists but not as a standalone table',
        }),
      ),
    );
    expect(line).toContain('Codex CLI: failed');
    expect(line).toContain('could not be edited safely');
    expect(line).toContain('not as a standalone table');
  });

  it('reports a filesystem refusal per client instead of aborting the run', () => {
    const line = formatReport(
      report(
        fileResult({
          ok: false,
          wrote: false,
          reason: 'write-failed',
          detail: 'EACCES: permission denied',
        }),
      ),
    );
    expect(line).toContain('Codex CLI: failed');
    expect(line).toContain('could not be written');
    expect(line).toContain('EACCES');
  });

  it('names the backup it took on a real write', () => {
    const line = formatReport(
      report(fileResult({ backupPath: '/home/.codex/config.toml.levr-bak' })),
    );
    expect(line).toContain(
      'original backed up to /home/.codex/config.toml.levr-bak',
    );
  });

  it('does not claim a backup on a dry run — nothing was copied', () => {
    const line = formatReport(
      report(
        fileResult({
          wrote: false,
          dryRun: true,
          backupPath: '/home/.codex/config.toml.levr-bak',
        }),
        true,
      ),
    );
    expect(line).toContain('dry run');
    expect(line).toContain('would be backed up to');
    expect(line).not.toContain('original backed up to');
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
    const atUser = clientChoices(detected, 'user', URL);
    expect(atUser.find((c) => c.value === 'cursor')?.hint).toBe(
      'already set up (user)',
    );
    // Same client, same machine, different scope — and it is NOT set up there.
    const atProject = clientChoices(detected, 'project', URL);
    expect(atProject.find((c) => c.value === 'cursor')?.hint).toBe('detected');
  });

  it('preselects on the chosen scope', () => {
    // Nothing to do at user; still work to do at project.
    expect(
      clientChoices(detected, 'user', URL).find((c) => c.value === 'cursor')
        ?.selected,
    ).toBe(false);
    expect(
      clientChoices(detected, 'project', URL).find((c) => c.value === 'cursor')
        ?.selected,
    ).toBe(true);
  });

  it('warns up front where a client that cannot do the scope will land', () => {
    // Better than a surprise fallback line after the install has happened.
    expect(
      clientChoices(detected, 'project', URL).find(
        (c) => c.value === 'windsurf',
      )?.hint,
    ).toBe('no project scope — will use user');
  });

  it('omits unavailable clients', () => {
    const rows = clientChoices(
      [...detected, det('zed', { available: false })],
      'user',
      URL,
    );
    expect(rows.map((r) => r.value)).toEqual(['cursor', 'windsurf']);
  });
});

describe('formatReport — entry refusals and replace outcomes (internal D6)', () => {
  const base = {
    wrote: false,
    path: '/fake/cursor.json',
    alreadyConfigured: false,
    dryRun: false,
    scope: 'user' as const,
  };
  function report(
    result: RunReport['outcomes'][number]['result'],
    switchCommand?: string,
  ): RunReport {
    return {
      url: 'https://ai.levr.one/api/v1/mcp/w/beta',
      urlSource: 'flag',
      scope: 'user',
      dryRun: false,
      outcomes: [{ id: 'cursor', label: 'Cursor', result }],
      unknownClients: [],
      ...(switchCommand ? { switchCommand } : {}),
    };
  }

  it('a URL mismatch names the current URL and the switch command', () => {
    const out = formatReport(
      report(
        {
          ...base,
          ok: false,
          reason: 'url-mismatch',
          currentUrl: 'https://ai.levr.one/api/v1/mcp/w/acme',
        },
        'levr mcp add --workspace beta --replace',
      ),
    );
    expect(out).toContain('(https://ai.levr.one/api/v1/mcp/w/acme)');
    expect(out).toContain('`levr mcp add --workspace beta --replace`');
  });

  it('an unrecognized entry says to remove it by hand, never to --replace', () => {
    const out = formatReport(
      report(
        { ...base, ok: false, reason: 'unrecognized-entry' },
        'levr mcp add --workspace beta --replace',
      ),
    );
    expect(out).toContain('remove it from the client');
    expect(out).not.toContain('--replace');
  });

  it('a failed replace that restored the old entry says only its URL came back', () => {
    const out = formatReport(
      report({
        ...base,
        ok: false,
        command: 'claude mcp remove … && claude mcp add …',
        commandError: 'bad url',
        replacedUrl: 'https://ai.levr.one/api/v1/mcp/w/acme',
        restored: true,
      }),
    );
    expect(out).toContain(
      'restored with its URL (https://ai.levr.one/api/v1/mcp/w/acme)',
    );
  });

  it('a failed restore says the client has no entry of that name now', () => {
    const out = formatReport(
      report({
        ...base,
        ok: false,
        command: 'claude mcp remove … && claude mcp add …',
        commandError: 'bad url',
        replacedUrl: 'https://ai.levr.one/api/v1/mcp/w/acme',
        restored: false,
        restoreError: 'still broken',
      }),
    );
    expect(out).toContain('could NOT be restored (still broken)');
  });
});

describe('entry state, beside names and conflicts (internal)', () => {
  const ACME = `${URL}/w/acme`;
  const BETA = `${URL}/w/beta`;

  it('entryState compares the entry against the URL being written', () => {
    expect(entryState(scopeState('user', true), URL)).toBe('absent');
    expect(entryState(scopeState('user', true, true, BETA), BETA)).toBe(
      'same-url',
    );
    expect(entryState(scopeState('user', true, true, ACME), BETA)).toBe(
      'other-url',
    );
    expect(entryState(scopeState('user', true, true, null), BETA)).toBe(
      'unrecognized',
    );
    expect(entryState(undefined, BETA)).toBe('absent');
  });

  it('autoSelectIds takes an entry on another URL, never an unreadable one', () => {
    const detected = [
      det('a', {
        installed: true,
        scopes: [scopeState('user', true, true, ACME)],
      }),
      det('b', {
        installed: true,
        scopes: [scopeState('user', true, true, BETA)],
      }),
      det('c', {
        installed: true,
        scopes: [scopeState('user', true, true, null)],
      }),
      det('d', { installed: true }),
    ];
    expect(autoSelectIds(detected, 'user', BETA)).toEqual(['a', 'd']);
  });

  it('besideName is <name>-<url_key>, never shortened, and absent when it cannot be used', () => {
    expect(besideName('levr', BETA)).toBe('levr-beta');
    expect(besideName('mine', BETA)).toBe('mine-beta');
    // No workspace in the URL: nothing to tell two entries apart by.
    expect(besideName('levr', URL)).toBeUndefined();
    // 30 is the limit; one more is refused rather than cut.
    expect(besideName('levr', `${URL}/w/${'a'.repeat(25)}`)).toBe(
      `levr-${'a'.repeat(25)}`,
    );
    expect(besideName('levr', `${URL}/w/${'a'.repeat(26)}`)).toBeUndefined();
    // A long --name leaves no room for the workspace: no beside name.
    expect(besideName('x'.repeat(30), BETA)).toBeUndefined();
    // Two long keys that share a prefix never collapse onto one name.
    expect(
      besideName('levr', `${URL}/w/bitmodern-engineering-team-a`),
    ).toBeUndefined();
    // A hand-written URL whose key is not a valid entry name.
    expect(besideName('levr', `${URL}/w/my%20ws.prod`)).toBeUndefined();
  });

  it('entryState: the beside entry holding this URL is already set up', () => {
    const s = { ...scopeState('user', true, true, ACME), besideUrl: BETA };
    expect(entryState(s, BETA)).toBe('beside');
    expect(entryState(s, ACME)).toBe('same-url');
    // Beside entry present, main entry gone: still set up, never re-added.
    expect(
      entryState({ ...scopeState('user', true), besideUrl: BETA }, BETA),
    ).toBe('beside');
    expect(
      autoSelectIds([det('a', { installed: true, scopes: [s] })], 'user', BETA),
    ).toEqual([]);
    expect(
      clientChoices(
        [det('a', { installed: true, scopes: [s] })],
        'user',
        BETA,
      )[0]?.hint,
    ).toBe('already set up as levr-beta (user)');
  });

  it('a refused install under its own name names that entry and never suggests the run-level switch', () => {
    const text = formatReport({
      url: BETA,
      urlSource: SOURCE,
      scope: 'user',
      outcomes: [
        {
          id: 'cursor',
          label: 'Cursor',
          entryName: 'levr-beta',
          result: {
            ok: false,
            wrote: false,
            path: '/fake/cursor.json',
            alreadyConfigured: false,
            dryRun: false,
            scope: 'user',
            reason: 'url-mismatch',
            currentUrl: `${URL}/w/beta2`,
          },
        },
        {
          id: 'claude-code',
          label: 'Claude Code',
          entryName: 'levr-beta',
          result: {
            ok: false,
            wrote: false,
            path: '/fake/.claude.json',
            alreadyConfigured: false,
            dryRun: false,
            scope: 'user',
            reason: 'url-mismatch',
            currentUrl: `${URL}/w/beta2`,
          },
        },
      ],
      unknownClients: [],
      dryRun: false,
      switchCommand: 'levr mcp add --workspace beta --replace',
      entryName: 'levr',
    });
    expect(text).toContain(
      'Cursor: failed [as levr-beta] — already configured',
    );
    expect(text).toContain(
      'remove the levr-beta entry from /fake/cursor.json, then re-run',
    );
    expect(text).toContain(
      'Claude Code: failed [as levr-beta] — already configured with a different URL' +
        ` (${URL}/w/beta2); remove it with \`claude mcp remove --scope user levr-beta\`, then re-run`,
    );
    expect(text).not.toContain('--replace');
  });

  it('entryConflicts lists only selected clients on another or an unreadable entry', () => {
    const detected = [
      det('a', {
        installed: true,
        scopes: [scopeState('user', true, true, ACME)],
      }),
      det('b', {
        installed: true,
        scopes: [scopeState('user', true, true, BETA)],
      }),
      det('c', {
        installed: true,
        scopes: [scopeState('user', true, true, null)],
      }),
      det('d', { installed: true }),
    ];
    expect(
      entryConflicts(['a', 'b', 'c', 'd'], detected, 'user', BETA, 'levr'),
    ).toEqual([
      {
        id: 'a',
        label: 'a',
        state: 'other-url',
        currentUrl: ACME,
        besideName: 'levr-beta',
      },
      { id: 'c', label: 'c', state: 'unrecognized', besideName: 'levr-beta' },
    ]);
    expect(entryConflicts(['b', 'd'], detected, 'user', BETA, 'levr')).toEqual(
      [],
    );
  });

  it('entryConflicts does not offer a beside name that already holds another entry', () => {
    const taken = (currentUrl: string | null, besideUrl?: string) =>
      det('a', {
        installed: true,
        scopes: [
          {
            ...scopeState('user', true, true, currentUrl),
            besideConfigured: true,
            ...(besideUrl ? { besideUrl } : {}),
          },
        ],
      });
    const first = (d: DetectedHarness) =>
      entryConflicts(['a'], [d], 'user', BETA, 'levr')[0];
    expect(first(taken(ACME))).not.toHaveProperty('besideName');
    expect(first(taken(ACME))).toHaveProperty('besideTaken', 'levr-beta');
    expect(first(taken(null))).not.toHaveProperty('besideName');
    expect(first(taken(ACME, `${URL}/w/gamma`))).not.toHaveProperty(
      'besideName',
    );
    // A URL naming no workspace has no beside name to offer or to call taken.
    const plain = entryConflicts(['a'], [taken(ACME)], 'user', URL, 'levr')[0];
    expect(plain).not.toHaveProperty('besideName');
    expect(plain).not.toHaveProperty('besideTaken');
    // Taken by this very workspace: that is "already set up beside it".
    expect(first(taken(ACME, BETA))).toMatchObject({
      state: 'beside',
      besideName: 'levr-beta',
    });
  });

  it('installSelected passes each client its own override, and the report names it', () => {
    const seen: unknown[] = [];
    const install: InstallFn = (h, url, dryRun, scope, override) => {
      seen.push(override);
      return fakeInstall(h, url, dryRun, scope);
    };
    const outcomes = installSelected(
      ['cursor', 'zed'],
      {
        mcpUrl: BETA,
        dryRun: false,
        scope: 'user',
        namedIds: new Set(),
        overrides: new Map([['cursor', { serverName: 'levr-beta' }]]),
      },
      install,
    );
    expect(seen).toEqual([{ serverName: 'levr-beta' }, undefined]);
    const text = formatReport({
      url: BETA,
      urlSource: SOURCE,
      scope: 'user',
      outcomes,
      unknownClients: [],
      dryRun: false,
      left: [{ id: 'windsurf', label: 'Windsurf', currentUrl: ACME }],
    });
    expect(text).toContain(
      'Cursor: installed (user) → /fake/cursor.json [as levr-beta]',
    );
    expect(text).not.toContain('Zed: installed (user) → /fake/zed.json [as');
    expect(text).toContain(
      'Windsurf: left as it was (points at workspace acme)',
    );
  });

  it('a report with only left clients is not "No clients selected"', () => {
    const report: RunReport = {
      url: BETA,
      urlSource: SOURCE,
      scope: 'user',
      outcomes: [],
      unknownClients: [],
      dryRun: false,
      left: [{ id: 'cursor', label: 'Cursor' }],
    };
    expect(formatReport(report)).toContain(
      'Cursor: left as it was (its levr entry holds no Levr URL)',
    );
    expect(formatReport(report)).not.toContain('No clients selected');
    expect(nextStepsText(report)).toBe('Nothing to do.');
  });

  it("a left client names the run's entry, and a taken beside name", () => {
    const text = formatReport({
      url: BETA,
      urlSource: SOURCE,
      scope: 'user',
      outcomes: [],
      unknownClients: [],
      dryRun: false,
      entryName: 'foo',
      left: [
        { id: 'cursor', label: 'Cursor' },
        {
          id: 'windsurf',
          label: 'Windsurf',
          currentUrl: ACME,
          besideTaken: 'foo-beta',
        },
      ],
    });
    expect(text).toContain(
      'Cursor: left as it was (its foo entry holds no Levr URL)',
    );
    expect(text).toContain(
      'Windsurf: left as it was (points at workspace acme; foo-beta is taken too, so add this one with --name <other>)',
    );
  });
});

describe('internal · real detection and the real installer agree', () => {
  // Win32 + an empty PATH: only Cursor (a config file) is detected, and no
  // client CLI can ever be spawned.
  const ACME = `${URL}/w/acme`;
  const BETA = `${URL}/w/beta`;
  let home: string;
  let env: HarnessEnv;
  const config = (): string => join(home, '.cursor', 'mcp.json');
  const entries = (): Record<string, { args: string[] }> =>
    (
      JSON.parse(readFileSync(config(), 'utf8')) as {
        mcpServers: Record<string, { args: string[] }>;
      }
    ).mcpServers;
  function realDeps(serverName = 'levr'): RunDeps {
    return {
      detect: (url) =>
        detectSync(env, {
          serverName,
          besideName: besideName(serverName, url),
        }),
      install: (harness, mcpUrl, dryRun, scope, override) =>
        installHarnessSync(harness, mcpUrl, {
          env,
          dryRun,
          scope,
          serverName: override?.serverName ?? serverName,
          replaceExisting: override?.replaceExisting ?? false,
        }),
    };
  }
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mcp-6736-'));
    env = { platform: 'win32', homedir: home, pathVar: '', cwd: home };
    mkdirSync(join(home, '.cursor'));
    writeFileSync(
      config(),
      JSON.stringify({
        mcpServers: {
          levr: { command: 'npx', args: ['-y', 'mcp-remote', ACME] },
        },
      }),
    );
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));
  const cursorOutcome = (r: RunReport) =>
    r.outcomes.find((o) => o.id === 'cursor');

  it('--yes for another workspace reaches the installer, which refuses, and changes nothing', () => {
    const r = runNonInteractive(
      options({ yes: true }),
      BETA,
      SOURCE,
      realDeps(),
    );
    expect(cursorOutcome(r)?.result).toMatchObject({
      ok: false,
      reason: 'url-mismatch',
      currentUrl: ACME,
    });
    expect(Object.keys(entries())).toEqual(['levr']);
  });

  it('--yes for the same workspace is skipped', () => {
    const r = runNonInteractive(
      options({ yes: true }),
      ACME,
      SOURCE,
      realDeps(),
    );
    expect(cursorOutcome(r)).toBeUndefined();
  });

  it('after "Add beside it", a --yes re-run recognises the beside entry', () => {
    const add = installSelected(
      ['cursor'],
      {
        mcpUrl: BETA,
        dryRun: false,
        scope: 'user',
        namedIds: new Set(),
        overrides: new Map([['cursor', { serverName: 'levr-beta' }]]),
      },
      realDeps().install,
    );
    expect(add[0]?.result.ok).toBe(true);
    expect(entries()['levr-beta']?.args.at(-1)).toBe(BETA);

    const again = runNonInteractive(
      options({ yes: true }),
      BETA,
      SOURCE,
      realDeps(),
    );
    expect(cursorOutcome(again)).toBeUndefined();
    expect(Object.keys(entries()).sort()).toEqual(['levr', 'levr-beta']);
  });
});
