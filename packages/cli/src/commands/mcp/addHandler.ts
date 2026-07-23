import { detectSync, installHarnessSync } from '@levr/mcp-harnesses/node';
import type { LocalContext } from '../../context.js';
import { resolveMcpUrl } from '../../mcp/url.js';
import {
  autoSelectIds,
  formatReport,
  installSelected,
  nextStepsText,
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
  url?: string;
}

const defaultInstall: InstallFn = (harness, mcpUrl, dryRun) =>
  installHarnessSync(harness, mcpUrl, { dryRun });

const defaultDeps: RunDeps = {
  detect: () => detectSync(),
  install: defaultInstall,
};

export async function mcpAddHandler(
  this: LocalContext,
  flags: McpAddFlags,
): Promise<void> {
  const { url, source } = resolveMcpUrl(flags.url);

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

  await interactive(this, options.dryRun, url, source);
}

function hasFailure(report: RunReport): boolean {
  return report.outcomes.some((o) => !o.result.ok);
}

async function interactive(
  ctx: LocalContext,
  dryRun: boolean,
  url: string,
  urlSource: string,
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

  const preselect = new Set(autoSelectIds(detected));
  const selection = await p.multiselect<string>({
    message: 'Select clients to set up',
    options: installable.map((d) => ({
      value: d.id,
      label: d.label,
      hint: d.alreadyConfigured
        ? 'already set up'
        : d.installed
          ? 'detected'
          : 'not detected',
    })),
    initialValues: installable
      .filter((d) => preselect.has(d.id))
      .map((d) => d.id),
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
  const outcomes = installSelected(selection, url, dryRun, defaultDeps.install);
  spin.stop(dryRun ? 'Preview ready' : 'Done');

  const report: RunReport = {
    url,
    urlSource,
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
