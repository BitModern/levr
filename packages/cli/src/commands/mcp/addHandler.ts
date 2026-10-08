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
  workspace?: string;
  name?: string;
  replace?: boolean;
}

/**
 * Allowed client entry names: 1-64 of `A-Za-z0-9_-`, and never starting with
 * `-`. The name is passed as an argv element to the client's own CLI
 * (`claude mcp add … <name> <url>`), so a leading `-` would be read there as a
 * flag — the internal argument-injection family.
 */
const ENTRY_NAME = /^[A-Za-z0-9_-]{1,64}$/;

function isValidEntryName(name: string): boolean {
  return ENTRY_NAME.test(name) && !name.startsWith('-');
}

/** What the installer is told about the entry (internal D6). */
interface EntryOptions {
  serverName: string;
  /** Explicit: an entry pointing elsewhere is refused unless this is true. */
  replaceExisting: boolean;
}

function depsFor(entry: EntryOptions): RunDeps {
  const install: InstallFn = (harness, mcpUrl, dryRun, scope) =>
    installHarnessSync(harness, mcpUrl, {
      dryRun,
      scope,
      serverName: entry.serverName,
      replaceExisting: entry.replaceExisting,
    });
  return { detect: () => detectSync(), install };
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

  const detected = deps.detect();
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
  };
  p.note(formatReport(report), 'Results');
  p.outro(nextStepsText(report));
  if (hasFailure(report)) {
    ctx.process.exitCode = 1;
  }
}
