/**
 * `levr mcp add` core: detect → select → install, as pure/injectable
 * functions so the non-interactive path (`--client`/`--all`/`--yes`) is
 * fully unit-testable without a TTY. Absorbed from the retired
 * `create-testquality-mcp` initializer (internal); the interactive TUI
 * (addHandler.ts) reuses the same primitives.
 */
import {
  getHarness,
  type DetectedHarness,
  type HarnessDef,
  type InstallResult,
} from '@levr/mcp-harnesses/node';

/** Install a single harness. Injected so tests avoid touching the real FS. */
export type InstallFn = (
  harness: HarnessDef,
  mcpUrl: string,
  dryRun: boolean,
) => InstallResult;

export interface RunDeps {
  detect: () => DetectedHarness[];
  install: InstallFn;
}

export interface McpAddOptions {
  all: boolean;
  clients?: string[];
  yes: boolean;
  dryRun: boolean;
}

export interface InstalledOutcome {
  id: string;
  label: string;
  result: InstallResult;
}

export interface RunReport {
  url: string;
  urlSource: string;
  outcomes: InstalledOutcome[];
  unknownClients: string[];
  comingSoonClients: string[];
  dryRun: boolean;
}

/** Harness ids to pre-select in interactive mode: detected + installable +
 * not-already-configured. */
export function autoSelectIds(detected: DetectedHarness[]): string[] {
  return detected
    .filter(
      (d) =>
        d.available && !d.comingSoon && d.installed && !d.alreadyConfigured,
    )
    .map((d) => d.id);
}

export interface RequestedSelection {
  ids: string[];
  unknown: string[];
  comingSoon: string[];
}

/** Resolve `--all` / `--client` into concrete, installable harness ids. */
export function resolveRequestedIds(
  options: Pick<McpAddOptions, 'all' | 'clients'>,
  detected: DetectedHarness[],
): RequestedSelection {
  if (options.all) {
    return {
      ids: detected
        .filter((d) => d.available && !d.comingSoon)
        .map((d) => d.id),
      unknown: [],
      comingSoon: [],
    };
  }

  const ids: string[] = [];
  const unknown: string[] = [];
  const comingSoon: string[] = [];
  for (const c of options.clients ?? []) {
    const harness = getHarness(c);
    if (!harness) unknown.push(c);
    else if (harness.comingSoon) comingSoon.push(c);
    else ids.push(c);
  }
  return { ids, unknown, comingSoon };
}

/** Install each selected id, collecting structured outcomes. */
export function installSelected(
  ids: string[],
  mcpUrl: string,
  dryRun: boolean,
  install: InstallFn,
): InstalledOutcome[] {
  const outcomes: InstalledOutcome[] = [];
  for (const id of ids) {
    const harness = getHarness(id);
    if (!harness) continue;
    outcomes.push({
      id,
      label: harness.label,
      result: install(harness, mcpUrl, dryRun),
    });
  }
  return outcomes;
}

/**
 * The non-interactive run: detect, pick ids from `--all`/`--client` (or
 * auto-select when only `--yes` is given), install, and return a structured
 * report. No console output — the caller formats it.
 */
export function runNonInteractive(
  options: McpAddOptions,
  url: string,
  urlSource: string,
  deps: RunDeps,
): RunReport {
  const detected = deps.detect();

  let ids: string[];
  let unknown: string[] = [];
  let comingSoon: string[] = [];
  if (options.all || (options.clients && options.clients.length > 0)) {
    const requested = resolveRequestedIds(options, detected);
    ids = requested.ids;
    unknown = requested.unknown;
    comingSoon = requested.comingSoon;
  } else {
    // `--yes` (or non-TTY) with no explicit selection: take what we detected.
    ids = autoSelectIds(detected);
  }

  return {
    url,
    urlSource,
    outcomes: installSelected(ids, url, options.dryRun, deps.install),
    unknownClients: unknown,
    comingSoonClients: comingSoon,
    dryRun: options.dryRun,
  };
}

/** One human-readable status line per outcome. */
function outcomeLine(o: InstalledOutcome, dryRun: boolean): string {
  const r = o.result;
  if (r.command) return `${o.label}: run \`${r.command}\``;
  if (!r.ok) return `${o.label}: failed (no config location on this platform)`;
  if (r.alreadyConfigured) return `${o.label}: already set up (${r.path})`;
  if (dryRun)
    return `${o.label}: would update ${r.path} (dry run — no changes)`;
  if (r.wrote) return `${o.label}: installed → ${r.path}`;
  return `${o.label}: no change (${r.path})`;
}

/** Render a report as a plain multi-line summary (used by the CLI + tests). */
export function formatReport(report: RunReport): string {
  const lines: string[] = [];
  lines.push(`MCP URL: ${report.url} (${report.urlSource})`);
  if (report.outcomes.length === 0) {
    lines.push('No clients selected.');
  } else {
    for (const o of report.outcomes) lines.push(outcomeLine(o, report.dryRun));
  }
  if (report.unknownClients.length > 0) {
    lines.push(
      `Unknown clients (skipped): ${report.unknownClients.join(', ')}`,
    );
  }
  if (report.comingSoonClients.length > 0) {
    lines.push(`Coming soon (skipped): ${report.comingSoonClients.join(', ')}`);
  }
  return lines.join('\n');
}

/** Next-steps blurb after a run. */
export function nextStepsText(report: RunReport): string {
  if (report.dryRun) {
    return 'Dry run — re-run without --dry-run to apply these changes.';
  }
  const didSomething = report.outcomes.some(
    (o) => o.result.wrote || o.result.command,
  );
  if (!didSomething) return 'Nothing to do.';
  return [
    'Next: restart the client(s) above — each will prompt you to authorize',
    'Levr once in the browser. Then ask it: "What issues are assigned to me?"',
  ].join('\n');
}
