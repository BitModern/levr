import {
  detectSync,
  installHarnessSync,
  type HarnessScope,
} from '@levr/mcp-harnesses/node';
import type { LocalContext } from '../../context.js';
import { resolveMcpUrl } from '../../mcp/url.js';
import {
  clientChoices,
  DEFAULT_SCOPE,
  formatReport,
  installSelected,
  nextStepsText,
  offerableScopes,
  runNonInteractive,
  type InstallFn,
  type RunDeps,
  type RunReport,
} from '../../mcp/run.js';

interface McpAddFlags {
  client?: string[];
  all: boolean;
  yes: boolean;
  'dry-run': boolean;
  scope?: HarnessScope;
  url?: string;
}

const defaultInstall: InstallFn = (harness, mcpUrl, dryRun, scope) =>
  installHarnessSync(harness, mcpUrl, { dryRun, scope });

const defaultDeps: RunDeps = {
  detect: () => detectSync(),
  install: defaultInstall,
};

export async function mcpAddHandler(
  this: LocalContext,
  flags: McpAddFlags,
): Promise<void> {
  // A bad --url / LEVR_MCP_URL is a user error, not a crash: report it the way
  // every other handler reports one rather than letting a stack trace out.
  let url: string;
  let source: string;
  try {
    ({ url, source } = resolveMcpUrl(flags.url));
  } catch (err) {
    this.logger.error(
      err instanceof Error ? err.message : 'Could not resolve the MCP URL.',
    );
    this.process.exitCode = 1;
    return;
  }

  const clients = (flags.client ?? []).flatMap((c) =>
    c
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const options = {
    all: flags.all,
    clients,
    yes: flags.yes,
    dryRun: flags['dry-run'],
    scope: flags.scope,
  };

  const explicitSelection = options.all || clients.length > 0;
  const nonInteractive =
    explicitSelection || options.yes || !process.stdout.isTTY;

  if (nonInteractive) {
    const report = runNonInteractive(options, url, source, defaultDeps);
    this.process.stdout.write(`${formatReport(report)}\n`);
    this.process.stdout.write(`\n${nextStepsText(report)}\n`);
    // CI-facing surface: a mistyped --client id or a real install failure
    // must not exit 0 (review F1). Legitimate no-ops (already configured,
    // nothing detected) stay success.
    if (report.unknownClients.length > 0 || hasFailure(report)) {
      this.process.exitCode = 1;
    }
    return;
  }

  await interactive(this, options.dryRun, url, source, flags.scope);
}

function hasFailure(report: RunReport): boolean {
  return report.outcomes.some((o) => !o.result.ok);
}

/** Human-readable meaning of each scope, for the interactive picker. */
const SCOPE_LABELS: Record<HarnessScope, { label: string; hint: string }> = {
  user: { label: 'user', hint: 'every project you open' },
  project: {
    label: 'project',
    hint: 'this repo, shared with your team via git',
  },
  local: { label: 'local', hint: 'this repo, only you' },
};

async function interactive(
  ctx: LocalContext,
  dryRun: boolean,
  url: string,
  urlSource: string,
  requestedScope?: HarnessScope,
): Promise<void> {
  const p = await import('@clack/prompts');

  p.intro('Levr MCP setup');
  p.note(`${url}\n(${urlSource})`, 'MCP endpoint');

  const detected = defaultDeps.detect();
  const installable = detected.filter((d) => d.available && !d.comingSoon);
  if (installable.length === 0) {
    p.outro('No supported MCP clients found on this machine.');
    return;
  }

  // Scope FIRST. The client rows say whether each client is already set up,
  // and that is only answerable once we know which scope we are installing
  // into — asking afterwards would label rows against the wrong scope.
  const choices = offerableScopes(
    installable.map((d) => d.id),
    detected,
  );
  let scope = requestedScope ?? DEFAULT_SCOPE;
  if (!requestedScope && choices.length > 1) {
    const picked = await p.select<HarnessScope>({
      message: 'Where should Levr be available?',
      options: choices.map((s) => ({
        value: s,
        label: SCOPE_LABELS[s].label,
        hint: SCOPE_LABELS[s].hint,
      })),
      initialValue: choices.includes(DEFAULT_SCOPE)
        ? DEFAULT_SCOPE
        : choices[0],
    });
    if (p.isCancel(picked)) {
      p.cancel('Cancelled.');
      ctx.process.exitCode = 1;
      return;
    }
    scope = picked;
  } else if (!requestedScope && choices.length === 1) {
    // One real option — asking would be a question with a single answer.
    scope = choices[0] ?? DEFAULT_SCOPE;
  }

  const rows = clientChoices(detected, scope);
  const selection = await p.multiselect<string>({
    message: `Select clients to set up (${scope} scope)`,
    options: rows.map((r) => ({
      value: r.value,
      label: r.label,
      hint: r.hint,
    })),
    initialValues: rows.filter((r) => r.selected).map((r) => r.value),
    required: false,
  });
  if (p.isCancel(selection)) {
    p.cancel('Cancelled.');
    ctx.process.exitCode = 1;
    return;
  }
  if (selection.length === 0) {
    p.outro('Nothing selected — bye.');
    return;
  }

  const spin = p.spinner();
  spin.start(dryRun ? 'Previewing changes' : 'Installing');
  const outcomes = installSelected(
    selection,
    {
      mcpUrl: url,
      dryRun,
      scope,
      // Interactively-picked clients were not asserted against this scope,
      // so an unsupported one falls back rather than failing the run.
      namedIds: new Set<string>(),
    },
    defaultDeps.install,
  );
  spin.stop(dryRun ? 'Preview ready' : 'Done');

  const report: RunReport = {
    url,
    urlSource,
    scope,
    outcomes,
    unknownClients: [],
    comingSoonClients: [],
    dryRun,
  };
  p.note(formatReport(report), 'Results');
  p.outro(nextStepsText(report));
  if (hasFailure(report)) {
    ctx.process.exitCode = 1;
  }
}
