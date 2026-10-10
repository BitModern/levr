/**
 * `levr mcp add` core: detect → select → install, as pure/injectable
 * functions so the non-interactive path (`--client`/`--all`/`--yes`) is
 * fully unit-testable without a TTY. Absorbed from the retired
 * `create-testquality-mcp` initializer (internal); the interactive TUI
 * (addHandler.ts) reuses the same primitives.
 */
import {
  DEFAULT_SERVER_NAME,
  defaultScope,
  getHarness,
  HARNESS_SCOPES,
  supportedScopes,
  supportsScope,
  type DetectedHarness,
  type DetectedScope,
  type HarnessDef,
  type HarnessScope,
  type InstallResult,
} from '@levr/mcp-harnesses/node';
import { workspaceKeyOf } from './url.js';

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

/**
 * What one client is told about its entry when it differs from the run's
 * (`--name`, `--replace`): the answer to "Switch it" or "Add beside it".
 */
export interface EntryOverride {
  serverName?: string;
  replaceExisting?: boolean;
}

/** Install a single harness. Injected so tests avoid touching the real FS. */
export type InstallFn = (
  harness: HarnessDef,
  mcpUrl: string,
  dryRun: boolean,
  scope: HarnessScope,
  override?: EntryOverride,
) => InstallResult;

export interface RunDeps {
  /** Detection for the URL about to be written (it names the beside entry). */
  detect: (url: string) => DetectedHarness[];
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
  /** Set when this client was written under another name than the run's. */
  entryName?: string;
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
  /** Per-client answers to "Switch it / Add beside it" (internal). */
  overrides?: ReadonlyMap<string, EntryOverride>;
}

/** A client the user chose to leave pointing where it points (internal). */
export interface LeftClient {
  id: string;
  label: string;
  currentUrl?: string;
  /** The beside name, when "Add beside it" was not offered because it is taken. */
  besideTaken?: string;
}

export interface RunReport {
  url: string;
  urlSource: string;
  /** The scope the run asked for (individual outcomes may have fallen back). */
  scope: HarnessScope;
  outcomes: InstalledOutcome[];
  unknownClients: string[];
  dryRun: boolean;
  /**
   * The command that switches an entry refused for pointing elsewhere
   * (`… --replace`), so the refusal can say exactly what to run (internal D6).
   */
  switchCommand?: string;
  /** The entry name the run wrote under (`--name`, else `levr`). */
  entryName?: string;
  /** Clients left as they were, by choice, so the results still name them. */
  left?: LeftClient[];
}

/**
 * What a client holds under the entry name, against the URL we are about to
 * write: nothing, this URL, this URL under the beside name (an earlier "Add
 * beside it"), another URL (another workspace or server), or an entry with no
 * URL we can read.
 */
export type EntryState =
  | 'absent'
  | 'same-url'
  | 'beside'
  | 'other-url'
  | 'unrecognized';

export function entryState(
  s: DetectedScope | undefined,
  url: string,
): EntryState {
  // Exact, as the installer compares: anything else is not "already set up".
  if (s?.alreadyConfigured && s.currentUrl === url) return 'same-url';
  // Set up already, beside the first entry: adding it again under the main
  // name would show every tool twice, and refusing it would fail a re-run.
  if (s?.besideUrl === url) return 'beside';
  if (!s?.alreadyConfigured) return 'absent';
  return s.currentUrl === undefined ? 'unrecognized' : 'other-url';
}

/**
 * Allowed client entry names: 1-64 of `A-Za-z0-9_-`, and never starting with
 * `-`. The name is passed as an argv element to the client's own CLI
 * (`claude mcp add … <name> <url>`), so a leading `-` would be read there as a
 * flag — the internal argument-injection family.
 */
const ENTRY_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidEntryName(name: string): boolean {
  return ENTRY_NAME.test(name) && !name.startsWith('-');
}

/**
 * The scope an install would land in: the requested one, or, for a harness
 * that cannot do it, its own default, which is where the fallback goes.
 */
function landingScope(
  d: DetectedHarness,
  scope?: HarnessScope,
): DetectedScope | undefined {
  const inScope = scope ? d.scopes.find((s) => s.scope === scope) : undefined;
  if (inScope) return inScope;
  const harness = getHarness(d.id);
  return harness
    ? d.scopes.find((s) => s.scope === defaultScope(harness))
    : undefined;
}

/** Where an entry points, in the user's terms: the workspace, else the URL. */
export function describeTarget(url: string): string {
  const key = workspaceKeyOf(url);
  return key ? `workspace ${key}` : url;
}

/**
 * Harness ids to pre-select in interactive mode, and to take under `--yes`:
 * detected + installable + not already set up for THIS url. Judged in the
 * scope we are about to install into, not the harness's default one.
 *
 * An entry pointing at another URL is selected (internal): it is not set up
 * for the workspace asked for, and skipping it would report success while
 * leaving the client on the old one. Interactively the user is then asked
 * what to do with it; under `--yes` the installer refuses it (url-mismatch,
 * exit 1) unless `--replace` or `--name` was given. An entry with no URL we
 * can read is someone else's, and is never picked on the user's behalf.
 */
export function autoSelectIds(
  detected: DetectedHarness[],
  scope: HarnessScope | undefined,
  url: string,
): string[] {
  return detected
    .filter((d) => {
      if (!d.available || !d.installed) return false;
      const state = entryState(landingScope(d, scope), url);
      return state === 'absent' || state === 'other-url';
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
  url: string,
  serverName: string = DEFAULT_SERVER_NAME,
): ClientChoice[] {
  const preselect = new Set(autoSelectIds(detected, scope, url));
  const beside = besideName(serverName, url);
  return detected
    .filter((d) => d.available)
    .map((d) => {
      const inScope = d.scopes.find((s) => s.scope === scope);
      const harness = getHarness(d.id);
      let hint: string;
      if (!inScope) {
        // Say up front where it will actually land, rather than surprising
        // the user with a fallback line in the results.
        const fallback = harness ? defaultScope(harness) : DEFAULT_SCOPE;
        hint = `no ${scope} scope — will use ${fallback}`;
      } else if (entryState(inScope, url) === 'same-url') {
        hint = `already set up (${scope})`;
      } else if (entryState(inScope, url) === 'beside') {
        hint = `already set up as ${beside ?? 'a second entry'} (${scope})`;
      } else if (inScope.currentUrl !== undefined) {
        hint = `points at ${describeTarget(inScope.currentUrl)} (${scope})`;
      } else if (inScope.alreadyConfigured) {
        hint = `its ${serverName} entry holds no Levr URL (${scope})`;
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

/** A selected client whose entry points elsewhere, and what may be done. */
export interface EntryConflict {
  id: string;
  label: string;
  /** `beside`: already set up under the beside name; nothing to ask. */
  state: 'other-url' | 'unrecognized' | 'beside';
  currentUrl?: string;
  /** The name "Add beside it" would use; absent when there is none to offer. */
  besideName?: string;
  /** That name, when it is not offered because another entry already has it. */
  besideTaken?: string;
}

/** Claude Code tool names are `mcp__<entry>__<tool>`; keep that well short. */
const BESIDE_NAME_MAX = 30;

/**
 * The name for a second entry beside `serverName`: `<serverName>-<url_key>`,
 * so it says which workspace it is. Undefined — and "Add beside it" is not
 * offered — when the target URL names no workspace, or when that name would
 * be too long or not a valid entry name. It is never shortened: a cut name
 * could drop the workspace, or give two workspaces the same entry.
 */
export function besideName(
  serverName: string,
  url: string,
): string | undefined {
  const key = workspaceKeyOf(url);
  if (!key) return undefined;
  const name = `${serverName}-${key}`;
  return name.length <= BESIDE_NAME_MAX && isValidEntryName(name)
    ? name
    : undefined;
}

/**
 * The selected clients whose entry is not this URL's: each needs a decision —
 * switch it, add beside it, or leave it — before anything is installed
 * (internal). A client already set up beside it is listed too, as `beside`,
 * so it is installed under that name (and reads as already set up) rather
 * than refused under the main one. Pure, so it is testable without a TTY.
 */
export function entryConflicts(
  selection: readonly string[],
  detected: DetectedHarness[],
  scope: HarnessScope,
  url: string,
  serverName: string,
): EntryConflict[] {
  const conflicts: EntryConflict[] = [];
  const beside = besideName(serverName, url);
  for (const id of selection) {
    const d = detected.find((x) => x.id === id);
    if (!d) continue;
    const landing = landingScope(d, scope);
    const state = entryState(landing, url);
    if (state === 'absent' || state === 'same-url') continue;
    // A beside name already holding something else is not offered: adding
    // there could only be refused.
    const offer = state === 'beside' || !landing?.besideConfigured;
    conflicts.push({
      id,
      label: d.label,
      state,
      ...(landing?.currentUrl ? { currentUrl: landing.currentUrl } : {}),
      ...(beside && offer ? { besideName: beside } : {}),
      ...(beside && !offer ? { besideTaken: beside } : {}),
    });
  }
  return conflicts;
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
}

/** Resolve `--all` / `--client` into concrete, installable harness ids. */
export function resolveRequestedIds(
  options: Pick<McpAddOptions, 'all' | 'clients'>,
  detected: DetectedHarness[],
): RequestedSelection {
  if (options.all) {
    return {
      ids: detected.filter((d) => d.available).map((d) => d.id),
      unknown: [],
    };
  }

  const ids: string[] = [];
  const unknown: string[] = [];
  for (const c of options.clients ?? []) {
    const harness = getHarness(c);
    if (!harness) unknown.push(c);
    else ids.push(c);
  }
  return { ids, unknown };
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
    const override = plan.overrides?.get(id);

    outcomes.push({
      id,
      label: harness.label,
      result: install(harness, plan.mcpUrl, plan.dryRun, effective, override),
      ...(canHonor ? {} : named ? {} : { fallbackFrom: plan.scope }),
      ...(override?.serverName ? { entryName: override.serverName } : {}),
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
  const detected = deps.detect(url);
  const scope = options.scope ?? DEFAULT_SCOPE;

  let ids: string[];
  let unknown: string[] = [];
  const byName = !options.all && (options.clients?.length ?? 0) > 0;
  if (options.all || byName) {
    const requested = resolveRequestedIds(options, detected);
    ids = requested.ids;
    unknown = requested.unknown;
  } else {
    // `--yes` (or non-TTY) with no explicit selection: take what we detected.
    ids = autoSelectIds(detected, scope, url);
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
    dryRun: options.dryRun,
  };
}

/** Why an install was refused, in the user's terms rather than the enum's. */
function failureText(
  o: InstalledOutcome,
  switchCommand?: string,
  entryName?: string,
): string {
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
        (switchCommand
          ? `; run \`${switchCommand}\` to switch it, or add --name <other> to keep both`
          : `; ${removeHow(o, entryName)}, then re-run`)
      );
    case 'unrecognized-entry':
      // Not a URL entry we wrote or can read, so it is never replaced on a
      // guess — and --replace would refuse it too.
      return (
        'an entry of that name already exists but holds no Levr URL we can read; ' +
        "remove it from the client's config by hand, or add this one with --name <other>"
      );
    case 'write-failed':
      // The document was fine; the filesystem refused. The atomic write left
      // the original intact, so this is a per-client failure, not a crash.
      return (
        `its config could not be written` +
        (r.detail ? ` (${r.detail})` : '') +
        `; check the file's permissions and re-run`
      );
    case 'unsupported-config-shape':
      // The file is there and we will not guess at it — it may hold everything
      // else the user configured for this client. Hand them the snippet path.
      return (
        `its config could not be edited safely` +
        (r.detail ? ` (${r.detail})` : '') +
        `; fix the file or add the entry by hand`
      );
    default:
      // A command we ran that failed reports the client's own diagnostics.
      if (r.commandError) {
        return (
          `\`${r.command}\` (${r.commandError})${restoreText(r)}` +
          alreadyExistsHint(o, r.commandError, entryName)
        );
      }
      return 'no config location on this platform';
  }
}

/**
 * The client's CLI refused because the entry already exists, in a config the
 * installer did not read — otherwise it would have reported already set up,
 * or a url-mismatch naming --replace. --replace cannot reach an entry it
 * cannot see, so the way out is another name, or removing that entry with the
 * client's own CLI (internal).
 */
function alreadyExistsHint(
  o: InstalledOutcome,
  commandError: string,
  entryName?: string,
): string {
  if (!/already exists/i.test(commandError)) return '';
  const name = entryName ?? DEFAULT_SERVER_NAME;
  // The scope the client names ("… already exists in local config"), which
  // need not be the scope we asked for; ours when it names none.
  const scope =
    /already exists in (user|project|local) config/i
      .exec(commandError)?.[1]
      ?.toLowerCase() ?? o.result.scope;
  const remove =
    o.id === 'claude-code'
      ? `\`claude mcp remove --scope ${scope} ${name}\``
      : "the client's own CLI";
  return (
    `; to keep it, add this one beside it with --name <other>; ` +
    `to switch it, remove it with ${remove} and re-run`
  );
}

/**
 * Where to remove an entry by hand: the exact command for Claude Code, else
 * the config file it sits in (internal).
 */
function removeHow(o: InstalledOutcome, entryName?: string): string {
  const name = entryName ?? DEFAULT_SERVER_NAME;
  const r = o.result;
  if (o.id === 'claude-code')
    return `remove it with \`claude mcp remove --scope ${r.scope} ${name}\``;
  return r.path
    ? `remove the ${name} entry from ${r.path}`
    : `remove the ${name} entry from the client's config`;
}

/** What happened to the entry a failed `--replace` removed (internal D6). */
function restoreText(r: InstallResult): string {
  if (r.restored === undefined) return '';
  if (r.restored) {
    return `; the previous entry was restored with its URL (${r.replacedUrl}) — any other settings it had were not`;
  }
  return (
    `; the previous entry (${r.replacedUrl}) could NOT be restored` +
    (r.restoreError ? ` (${r.restoreError})` : '') +
    ' — this client has no Levr entry of that name now'
  );
}

/** One human-readable status line per outcome. */
function outcomeLine(
  o: InstalledOutcome,
  dryRun: boolean,
  switchCommand?: string,
  entryName?: string,
): string {
  const r = o.result;
  // A fallback is always stated — never let a client land somewhere the user
  // did not ask for without saying so.
  const note =
    (o.entryName ? ` [as ${o.entryName}]` : '') +
    (o.fallbackFrom
      ? ` [${o.fallbackFrom} scope unsupported — used ${r.scope}]`
      : '');
  const where = r.path ? ` → ${r.path}` : '';
  // A format that keeps far more than our entry in one file (TOML) gets a
  // one-shot backup of the original; the user is told where, before and after.
  // On a dry run the backup is only where it WOULD go — nothing was copied.
  const backup = r.backupPath
    ? dryRun
      ? ` [original would be backed up to ${r.backupPath}]`
      : ` [original backed up to ${r.backupPath}]`
    : '';
  const replaced = r.replacedUrl
    ? dryRun
      ? ` [would replace ${r.replacedUrl}]`
      : ` [replaced ${r.replacedUrl}]`
    : '';

  // Failure first: a refusal must never be dressed up as pending work, and
  // several refusals (url-mismatch, a failed command) carry a `command`.
  if (!r.ok) {
    // An entry written under its own name ("Add beside it") must not be told
    // to run the switch command: that targets the run's entry, the one the
    // user just chose to keep.
    if (o.entryName) {
      return `${o.label}: failed [as ${o.entryName}] — ${failureText(o, undefined, o.entryName)}`;
    }
    return `${o.label}: failed — ${failureText(o, switchCommand, entryName)}`;
  }
  if (r.alreadyConfigured) {
    return `${o.label}: already set up (${r.scope})${where}${note}`;
  }
  if (r.command) {
    if (r.executed) {
      return `${o.label}: installed (${r.scope}) via \`${r.command}\`${replaced}${note}`;
    }
    return `${o.label} (${r.scope}): run \`${r.command}\`${replaced}${note}`;
  }
  if (dryRun) {
    return `${o.label}: would update (${r.scope})${where} (dry run — no changes)${backup}${replaced}${note}`;
  }
  if (r.wrote)
    return `${o.label}: installed (${r.scope})${where}${backup}${replaced}${note}`;
  return `${o.label}: no change (${r.scope})${where}${note}`;
}

/** Render a report as a plain multi-line summary (used by the CLI + tests). */
export function formatReport(report: RunReport): string {
  const lines: string[] = [];
  lines.push(`MCP URL: ${report.url} (${report.urlSource})`);
  if (report.outcomes.length === 0 && (report.left ?? []).length === 0) {
    lines.push('No clients selected.');
  } else {
    for (const o of report.outcomes)
      lines.push(
        outcomeLine(o, report.dryRun, report.switchCommand, report.entryName),
      );
  }
  for (const l of report.left ?? []) {
    const why = l.currentUrl
      ? `points at ${describeTarget(l.currentUrl)}`
      : `its ${report.entryName ?? DEFAULT_SERVER_NAME} entry holds no Levr URL`;
    // Say why "Add beside it" was not there, and the way out.
    const taken = l.besideTaken
      ? `; ${l.besideTaken} is taken too, so add this one with --name <other>`
      : '';
    lines.push(`${l.label}: left as it was (${why}${taken})`);
  }
  if (report.unknownClients.length > 0) {
    lines.push(
      `Unknown clients (skipped): ${report.unknownClients.join(', ')}`,
    );
  }
  // internal D6: exactly one line, once per report, only when Claude Code
  // was set up (ok, whether written now or already configured). The plugin
  // is the richer path there — the same server plus /levr:work, /levr:file
  // and /levr:done — and this is the one place a terminal user learns it
  // exists. Never for other harnesses, and no plugin detection: Claude Code
  // de-duplicates a same-URL plugin server against this entry on its own.
  if (report.outcomes.some((o) => o.id === 'claude-code' && o.result.ok)) {
    lines.push(PLUGIN_TIP);
  }
  return lines.join('\n');
}

/** The one note about the Claude Code plugin (internal D6). */
export const PLUGIN_TIP =
  'Tip: the Levr plugin adds /levr:work, /levr:file and /levr:done. Run /plugin install levr@levr in Claude Code (marketplace: BitModern/levr).';

/** Next-steps blurb after a run. */
export function nextStepsText(report: RunReport): string {
  if (report.dryRun) {
    return 'Dry run — re-run without --dry-run to apply these changes.';
  }
  // Only a client that now has a new entry needs restarting. A refused or
  // failed install carries a `command` too, and must not be told to restart
  // and authorize when nothing changed (internal).
  const didSomething = report.outcomes.some(
    (o) =>
      o.result.ok &&
      !o.result.alreadyConfigured &&
      (o.result.wrote || o.result.executed || o.result.command),
  );
  if (!didSomething) {
    return report.outcomes.some((o) => !o.result.ok)
      ? 'Nothing was installed.'
      : 'Nothing to do.';
  }
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
