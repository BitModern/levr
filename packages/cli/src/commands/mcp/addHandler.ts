import {
  DEFAULT_SERVER_NAME,
  detectSync,
  installHarnessSync,
  type HarnessScope,
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
 * The workspaces of the logged-in user. Reads the session only; it never
 * reads or changes the workspace the CLI has selected.
 */
async function loadSites(): Promise<SitesLoad> {
  let auth;
  try {
    auth = await resolveToken();
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Not authenticated. Run 'levr auth login' first.",
    };
  }
  if (auth.type === 'pat') {
    return {
      ok: false,
      error:
        "--workspace needs a login session, not a personal access token. Run 'levr auth login'.",
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
    const loaded = await loadSites();
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
    return;
  }

  await interactive(this, options.dryRun, url, source, flags, entry, urlKey);
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
  p.outro(nextStepsText(report));
  if (hasFailure(report)) {
    ctx.process.exitCode = 1;
  }
}
