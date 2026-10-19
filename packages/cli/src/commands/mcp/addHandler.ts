import {
  DEFAULT_SERVER_NAME,
  detectSync,
  getHarness,
  installHarnessSync,
  LEVR_PREAPPROVED_TOOL_DESCRIPTIONS,
  preapproveTools,
  type HarnessDef,
  type HarnessScope,
  type PreapproveResult,
} from '@levr/mcp-harnesses/node';
import { resolveToken } from '../../auth/resolve-token.js';
import type { LocalContext } from '../../context.js';
import {
  isScopedMcpUrl,
  resolveMcpUrl,
  scopedMcpUrl,
  servedBySessionApi,
} from '../../mcp/url.js';
import { getApiUrl } from '../../utils/env.js';
import { configureClient } from '../../utils/sdk-client.js';
import {
  describeWorkspaces,
  findWorkspaceByKeyOrName,
  type WorkspaceSite,
} from '../../workspace/find-workspace.js';
import { fetchSites } from '../../workspace/resolve-workspace.js';
import {
  besideName,
  clientChoices,
  DEFAULT_SCOPE,
  describeTarget,
  entryConflicts,
  formatReport,
  installSelected,
  isValidEntryName,
  nextStepsText,
  offerableScopes,
  runNonInteractive,
  type EntryOverride,
  type InstallFn,
  type LeftClient,
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
  /** Stricli fills its `false` default; optional for direct callers. */
  'preapprove-tools'?: boolean;
  workspace?: string;
  name?: string;
  replace?: boolean;
}

/** What the installer is told about the entry (internal D6). */
interface EntryOptions {
  serverName: string;
  /** Explicit: an entry pointing elsewhere is refused unless this is true. */
  replaceExisting: boolean;
}

function depsFor(entry: EntryOptions): RunDeps {
  const install: InstallFn = (harness, mcpUrl, dryRun, scope, override) =>
    installHarnessSync(harness, mcpUrl, {
      dryRun,
      scope,
      serverName: override?.serverName ?? entry.serverName,
      replaceExisting: override?.replaceExisting ?? entry.replaceExisting,
    });
  // Detection reads the entry under the name we are about to write, so
  // `--name levr-beta` is judged on levr-beta, not on levr (internal).
  return {
    detect: (url) =>
      detectSync(undefined, {
        serverName: entry.serverName,
        besideName: besideName(entry.serverName, url),
      }),
    install,
  };
}

type SitesLoad =
  | { ok: true; sites: WorkspaceSite[] }
  | { ok: false; error: string };

/**
 * The login that makes `--workspace <x>` work. With the hint, the login
 * skips the workspace picker for that workspace and selects it (internal).
 * Double quotes: the one quoting POSIX shells and cmd.exe both take.
 */
export function loginCommandFor(workspace?: string): string {
  if (workspace === undefined) return 'levr auth login';
  const word = /^[A-Za-z0-9_.@:/-]+$/.test(workspace)
    ? workspace
    : `"${workspace.replace(/"/g, '\\"')}"`;
  return `levr auth login --workspace ${word}`;
}

/**
 * The workspaces of the logged-in user. Reads the session only; it never
 * reads or changes the workspace the CLI has selected. `workspace` is the
 * `--workspace` value, for the refusal to name the exact login to run.
 */
async function loadSites(workspace?: string): Promise<SitesLoad> {
  let auth;
  try {
    auth = await resolveToken();
  } catch (err) {
    // The cause stays (a server mismatch, an expired session); the hint
    // adds the login that will pin this entry.
    const cause =
      err instanceof Error
        ? err.message
        : "Not authenticated. Run 'levr auth login' first.";
    if (workspace === undefined) return { ok: false, error: cause };
    // The generic no-credentials message offers LEVR_TOKEN as the other way
    // in, but --workspace refuses a PAT (below), so that way is not open.
    const forWorkspace = cause.replace(
      ' or set LEVR_TOKEN environment variable',
      '',
    );
    return {
      ok: false,
      error: `${forWorkspace}\nTo pin this entry, log in naming the workspace: ${loginCommandFor(workspace)} (add --device-code on a headless machine), then re-run this command.`,
    };
  }
  if (auth.type === 'pat') {
    return {
      ok: false,
      error: `--workspace needs a login session, not a personal access token. Run '${loginCommandFor(workspace)}'.`,
    };
  }
  configureClient(auth);
  try {
    return { ok: true, sites: await fetchSites() };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : 'Could not list your workspaces.',
    };
  }
}

/**
 * The same `levr mcp add` run with `--replace`, for refusals: every flag the
 * user passed is kept, so the suggestion targets the same server, scope and
 * clients, and the workspace that was actually chosen.
 */
function switchCommandFor(flags: McpAddFlags, urlKey?: string): string {
  const parts = ['levr mcp add'];
  if (flags.all) parts.push('--all');
  for (const client of flags.client ?? []) parts.push(`--client ${client}`);
  if (flags.yes) parts.push('--yes');
  if (flags.scope) parts.push(`--scope ${flags.scope}`);
  if (flags.url) parts.push(`--url ${flags.url}`);
  const workspace = urlKey ?? flags.workspace;
  if (workspace) parts.push(`--workspace ${workspace}`);
  if (flags.name) parts.push(`--name ${flags.name}`);
  parts.push('--replace');
  return parts.join(' ');
}

export async function mcpAddHandler(
  this: LocalContext,
  flags: McpAddFlags,
): Promise<void> {
  // Validated before anything is read or written: the name reaches a
  // spawned CLI as an argument.
  const serverName = flags.name ?? DEFAULT_SERVER_NAME;
  if (!isValidEntryName(serverName)) {
    this.logger.error(
      `Invalid --name ${JSON.stringify(serverName)}: use 1-64 letters, digits, "-" or "_", not starting with "-".`,
    );
    this.process.exitCode = 1;
    return;
  }
  const entry: EntryOptions = {
    serverName,
    replaceExisting: flags.replace ?? false,
  };

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

  // --workspace: fail_closed. Not logged in, an unknown or ambiguous
  // workspace, or a URL that already names one all exit 1 with nothing written.
  let urlKey: string | undefined;
  if (flags.workspace !== undefined) {
    if (isScopedMcpUrl(url)) {
      this.logger.error(
        `The MCP URL ${url} already names a workspace. Drop --workspace, or pass the URL without its /w/<url_key> suffix.`,
      );
      this.process.exitCode = 1;
      return;
    }
    if (!servedBySessionApi(url)) {
      this.logger.error(
        `--workspace looks workspaces up on ${getApiUrl()}, where you are logged in, but the MCP URL ${url} is on another server. Log in to that server (LEVR_URL=<its API> levr auth login), or drop --workspace.`,
      );
      this.process.exitCode = 1;
      return;
    }
    const loaded = await loadSites(flags.workspace);
    if (!loaded.ok) {
      this.logger.error(loaded.error);
      this.process.exitCode = 1;
      return;
    }
    let site: WorkspaceSite;
    try {
      site = findWorkspaceByKeyOrName(loaded.sites, flags.workspace);
    } catch (err) {
      this.logger.error(
        err instanceof Error ? err.message : 'Unknown workspace.',
      );
      this.process.exitCode = 1;
      return;
    }
    urlKey = site.workspace_url_key;
    url = scopedMcpUrl(url, urlKey);
    source = `${source}, workspace ${site.workspace_name}`;
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
    const report = {
      ...runNonInteractive(options, url, source, depsFor(entry)),
      switchCommand: switchCommandFor(flags, urlKey),
      entryName: entry.serverName,
    };
    this.process.stdout.write(`${formatReport(report)}\n`);
    // fail_fallback(unscoped + note): nobody is there to ask which workspace,
    // so the unpinned URL is written and the choices are printed — only when
    // they are the choices of the server this URL is on.
    if (!isScopedMcpUrl(url) && servedBySessionApi(url)) {
      const hint = await workspaceHint();
      if (hint) this.process.stdout.write(`\n${hint}\n`);
    }
    this.process.stdout.write(`\n${nextStepsText(report)}\n`);
    // CI-facing surface: a mistyped --client id or a real install failure
    // must not exit 0 (review F1). Legitimate no-ops (already configured,
    // nothing detected) stay success.
    if (report.unknownClients.length > 0 || hasFailure(report)) {
      this.process.exitCode = 1;
    }
    await offerPreapproval(this, report.outcomes, {
      mode: 'non-interactive',
      dryRun: options.dryRun,
      flag: flags['preapprove-tools'] ?? false,
      serverName: entry.serverName,
    });
    return;
  }

  await interactive(this, options.dryRun, url, source, flags, entry, urlKey);
}

// ---------------------------------------------------------------------------
// Tool pre-approval with disclosure (internal, plan internal §D9)
// ---------------------------------------------------------------------------

/**
 * The sentence every disclosure carries, verbatim. It must stay literally
 * true of every tool in `LEVR_PREAPPROVED_TOOLS` (code review F-027).
 * deploy_gates and transition_issue stay pre-approved (user decision
 * 2026-10-15): deploy_gates can change or withdraw a gate and
 * transition_issue can waive one, so the disclosure says that instead of
 * promising otherwise.
 */
const PREAPPROVE_EXPLANATION =
  'These let your agent call these Levr tools without asking each time. ' +
  'None of them can delete anything. deploy_gates can change or withdraw ' +
  "a task's gates, and transition_issue can waive a failing required gate " +
  'to finish a task; every change and waiver is recorded on the gate.';

/** The confirmation question. The default is No. */
const PREAPPROVE_QUESTION = 'Add these permissions? (y/N)';

interface PreapproveMode {
  mode: 'interactive' | 'non-interactive';
  dryRun: boolean;
  /** `--preapprove-tools` was passed. */
  flag: boolean;
  /**
   * The client entry's name (`--name`, default `levr`): Claude Code's
   * permission rules are `mcp__<server>__<tool>`, so the entries must name
   * the server this run actually wrote.
   */
  serverName: string;
}

interface PreapproveCandidate {
  harness: HarnessDef;
  scope: HarnessScope;
}

/** Clients this run installed into that can take a pre-approval in that scope. */
function preapproveCandidates(
  outcomes: RunReport['outcomes'],
): PreapproveCandidate[] {
  const out: PreapproveCandidate[] = [];
  for (const o of outcomes) {
    if (!o.result.ok) continue;
    const harness = getHarness(o.id);
    if (!harness?.autoApprove?.file[o.result.scope]) continue;
    out.push({ harness, scope: o.result.scope });
  }
  return out;
}

/** "get_issue: reads one task" for an entry's tool. */
function describeTool(tool: string): string {
  const description = (
    LEVR_PREAPPROVED_TOOL_DESCRIPTIONS as Readonly<Record<string, string>>
  )[tool];
  return description ? `${tool}: ${description}` : tool;
}

/**
 * Who the permission file reaches (code review F-030): a `project` file sits
 * in the repository and is usually committed, so it grants the tools to
 * everyone on the repo — unless the repository ignores it, in which case the
 * sharing claim is false and the note says the file stays on this machine,
 * matching the install line's `[path is git-ignored — not shared via git]`
 * (internal, mirrors internal); a `local` file is personal, and when it is
 * about to be created somewhere git does not ignore, the user is told so (we
 * never edit their .gitignore).
 */
function sharingNote(plan: PreapproveResult): string | null {
  if (plan.scope === 'project') {
    if (plan.gitIgnored === true) {
      return (
        'This file is in your repository but git-ignored, so these ' +
        'permissions stay on this machine. To share them, un-ignore that ' +
        'path (a `!` rule in .gitignore) or use --scope user.'
      );
    }
    return (
      'This file is in your repository and is usually committed: these ' +
      'permissions are shared via git with everyone who uses this repo.'
    );
  }
  if (plan.scope === 'local') {
    const note = 'This file is personal to you in this repository.';
    if (!plan.fileExists && plan.gitIgnored === false) {
      return (
        `${note} It does not exist yet and git does not ignore it, so it ` +
        'would be committed by a "git add" of that folder: add it to ' +
        '.gitignore if you do not want to share it.'
      );
    }
    return note;
  }
  return null;
}

/**
 * The full disclosure for one client: the exact file, who it is shared with,
 * every entry that would be added (each with what its tool does), what is
 * already there, what the entries mean, any caveat, and how to undo it.
 * Printed BEFORE anything is written, in every mode.
 */
export function buildPreapproveDisclosure(
  label: string,
  plan: PreapproveResult,
): string {
  const lines: string[] = [];
  lines.push(`${label}: pre-approve Levr tools`);
  lines.push(`File: ${plan.file}`);
  const sharing = sharingNote(plan);
  if (sharing) lines.push(sharing);
  const valueNote = plan.toolValue
    ? ` (each set to ${JSON.stringify(plan.toolValue)})`
    : '';
  lines.push(`Entries to add under "${plan.keyPath}"${valueNote}:`);
  for (const e of plan.addedEntries) {
    lines.push(`  ${e.entry}  (${describeTool(e.tool)})`);
  }
  if (plan.alreadyPresent.length > 0) {
    lines.push(
      `Already present, left as is: ${plan.alreadyPresent.join(', ')}`,
    );
  }
  if (plan.conflicting.length > 0) {
    lines.push(
      `Set differently by you, left as is: ${plan.conflicting.join(', ')}`,
    );
  }
  lines.push(PREAPPROVE_EXPLANATION);
  if (plan.caveat) lines.push(plan.caveat);
  lines.push(
    `To undo: remove these entries from "${plan.keyPath}" in ${plan.file}: ` +
      plan.added.join(', '),
  );
  return lines.join('\n');
}

function preapproveFailureText(r: PreapproveResult): string {
  // A deliberate no-write (code review F-029) says what to do, not a code.
  if (r.reason === 'allowlist-key-absent' && r.detail) {
    return `permissions not added (${r.detail})`;
  }
  const why = r.detail ? `${r.reason}: ${r.detail}` : (r.reason ?? 'unknown');
  return `permissions not added (${why})`;
}

/**
 * Whether a not-`ok` result counts against an explicit `--preapprove-tools`
 * (code review F-031). `allowlist-key-absent` is the writer declining on
 * purpose to protect the user's own allowlist — the safe outcome, so it is
 * reported but never fails the run.
 */
function isPreapproveFailure(r: PreapproveResult): boolean {
  return !r.ok && r.reason !== 'allowlist-key-absent';
}

/**
 * Nothing to add (code review F-052): "already pre-approved" only when every
 * entry is already there. Entries the user set differently (a Zed deny) are
 * named as theirs and left alone — never claimed as approved.
 */
function nothingToAddText(label: string, plan: PreapproveResult): string {
  if (plan.conflicting.length === 0) {
    return `${label}: Levr tools are already pre-approved in ${plan.file}.`;
  }
  const lines = [
    `${label}: nothing added to ${plan.file}.`,
    `Set differently by you, left as is: ${plan.conflicting.join(', ')}`,
  ];
  if (plan.alreadyPresent.length > 0) {
    lines.push(`Already pre-approved: ${plan.alreadyPresent.join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * After a successful install, offer to pre-approve Levr's non-destructive
 * tools in each client that has a documented per-tool allow key.
 *
 * - Interactive: print the disclosure, then ask with No as the default.
 * - Non-interactive: never write unless `--preapprove-tools` was passed; with
 *   it, print the same disclosure to stderr before writing.
 * - `--dry-run`: print the disclosure and write nothing.
 *
 * Error direction: fail_fallback(continue). A failure is reported as
 * "permissions not added" and the run carries on to the next client. When
 * `--preapprove-tools` was passed, the user ASKED for the write, so a
 * failure sets exit code 1 once every client has been tried (code review
 * F-031). An interactive "No" and `--dry-run` are never failures.
 *
 * Cancelling a prompt (Ctrl+C) stops the whole offer: no further client is
 * asked, and each is reported "permissions not added" (code review F-063).
 */
async function offerPreapproval(
  ctx: LocalContext,
  outcomes: RunReport['outcomes'],
  opts: PreapproveMode,
): Promise<void> {
  const candidates = preapproveCandidates(outcomes);
  if (candidates.length === 0) return;
  const out = (s: string) => ctx.process.stdout.write(`${s}\n`);

  if (opts.mode === 'non-interactive' && !opts.flag && !opts.dryRun) {
    out(
      '\nTip: re-run with --preapprove-tools to let your agent call ' +
        "Levr's non-destructive tools without asking each time " +
        '(add --dry-run to see exactly what it would write).',
    );
    return;
  }

  let failed = false;
  for (const [index, { harness, scope }] of candidates.entries()) {
    const plan = preapproveTools(harness, scope, opts.serverName, {
      dryRun: true,
    });
    if (!plan.ok) {
      out(`\n${harness.label}: ${preapproveFailureText(plan)}`);
      if (!opts.dryRun && isPreapproveFailure(plan)) failed = true;
      continue;
    }
    if (plan.added.length === 0) {
      out(`\n${nothingToAddText(harness.label, plan)}`);
      continue;
    }
    const disclosure = buildPreapproveDisclosure(harness.label, plan);

    if (opts.dryRun) {
      out(`\n${disclosure}\n(dry run: nothing written)`);
      continue;
    }

    if (opts.mode === 'non-interactive') {
      // --preapprove-tools: the disclosure goes to stderr BEFORE the write.
      ctx.process.stderr.write(`\n${disclosure}\n`);
    } else {
      out(`\n${disclosure}`);
      const p = await import('@clack/prompts');
      const answer = await p.confirm({
        message: PREAPPROVE_QUESTION,
        initialValue: false,
      });
      if (p.isCancel(answer)) {
        out(`${harness.label}: permissions not added.`);
        for (const rest of candidates.slice(index + 1)) {
          out(`${rest.harness.label}: permissions not added (cancelled).`);
        }
        break;
      }
      if (answer !== true) {
        out(`${harness.label}: permissions not added.`);
        continue;
      }
    }

    const written = preapproveTools(harness, scope, opts.serverName, {
      dryRun: false,
    });
    if (!written.ok) {
      out(`${harness.label}: ${preapproveFailureText(written)}`);
      if (isPreapproveFailure(written)) failed = true;
      continue;
    }
    out(
      `${harness.label}: added ${written.added.length} permission ` +
        `${written.added.length === 1 ? 'entry' : 'entries'} to ${written.file}.`,
    );
  }
  if (opts.flag && failed) ctx.process.exitCode = 1;
}

/**
 * For an unpinned entry: the `--workspace` choices. Without a session there is
 * no list to show, so it says how to get one. Never fails the run.
 */
async function workspaceHint(): Promise<string | null> {
  const loaded = await loadSites();
  if (!loaded.ok) {
    return (
      'This entry is not pinned to a workspace. To pin one, run ' +
      "'levr auth login', then re-run with --workspace <url_key>."
    );
  }
  if (loaded.sites.length === 0) return null;
  return (
    'This entry is not pinned to a workspace. To pin it, re-run with ' +
    '--workspace <url_key>:\n' +
    describeWorkspaces(loaded.sites)
  );
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
  baseUrl: string,
  baseSource: string,
  flags: McpAddFlags,
  entry: EntryOptions,
  resolvedUrlKey?: string,
): Promise<void> {
  const p = await import('@clack/prompts');
  const requestedScope = flags.scope;
  const deps = depsFor(entry);
  let url = baseUrl;
  let urlSource = baseSource;
  let urlKey = resolvedUrlKey;

  p.intro('Levr MCP setup');

  // More than one workspace and none named: ask which one, by name. Not
  // logged in, a single workspace, or a URL on another server than the one
  // logged in to keeps the unpinned URL.
  if (!isScopedMcpUrl(url) && servedBySessionApi(url)) {
    const loaded = await loadSites();
    if (loaded.ok && loaded.sites.length > 1) {
      const picked = await p.select<string>({
        message: 'Which workspace should this entry use?',
        options: loaded.sites.map((s) => ({
          value: s.workspace_url_key,
          label: s.workspace_name,
          hint: s.workspace_url_key,
        })),
      });
      if (p.isCancel(picked)) {
        p.cancel('Cancelled.');
        ctx.process.exitCode = 1;
        return;
      }
      const site = loaded.sites.find((s) => s.workspace_url_key === picked);
      urlKey = picked;
      url = scopedMcpUrl(url, picked);
      urlSource = `${urlSource}, workspace ${site?.workspace_name ?? picked}`;
    }
  }

  p.note(`${url}\n(${urlSource})`, 'MCP endpoint');

  const detected = deps.detect(url);
  const installable = detected.filter((d) => d.available);
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

  const rows = clientChoices(detected, scope, url, entry.serverName);
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

  // A selected client whose entry points elsewhere: ask what to do with it,
  // rather than refusing it after the fact (internal). --replace already
  // answered "switch" for every client, so it is not asked again.
  const overrides = new Map<string, EntryOverride>();
  const left: LeftClient[] = [];
  for (const c of entryConflicts(
    selection,
    detected,
    scope,
    url,
    entry.serverName,
  )) {
    if (c.state === 'beside') {
      // Already set up under the beside name: install there, which reports it.
      if (c.besideName)
        overrides.set(c.id, {
          serverName: c.besideName,
          replaceExisting: false,
        });
      continue;
    }
    if (c.state === 'other-url' && entry.replaceExisting) continue;
    const where = c.currentUrl
      ? `points at ${describeTarget(c.currentUrl)}`
      : 'holds no Levr URL';
    const options: { value: string; label: string; hint?: string }[] = [];
    // An entry we cannot read cannot be restored, so it is never replaced.
    if (c.state === 'other-url') {
      options.push({
        value: 'switch',
        label: `Switch it to ${describeTarget(url)}`,
        hint: 'replaces the entry',
      });
    }
    if (c.besideName) {
      options.push({
        value: 'beside',
        label: `Add beside it as ${c.besideName}`,
        hint: 'keeps both; each repeats every tool',
      });
    }
    options.push({ value: 'leave', label: 'Leave it' });
    const answer =
      options.length === 1
        ? 'leave'
        : await p.select<string>({
            message:
              `${c.label}: its ${entry.serverName} entry ${where}` +
              (c.besideTaken ? `, and ${c.besideTaken} is taken too` : ''),
            options,
          });
    if (p.isCancel(answer)) {
      p.cancel('Cancelled.');
      ctx.process.exitCode = 1;
      return;
    }
    if (answer === 'switch') overrides.set(c.id, { replaceExisting: true });
    else if (answer === 'beside' && c.besideName)
      overrides.set(c.id, {
        serverName: c.besideName,
        replaceExisting: false,
      });
    else
      left.push({
        id: c.id,
        label: c.label,
        ...(c.currentUrl ? { currentUrl: c.currentUrl } : {}),
        ...(c.besideTaken ? { besideTaken: c.besideTaken } : {}),
      });
  }
  const leftIds = new Set(left.map((l) => l.id));
  const toInstall = selection.filter((id) => !leftIds.has(id));

  const spin = p.spinner();
  spin.start(dryRun ? 'Previewing changes' : 'Installing');
  const outcomes = installSelected(
    toInstall,
    {
      mcpUrl: url,
      dryRun,
      scope,
      // Interactively-picked clients were not asserted against this scope,
      // so an unsupported one falls back rather than failing the run.
      namedIds: new Set<string>(),
      overrides,
    },
    deps.install,
  );
  spin.stop(dryRun ? 'Preview ready' : 'Done');

  const report: RunReport = {
    url,
    urlSource,
    scope,
    outcomes,
    unknownClients: [],
    dryRun,
    switchCommand: switchCommandFor(flags, urlKey),
    entryName: entry.serverName,
    left,
  };
  p.note(formatReport(report), 'Results');
  await offerPreapproval(ctx, outcomes, {
    mode: 'interactive',
    dryRun,
    flag: flags['preapprove-tools'] ?? false,
    serverName: entry.serverName,
  });
  p.outro(nextStepsText(report));
  if (hasFailure(report)) {
    ctx.process.exitCode = 1;
  }
}
