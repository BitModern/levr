/**
 * Bare `levr`: the onboarding wizard (internal, plan internal D9).
 *
 * Steps, in order, each skipped once it is already satisfied:
 *   1. welcome;
 *   2. sign up or sign in (D8's signup / login flow), skipped with valid
 *      credentials;
 *   3. workspace, skipped with exactly one or one already pinned;
 *   4. MCP setup (`levr mcp add`), skipped when a detected client already has
 *      a Levr entry; then the Levr Browser MCP (`levr-browser`), skipped when
 *      a client already has that entry;
 *   5. gates setup (`levr gates setup`, D7) inside a git repo, else how to
 *      run it from one;
 *   6. the first-task prompt to paste into the user's coding agent, last.
 *
 * Every prompt checks `isCancel`: Ctrl-C or Esc ends the wizard with
 * `Setup cancelled` and exit code 130, and nothing past the completed steps
 * is written, because each step writes only after its own confirm. A step
 * that fails prints its error and the command that retries that step alone,
 * then the wizard moves on.
 *
 * The flow is pure over `OnboardingDeps`; `liveOnboardingDeps` wires it to the
 * real stores and to the existing command handlers, which it reuses rather
 * than re-implementing.
 */
import { spawnSync } from 'node:child_process';
import type { Option } from '@clack/prompts';
import { DEFAULT_SERVER_NAME, detectSync } from '@levr/mcp-harnesses/node';
import type { DetectedHarness, HarnessScope } from '@levr/mcp-harnesses/node';
import { buildContext, type LocalContext } from '../context.js';
import { readCredentials } from '../auth/credentials.js';
import { resolveToken } from '../auth/resolve-token.js';
import { getPatToken } from '../utils/env.js';
import { resolveMcpUrl } from '../mcp/url.js';
import { configureClient } from '../utils/sdk-client.js';
import { fetchSites } from '../workspace/resolve-workspace.js';
import { loadWorkspace, saveWorkspace } from '../workspace/workspace-store.js';
import { resolveRepoContext, type RunCommand } from '../repo/repo-context.js';

/** Exit code for a wizard the user cancelled (128 + SIGINT). */
export const EXIT_CANCELLED = 130;

/**
 * The first-task framing, verbatim from `FIRST_TASK_PROMPT_PREFIX` in
 * `packages/shared/src/first-task/first-task-prompt.ts` (the backender strips
 * exactly this text). Kept as a literal so the published CLI bundle takes no
 * new workspace import; `onboarding-flow.test.ts` asserts the two match.
 */
const FIRST_TASK_PREFIX = 'Use Levr to hold you to this task: ';

/**
 * The first-run task the user pastes into their coding agent: the starter
 * task the web app's first-task card copies, verbatim from
 * `FIRST_TASK_TODO_PROMPT` in the same shared file (user decision
 * 2026-11-11: a real task, not a `<describe your feature>` placeholder).
 * `onboarding-flow.test.ts` asserts the two match.
 */
export const FIRST_TASK_PROMPT = `${FIRST_TASK_PREFIX}in this empty folder, build a tiny TypeScript todo app with tests: add, complete, delete; reject empty or whitespace-only titles; completing a todo twice is a no-op.`;

/** The command that retries each step on its own. */
/** Levr Browser's MCP server: its own entry beside `levr` (internal). */
export const BROWSER_SERVER_NAME = 'levr-browser';

export const RETRY = {
  login: 'levr auth login',
  signup: 'levr auth signup',
  workspace: 'levr workspace select',
  mcp: 'levr mcp add',
  browserMcp: `levr mcp add --name ${BROWSER_SERVER_NAME} --url <levr MCP URL>/browser --workspace <url_key>`,
  gates: 'levr gates setup',
} as const;

/** How a reused step ended. */
export type StepResult = 'ok' | 'failed' | 'cancelled';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/** The clack surface the wizard uses; injected so tests script the answers. */
export interface OnboardingPrompts {
  intro(message: string): void;
  outro(message: string): void;
  cancel(message: string): void;
  note(message: string, title?: string): void;
  info(message: string): void;
  success(message: string): void;
  error(message: string): void;
  confirm(o: {
    message: string;
    initialValue?: boolean;
  }): Promise<boolean | symbol>;
  select<T extends string>(o: {
    message: string;
    options: SelectOption<T>[];
  }): Promise<T | symbol>;
  isCancel(value: unknown): value is symbol;
}

export interface OnboardingWorkspace {
  id: string;
  name: string;
}

export interface OnboardingClient {
  label: string;
  /** A Levr MCP entry already exists in this client (any URL). */
  hasLevr: boolean;
  /** A `levr-browser` MCP entry already exists in this client (any URL). */
  hasBrowser: boolean;
}

export interface OnboardingDeps {
  prompts: OnboardingPrompts;
  /** Stored credentials (or LEVR_TOKEN) that still resolve to a token. */
  hasValidCredentials(): Promise<boolean>;
  /** D8: the browser + loopback flow, device code when headless. */
  signIn(mode: 'signup' | 'login'): Promise<StepResult>;
  listWorkspaces(): Promise<OnboardingWorkspace[]>;
  pinnedWorkspace(): string | null;
  pinWorkspace(id: string): void;
  /** The MCP-capable clients detected on this machine. */
  mcpClients(): OnboardingClient[];
  /** `levr mcp add`, interactive. */
  addMcp(): Promise<StepResult>;
  /** `levr mcp add --name levr-browser`, for the pinned workspace. */
  addBrowserMcp(): Promise<StepResult>;
  inRepo(): Promise<boolean>;
  /** `levr gates setup`, interactive. */
  gatesSetup(): Promise<StepResult>;
  /**
   * What `levr gates setup` would still offer here (read-only), or null
   * when that cannot be told: then the wizard asks as before.
   */
  gatesStatus(): Promise<{ missing: string[]; anyConfigured: boolean } | null>;
}

/** Thrown inside the flow when the user cancels; caught by `runOnboarding`. */
class WizardCancelled extends Error {}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Run a reused step, turning a throw into `failed` with its message. */
async function attempt(
  step: () => Promise<StepResult>,
): Promise<{ result: StepResult; error?: string }> {
  try {
    return { result: await step() };
  } catch (err) {
    return { result: 'failed', error: messageOf(err) };
  }
}

export async function runOnboarding(deps: OnboardingDeps): Promise<number> {
  const p = deps.prompts;
  const done: string[] = [];

  const ask = async (o: {
    message: string;
    initialValue?: boolean;
  }): Promise<boolean> => {
    const answer = await p.confirm(o);
    if (p.isCancel(answer)) throw new WizardCancelled();
    return answer;
  };
  const choose = async <T extends string>(o: {
    message: string;
    options: SelectOption<T>[];
  }): Promise<T> => {
    const answer = await p.select<T>(o);
    if (p.isCancel(answer)) throw new WizardCancelled();
    return answer;
  };
  const failed = (what: string, retry: string, error?: string): void => {
    const cause = error ? `: ${error}` : '.';
    p.error(
      `${what} did not finish${cause}\nRetry this step alone with: ${retry}`,
    );
  };

  try {
    // 1. Welcome.
    p.intro('Welcome to Levr');
    p.note(
      'Levr holds your coding agent to the task: it writes the checks (gates)\n' +
        'before the code, and the task is done only when they pass.\n' +
        'Run `levr --help` any time to see every command.',
    );

    // 2. Sign up or sign in.
    let signedIn = await deps.hasValidCredentials();
    if (signedIn) {
      p.info('Signed in already.');
    } else {
      const mode = await choose<'signup' | 'login'>({
        message: 'Do you have a Levr account?',
        options: [
          { value: 'signup', label: 'No, create one (signup)' },
          { value: 'login', label: 'Yes, sign in' },
        ],
      });
      const { result, error } = await attempt(() => deps.signIn(mode));
      if (result === 'cancelled') throw new WizardCancelled();
      if (result === 'ok') {
        signedIn = true;
        done.push(mode === 'signup' ? 'account created' : 'signed in');
      } else {
        failed(
          mode === 'signup' ? 'Sign up' : 'Sign in',
          mode === 'signup' ? RETRY.signup : RETRY.login,
          error,
        );
      }
    }

    // 3. Workspace (needs a session).
    if (signedIn) {
      let workspaces: OnboardingWorkspace[] | null = null;
      try {
        workspaces = await deps.listWorkspaces();
      } catch (err) {
        failed('Listing your workspaces', RETRY.workspace, messageOf(err));
      }
      if (workspaces !== null) {
        const pinned = deps.pinnedWorkspace();
        const current = workspaces.find((w) => w.id === pinned);
        if (workspaces.length === 0) {
          p.info(
            'No workspace yet: you can create one when you first sign in to the app.',
          );
        } else if (workspaces.length === 1) {
          p.info(`Workspace: ${workspaces[0]!.name}`);
        } else if (current) {
          p.info(`Workspace: ${current.name}`);
        } else {
          const id = await choose<string>({
            message: 'Which workspace should the CLI use?',
            options: workspaces.map((w) => ({ value: w.id, label: w.name })),
          });
          deps.pinWorkspace(id);
          const chosen = workspaces.find((w) => w.id === id);
          done.push(`workspace ${chosen?.name ?? id}`);
        }
      }
    }

    // 4. MCP setup.
    const withLevr = deps.mcpClients().filter((c) => c.hasLevr);
    if (withLevr.length > 0) {
      p.info(
        `Levr MCP is set up already in ${withLevr.map((c) => c.label).join(', ')}.`,
      );
    } else {
      const go = await ask({
        message: 'Add the Levr MCP server to your AI clients now?',
        initialValue: true,
      });
      if (go) {
        const { result, error } = await attempt(() => deps.addMcp());
        if (result === 'cancelled') throw new WizardCancelled();
        if (result === 'ok') done.push('MCP server added');
        else failed('MCP setup', RETRY.mcp, error);
      } else {
        p.info(`Skipped. Add it later with: ${RETRY.mcp}`);
      }
    }

    // 4b. Levr Browser MCP: a second entry, so the agent can run tests in
    // the user's browser. Any existing `levr-browser` entry counts.
    const withBrowser = deps.mcpClients().filter((c) => c.hasBrowser);
    if (withBrowser.length > 0) {
      p.info(
        `Levr Browser MCP is set up already in ${withBrowser.map((c) => c.label).join(', ')}.`,
      );
    } else {
      const go = await ask({
        message: `Add the Levr Browser MCP server (${BROWSER_SERVER_NAME}) too? It lets your agent run tests in your browser.`,
        initialValue: true,
      });
      if (go) {
        const { result, error } = await attempt(() => deps.addBrowserMcp());
        if (result === 'cancelled') throw new WizardCancelled();
        if (result === 'ok') done.push('Levr Browser MCP server added');
        else failed('Levr Browser MCP setup', RETRY.browserMcp, error);
      } else {
        p.info(`Skipped. Add it later with: ${RETRY.browserMcp}`);
      }
    }

    // 5. Gates setup, before the first task: the repo is ready when the
    // user pastes the task (user decision 2026-11-11).
    let inRepo = false;
    try {
      inRepo = await deps.inRepo();
    } catch {
      inRepo = false;
    }
    // [issue:internal] Already set up: say so and move on, rather than ask
    // on every run (user report 2026-11-11).
    let status: { missing: string[]; anyConfigured: boolean } | null = null;
    if (inRepo) {
      try {
        status = await deps.gatesStatus();
      } catch {
        status = null;
      }
    }
    if (inRepo && status !== null && status.missing.length === 0) {
      p.info(
        `Gates are set up for this repository already. Change them any time with: ${RETRY.gates}`,
      );
    } else if (inRepo) {
      const go = await ask({
        message:
          status !== null
            ? `Set up gates for this repository now (levr gates setup)? Not configured yet: ${status.missing.join(', ')}.`
            : 'Set up gates for this repository now (levr gates setup)?',
        // Some gate settings already apply: what is left may have been
        // skipped on purpose, so Enter does not run setup again.
        initialValue: !(status?.anyConfigured ?? false),
      });
      if (go) {
        const { result, error } = await attempt(() => deps.gatesSetup());
        if (result === 'cancelled') throw new WizardCancelled();
        if (result === 'ok') done.push('gates set up');
        else failed('Gates setup', RETRY.gates, error);
      } else {
        p.info(`Skipped. Set gates up later with: ${RETRY.gates}`);
      }
    } else {
      p.info(
        'To set up gates, cd into one of your repos and run `levr gates setup`.',
      );
    }

    // 6. First task, last, for the client that now has Levr.
    const harness =
      deps.mcpClients().find((c) => c.hasLevr)?.label ?? 'your coding agent';
    p.note(
      FIRST_TASK_PROMPT,
      `Try it: open ${harness} in an empty folder and paste this`,
    );

    p.outro(
      done.length > 0
        ? `Configured: ${done.join(', ')}.`
        : 'Nothing new to configure. Paste the task above into your agent.',
    );
    return 0;
  } catch (err) {
    if (err instanceof WizardCancelled) {
      p.cancel('Setup cancelled');
      return EXIT_CANCELLED;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Live wiring
// ---------------------------------------------------------------------------

/**
 * A context for one reused handler. The handler reports failure through
 * `process.exitCode`; this proxy keeps that code to itself, so a failed step
 * never leaks its exit code into the wizard's own.
 */
function stepContext(): { ctx: LocalContext; exitCode: () => number } {
  let code: number | undefined;
  const proc = new Proxy(process, {
    get(target, prop) {
      if (prop === 'exitCode') return code;
      return Reflect.get(target, prop) as unknown;
    },
    set(target, prop, value: unknown) {
      if (prop === 'exitCode') {
        code = typeof value === 'number' ? value : Number(value ?? 0);
        return true;
      }
      return Reflect.set(target, prop, value);
    },
  });
  return { ctx: buildContext(proc), exitCode: () => code ?? 0 };
}

function stepResultOf(exitCode: number): StepResult {
  if (exitCode === 0) return 'ok';
  return exitCode === EXIT_CANCELLED ? 'cancelled' : 'failed';
}

function gitRunner(): RunCommand {
  return (args, cwd) => {
    const r = spawnSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (r.error) return { code: -1, stdout: '' };
    return { code: r.status ?? -1, stdout: r.stdout ?? '' };
  };
}

async function clackPrompts(): Promise<OnboardingPrompts> {
  const c = await import('@clack/prompts');
  return {
    intro: (m) => c.intro(m),
    outro: (m) => c.outro(m),
    cancel: (m) => c.cancel(m),
    note: (m, title) => c.note(m, title),
    info: (m) => c.log.info(m),
    success: (m) => c.log.success(m),
    error: (m) => c.log.error(m),
    confirm: (o) => c.confirm(o),
    select: <T extends string>(o: {
      message: string;
      options: SelectOption<T>[];
    }) =>
      c.select<T>({
        message: o.message,
        options: o.options.map((x) =>
          x.hint === undefined
            ? { value: x.value, label: x.label }
            : { value: x.value, label: x.label, hint: x.hint },
        ) as Option<T>[],
      }),
    isCancel: (v: unknown): v is symbol => c.isCancel(v),
  };
}

/** The wizard wired to the real stores and the existing command handlers. */
export async function liveOnboardingDeps(
  base: NodeJS.Process,
): Promise<OnboardingDeps> {
  const prompts = await clackPrompts();
  return {
    prompts,
    async hasValidCredentials() {
      if (readCredentials() === null && getPatToken() === undefined) {
        return false;
      }
      try {
        configureClient(await resolveToken());
        return true;
      } catch {
        return false;
      }
    },
    async signIn(mode) {
      const { performLogin } = await import('../commands/auth/loginHandler.js');
      const step = stepContext();
      const ok = await performLogin(step.ctx, {
        deviceCode: false,
        ...(mode === 'signup' ? { screenHint: 'signup' as const } : {}),
      });
      if (ok) {
        configureClient(await resolveToken());
        return 'ok';
      }
      return stepResultOf(step.exitCode() || 1);
    },
    async listWorkspaces() {
      const sites = await fetchSites();
      return sites.map((s) => ({ id: s.workspace_id, name: s.workspace_name }));
    },
    pinnedWorkspace: () => loadWorkspace(),
    pinWorkspace: (id) => saveWorkspace(id),
    mcpClients: () => detectedClients(),
    async addMcp() {
      const { mcpAddHandler } = await import('../commands/mcp/addHandler.js');
      const step = stepContext();
      await mcpAddHandler.call(step.ctx, {
        all: false,
        yes: false,
        'dry-run': false,
      });
      return stepResultOf(step.exitCode());
    },
    async addBrowserMcp() {
      const { mcpAddHandler } = await import('../commands/mcp/addHandler.js');
      // [issue:internal] Where `levr` is, so the clients and the scope the
      // user chose for it are not asked again (user request 2026-11-11).
      // None found: ask, as `levr mcp add` does.
      const plan = browserInstallPlan(
        detectSync(undefined, { serverName: DEFAULT_SERVER_NAME }),
      );
      // The workspace address, so captures are saved to the pinned
      // workspace; with none pinned, the plain address still works.
      const pinned = loadWorkspace();
      const site =
        pinned === null
          ? undefined
          : (await fetchSites()).find((s) => s.workspace_id === pinned);
      const base = {
        all: false,
        yes: false,
        'dry-run': false,
        name: BROWSER_SERVER_NAME,
        url: `${resolveMcpUrl().url}/browser`,
        ...(site ? { workspace: site.workspace_url_key } : {}),
      };
      if (plan.length === 0) {
        const step = stepContext();
        await mcpAddHandler.call(step.ctx, base);
        return stepResultOf(step.exitCode());
      }
      // One install per scope: the installer takes one scope per call.
      let worst = 0;
      for (const { scope, clients } of plan) {
        const step = stepContext();
        await mcpAddHandler.call(step.ctx, { ...base, scope, client: clients });
        worst = Math.max(worst, step.exitCode());
      }
      return stepResultOf(worst);
    },
    async inRepo() {
      const repo = await resolveRepoContext({
        cwd: base.cwd(),
        git: gitRunner(),
        // Only reached for an ssh remote on a self-hosted host; the wizard
        // needs to know it is in a repo, not where the remote resolves.
        ssh: () => ({ code: -1, stdout: '' }),
        askIsSshAlias: () => Promise.resolve(false),
        note: () => {},
      });
      return repo.ok;
    },
    async gatesStatus() {
      const { liveGatesSetupStatus } = await import(
        '../commands/gates/setupHandler.js'
      );
      return liveGatesSetupStatus(stepContext().ctx);
    },
    async gatesSetup() {
      const { gatesSetupHandler } = await import(
        '../commands/gates/setupHandler.js'
      );
      const step = stepContext();
      await gatesSetupHandler.call(step.ctx, { 'dry-run': false, yes: false });
      return stepResultOf(step.exitCode());
    },
  };
}

/**
 * Installed MCP clients, and whether each already has a `levr` and a
 * `levr-browser` entry. Any URL counts: the wizard does not judge which
 * backend an existing entry points at.
 */
function detectedClients(): OnboardingClient[] {
  const browser = new Map(
    detectSync(undefined, { serverName: BROWSER_SERVER_NAME }).map((d) => [
      d.label,
      d.scopes.some((s) => s.alreadyConfigured),
    ]),
  );
  return detectSync(undefined, { serverName: DEFAULT_SERVER_NAME })
    .filter((d) => d.installed)
    .map((d) => ({
      label: d.label,
      hasLevr: d.scopes.some((s) => s.alreadyConfigured),
      hasBrowser: browser.get(d.label) ?? false,
    }));
}

/**
 * [issue:internal] Where to add `levr-browser`: the same clients, at the same
 * scopes, as their existing `levr` entry, grouped by scope (the installer
 * takes one scope per call). Empty when no installed client has `levr`.
 */
export function browserInstallPlan(
  detected: readonly Pick<DetectedHarness, 'id' | 'installed' | 'scopes'>[],
): Array<{ scope: HarnessScope; clients: string[] }> {
  const byScope = new Map<HarnessScope, string[]>();
  for (const d of detected) {
    if (!d.installed) continue;
    for (const s of d.scopes) {
      if (!s.alreadyConfigured) continue;
      byScope.set(s.scope, [...(byScope.get(s.scope) ?? []), d.id]);
    }
  }
  return [...byScope].map(([scope, clients]) => ({ scope, clients }));
}
