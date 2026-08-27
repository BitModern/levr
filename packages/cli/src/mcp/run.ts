/**
 * `levr mcp add` core: detect → select → install, as pure/injectable
 * functions so the non-interactive path (`--client`/`--all`/`--yes`) is
 * fully unit-testable without a TTY. Absorbed from the retired
 * `create-testquality-mcp` initializer (internal); the interactive TUI
 * (addHandler.ts) reuses the same primitives.
 */
import {
  defaultScope,
  getHarness,
  HARNESS_SCOPES,
  supportedScopes,
  supportsScope,
  type DetectedHarness,
  type HarnessDef,
  type HarnessScope,
  type InstallResult,
} from '@levr/mcp-harnesses/node';

/**
 * Scope used when the caller passes no `--scope`.
 *
 * Uniform `user` for every harness (plan decision C1). A no-op for the
 * config-file clients — that is already where they write — but a change for
 * Claude Code, which previously inherited its OWN default of `local`. `user`
 * is the only default that means the same thing everywhere, and it matches
 * what someone running an installer once expects: available in every project.
 */
export const DEFAULT_SCOPE: HarnessScope = 'user';

/** Install a single harness. Injected so tests avoid touching the real FS. */
export type InstallFn = (
  harness: HarnessDef,
  mcpUrl: string,
  dryRun: boolean,
  scope: HarnessScope,
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
  /** Requested scope; `DEFAULT_SCOPE` when absent. */
  scope?: HarnessScope;
}

export interface InstalledOutcome {
  id: string;
  label: string;
  result: InstallResult;
  /**
   * Set when the harness could not honor the requested scope and we used its
   * own fallback instead. Never set for an explicitly-named client — those
   * fail rather than silently landing somewhere else.
   */
  fallbackFrom?: HarnessScope;
}

/** What to install, where, and which clients the user named by hand. */
export interface InstallPlan {
  mcpUrl: string;
  dryRun: boolean;
  scope: HarnessScope;
  /**
   * Ids the user named explicitly (`--client`). Naming a client AND a scope
   * asserts that pairing, so an unsupported combination is an error for these
   * — whereas a client swept in by `--all` or a multiselect falls back.
   */
  namedIds: ReadonlySet<string>;
}

export interface RunReport {
  url: string;
  urlSource: string;
  /** The scope the run asked for (individual outcomes may have fallen back). */
  scope: HarnessScope;
  outcomes: InstalledOutcome[];
  unknownClients: string[];
  comingSoonClients: string[];
  dryRun: boolean;
}

/** Harness ids to pre-select in interactive mode: detected + installable +
 * not-already-configured. "Already configured" is judged in the scope we are
 * about to install into, not the harness's default one. */
export function autoSelectIds(
  detected: DetectedHarness[],
  scope?: HarnessScope,
): string[] {
  return detected
    .filter((d) => {
      if (!d.available || d.comingSoon || !d.installed) return false;
      const inScope = scope
        ? d.scopes.find((s) => s.scope === scope)
        : undefined;
      // A harness that cannot do the requested scope is judged on its own
      // default, which is where the fallback would land it anyway.
      return !(inScope ? inScope.alreadyConfigured : d.alreadyConfigured);
    })
    .map((d) => d.id);
}

/** One row of the interactive client picker, resolved for a given scope. */
export interface ClientChoice {
  value: string;
  label: string;
  hint: string;
  /** Pre-ticked in the multiselect. */
  selected: boolean;
}

/**
 * Build the client picker for the scope we are actually about to install
 * into.
 *
 * Pure so it can be tested without a TTY — and it needs testing, because the
 * question it answers is scope-dependent: a client configured at `user` is
 * NOT configured at `project`, and labelling it "already set up" while
 * installing to `project` is simply wrong.
 */
export function clientChoices(
  detected: DetectedHarness[],
  scope: HarnessScope,
): ClientChoice[] {
  const preselect = new Set(autoSelectIds(detected, scope));
  return detected
    .filter((d) => d.available && !d.comingSoon)
    .map((d) => {
      const inScope = d.scopes.find((s) => s.scope === scope);
      const harness = getHarness(d.id);
      let hint: string;
      if (!inScope) {
        // Say up front where it will actually land, rather than surprising
        // the user with a fallback line in the results.
        const fallback = harness ? defaultScope(harness) : DEFAULT_SCOPE;
        hint = `no ${scope} scope — will use ${fallback}`;
      } else if (inScope.alreadyConfigured) {
        hint = `already set up (${scope})`;
      } else {
        hint = d.installed ? 'detected' : 'not detected';
      }
      return {
        value: d.id,
        label: d.label,
        hint,
        selected: preselect.has(d.id),
      };
    });
}

/** Scopes worth offering for a selection: any scope at least one selected
 * client can actually use here. Availability already accounts for "are we
 * inside a repo", so project scope disappears outside one. */
export function offerableScopes(
  selectedIds: string[],
  detected: DetectedHarness[],
): HarnessScope[] {
  return HARNESS_SCOPES.filter((scope) =>
    selectedIds.some((id) =>
      detected
        .find((d) => d.id === id)
        ?.scopes.some((s) => s.scope === scope && s.available),
    ),
  );
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

/**
 * Install each selected id, collecting structured outcomes.
 *
 * The unsupported-scope policy lives here, and it turns on HOW the client was
 * selected — that is what says whether the user asserted this pairing:
 *
 * - named via `--client` → install at the requested scope and let it fail,
 *   so the report says exactly what was refused and the run exits non-zero;
 * - swept in by `--all` or a multiselect → fall back to the harness's own
 *   scope and record `fallbackFrom`, so the report states what was used.
 *
 * A fallback is never silent.
 */
export function installSelected(
  ids: string[],
  plan: InstallPlan,
  install: InstallFn,
): InstalledOutcome[] {
  const outcomes: InstalledOutcome[] = [];
  for (const id of ids) {
    const harness = getHarness(id);
    if (!harness) continue;

    const canHonor = supportsScope(harness, plan.scope);
    const named = plan.namedIds.has(id);
    const effective = canHonor || named ? plan.scope : defaultScope(harness);

    outcomes.push({
      id,
      label: harness.label,
      result: install(harness, plan.mcpUrl, plan.dryRun, effective),
      ...(canHonor ? {} : named ? {} : { fallbackFrom: plan.scope }),
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
  const scope = options.scope ?? DEFAULT_SCOPE;

  let ids: string[];
  let unknown: string[] = [];
  let comingSoon: string[] = [];
  const byName = !options.all && (options.clients?.length ?? 0) > 0;
  if (options.all || byName) {
    const requested = resolveRequestedIds(options, detected);
    ids = requested.ids;
    unknown = requested.unknown;
    comingSoon = requested.comingSoon;
  } else {
    // `--yes` (or non-TTY) with no explicit selection: take what we detected.
    ids = autoSelectIds(detected, scope);
  }

  return {
    url,
    urlSource,
    scope,
    outcomes: installSelected(
      ids,
      {
        mcpUrl: url,
        dryRun: options.dryRun,
        scope,
        // Only a hand-named client asserts the pairing; `--all` does not.
        namedIds: new Set(byName ? ids : []),
      },
      deps.install,
    ),
    unknownClients: unknown,
    comingSoonClients: comingSoon,
    dryRun: options.dryRun,
  };
}

/** Why an install was refused, in the user's terms rather than the enum's. */
function failureText(o: InstalledOutcome): string {
  const r = o.result;
  const harness = getHarness(o.id);
  switch (r.reason) {
    case 'unsupported-scope':
      return (
        `no ${r.scope} scope` +
        (harness ? ` (supports: ${supportedScopes(harness).join(', ')})` : '')
      );
    case 'not-a-repo':
      return 'project scope needs a git repository (run from inside one)';
    case 'scope-collision':
      // The dotfiles-repo case: `git init` in $HOME makes the repo-relative
      // path and the user path the same file.
      return (
        `${r.scope} scope resolves to the same file as ` +
        `${r.collidesWith ?? 'another'} scope here — ` +
        'refusing rather than overwriting it'
      );
    case 'url-mismatch':
      // Its CLI will not repoint an existing entry, so an install we cannot
      // actually perform must not be reported as one.
      return (
        'already configured with a different URL' +
        (r.currentUrl ? ` (${r.currentUrl})` : '') +
        '; remove it first, then re-run'
      );
    default:
      // A command we ran that failed reports the client's own diagnostics.
      if (r.commandError) {
        return `\`${r.command}\` (${r.commandError})`;
      }
      return 'no config location on this platform';
  }
}

/** One human-readable status line per outcome. */
function outcomeLine(o: InstalledOutcome, dryRun: boolean): string {
  const r = o.result;
  // A fallback is always stated — never let a client land somewhere the user
  // did not ask for without saying so.
  const note = o.fallbackFrom
    ? ` [${o.fallbackFrom} scope unsupported — used ${r.scope}]`
    : '';
  const where = r.path ? ` → ${r.path}` : '';

  // Failure first: a refusal must never be dressed up as pending work, and
  // several refusals (url-mismatch, a failed command) carry a `command`.
  if (!r.ok) return `${o.label}: failed — ${failureText(o)}`;
  if (r.alreadyConfigured) {
    return `${o.label}: already set up (${r.scope})${where}${note}`;
  }
  if (r.command) {
    if (r.executed) {
      return `${o.label}: installed (${r.scope}) via \`${r.command}\`${note}`;
    }
    return `${o.label} (${r.scope}): run \`${r.command}\`${note}`;
  }
  if (dryRun) {
    return `${o.label}: would update (${r.scope})${where} (dry run — no changes)${note}`;
  }
  if (r.wrote) return `${o.label}: installed (${r.scope})${where}${note}`;
  return `${o.label}: no change (${r.scope})${where}${note}`;
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
    (o) => o.result.wrote || o.result.executed || o.result.command,
  );
  if (!didSomething) return 'Nothing to do.';
  const lines = [
    'Next: restart the client(s) above — each will prompt you to authorize',
    'Levr once in the browser. Then ask it: "What issues are assigned to me?"',
  ];
  // Project-scoped files are meant to be committed; say so rather than
  // touching the user's index for them.
  if (
    report.outcomes.some((o) => o.result.scope === 'project' && o.result.wrote)
  ) {
    lines.push(
      '',
      'Project-scoped config was written into this repository — commit it to',
      'share the Levr MCP with everyone who checks it out.',
    );
  }
  return lines.join('\n');
}
