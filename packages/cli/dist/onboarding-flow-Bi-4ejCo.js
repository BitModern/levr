import { buildContext } from "./context-DM60OOvm.js";
import { configureClient } from "./sdk-client-COhVazCc.js";
import "./token-refresh-ChElPPiG.js";
import { getPatToken, readCredentials } from "./env-D31eVXPZ.js";
import { resolveToken } from "./resolve-token-QPDOFGfO.js";
import { loadWorkspace, saveWorkspace } from "./workspace-store-DYXnmPDY.js";
import { fetchSites } from "./resolve-workspace-Q8FOM4UC.js";
import { DEFAULT_SERVER_NAME } from "./paths-BWrY8EUd.js";
import { detectSync } from "./detect-oNmsIBkr.js";
import { resolveMcpUrl } from "./url-DXZc5M5i.js";
import { resolveRepoContext } from "./repo-context-BcZAgfR2.js";
import { spawnSync } from "node:child_process";

//#region src/onboarding/onboarding-flow.ts
/** Exit code for a wizard the user cancelled (128 + SIGINT). */
const EXIT_CANCELLED = 130;
/**
* The first-task framing, verbatim from `FIRST_TASK_PROMPT_PREFIX` in
* `packages/shared/src/first-task/first-task-prompt.ts` (the backender strips
* exactly this text). Kept as a literal so the published CLI bundle takes no
* new workspace import; `onboarding-flow.test.ts` asserts the two match.
*/
const FIRST_TASK_PREFIX = "Use Levr to hold you to this task: ";
/**
* The first-run task the user pastes into their coding agent: the starter
* task the web app's first-task card copies, verbatim from
* `FIRST_TASK_TODO_PROMPT` in the same shared file (user decision
* 2026-11-11: a real task, not a `<describe your feature>` placeholder).
* `onboarding-flow.test.ts` asserts the two match.
*/
const FIRST_TASK_PROMPT = `${FIRST_TASK_PREFIX}in this empty folder, build a tiny TypeScript todo app with tests: add, complete, delete; reject empty or whitespace-only titles; completing a todo twice is a no-op.`;
/** The command that retries each step on its own. */
/** Levr Browser's MCP server: its own entry beside `levr` (ENG-5918). */
const BROWSER_SERVER_NAME = "levr-browser";
const RETRY = {
	login: "levr auth login",
	signup: "levr auth signup",
	workspace: "levr workspace select",
	mcp: "levr mcp add",
	browserMcp: `levr mcp add --name ${BROWSER_SERVER_NAME} --url <levr MCP URL>/browser --workspace <url_key>`,
	gates: "levr gates setup"
};
/** Thrown inside the flow when the user cancels; caught by `runOnboarding`. */
var WizardCancelled = class extends Error {};
function messageOf(err) {
	return err instanceof Error ? err.message : String(err);
}
/** Run a reused step, turning a throw into `failed` with its message. */
async function attempt(step) {
	try {
		return { result: await step() };
	} catch (err) {
		return {
			result: "failed",
			error: messageOf(err)
		};
	}
}
async function runOnboarding(deps) {
	const p = deps.prompts;
	const done = [];
	const ask = async (o) => {
		const answer = await p.confirm(o);
		if (p.isCancel(answer)) throw new WizardCancelled();
		return answer;
	};
	const choose = async (o) => {
		const answer = await p.select(o);
		if (p.isCancel(answer)) throw new WizardCancelled();
		return answer;
	};
	const failed = (what, retry, error) => {
		const cause = error ? `: ${error}` : ".";
		p.error(`${what} did not finish${cause}\nRetry this step alone with: ${retry}`);
	};
	try {
		p.intro("Welcome to Levr");
		p.note("Levr holds your coding agent to the task: it writes the checks (gates)\nbefore the code, and the task is done only when they pass.\nRun `levr --help` any time to see every command.");
		let signedIn = await deps.hasValidCredentials();
		if (signedIn) p.info("Signed in already.");
		else {
			const mode = await choose({
				message: "Do you have a Levr account?",
				options: [{
					value: "signup",
					label: "No, create one (signup)"
				}, {
					value: "login",
					label: "Yes, sign in"
				}]
			});
			const { result, error } = await attempt(() => deps.signIn(mode));
			if (result === "cancelled") throw new WizardCancelled();
			if (result === "ok") {
				signedIn = true;
				done.push(mode === "signup" ? "account created" : "signed in");
			} else failed(mode === "signup" ? "Sign up" : "Sign in", mode === "signup" ? RETRY.signup : RETRY.login, error);
		}
		if (signedIn) {
			let workspaces = null;
			try {
				workspaces = await deps.listWorkspaces();
			} catch (err) {
				failed("Listing your workspaces", RETRY.workspace, messageOf(err));
			}
			if (workspaces !== null) {
				const pinned = deps.pinnedWorkspace();
				const current = workspaces.find((w) => w.id === pinned);
				if (workspaces.length === 0) p.info("No workspace yet: you can create one when you first sign in to the app.");
				else if (workspaces.length === 1) p.info(`Workspace: ${workspaces[0].name}`);
				else if (current) p.info(`Workspace: ${current.name}`);
				else {
					const id = await choose({
						message: "Which workspace should the CLI use?",
						options: workspaces.map((w) => ({
							value: w.id,
							label: w.name
						}))
					});
					deps.pinWorkspace(id);
					const chosen = workspaces.find((w) => w.id === id);
					done.push(`workspace ${chosen?.name ?? id}`);
				}
			}
		}
		const withLevr = deps.mcpClients().filter((c) => c.hasLevr);
		if (withLevr.length > 0) p.info(`Levr MCP is set up already in ${withLevr.map((c) => c.label).join(", ")}.`);
		else if (await ask({
			message: "Add the Levr MCP server to your AI clients now?",
			initialValue: true
		})) {
			const { result, error } = await attempt(() => deps.addMcp());
			if (result === "cancelled") throw new WizardCancelled();
			if (result === "ok") done.push("MCP server added");
			else failed("MCP setup", RETRY.mcp, error);
		} else p.info(`Skipped. Add it later with: ${RETRY.mcp}`);
		const withBrowser = deps.mcpClients().filter((c) => c.hasBrowser);
		if (withBrowser.length > 0) p.info(`Levr Browser MCP is set up already in ${withBrowser.map((c) => c.label).join(", ")}.`);
		else if (await ask({
			message: `Add the Levr Browser MCP server (${BROWSER_SERVER_NAME}) too? It lets your agent run tests in your browser.`,
			initialValue: true
		})) {
			const { result, error } = await attempt(() => deps.addBrowserMcp());
			if (result === "cancelled") throw new WizardCancelled();
			if (result === "ok") done.push("Levr Browser MCP server added");
			else failed("Levr Browser MCP setup", RETRY.browserMcp, error);
		} else p.info(`Skipped. Add it later with: ${RETRY.browserMcp}`);
		let inRepo = false;
		try {
			inRepo = await deps.inRepo();
		} catch {
			inRepo = false;
		}
		let status = null;
		if (inRepo) try {
			status = await deps.gatesStatus();
		} catch {
			status = null;
		}
		if (inRepo && status !== null && status.missing.length === 0) p.info(`Gates are set up for this repository already. Change them any time with: ${RETRY.gates}`);
		else if (inRepo) if (await ask({
			message: status !== null ? `Set up gates for this repository now (levr gates setup)? Not configured yet: ${status.missing.join(", ")}.` : "Set up gates for this repository now (levr gates setup)?",
			initialValue: !(status?.anyConfigured ?? false)
		})) {
			const { result, error } = await attempt(() => deps.gatesSetup());
			if (result === "cancelled") throw new WizardCancelled();
			if (result === "ok") done.push("gates set up");
			else failed("Gates setup", RETRY.gates, error);
		} else p.info(`Skipped. Set gates up later with: ${RETRY.gates}`);
		else p.info("To set up gates, cd into one of your repos and run `levr gates setup`.");
		const harness = deps.mcpClients().find((c) => c.hasLevr)?.label ?? "your coding agent";
		p.note(FIRST_TASK_PROMPT, `Try it: open ${harness} in an empty folder and paste this`);
		p.outro(done.length > 0 ? `Configured: ${done.join(", ")}.` : "Nothing new to configure. Paste the task above into your agent.");
		return 0;
	} catch (err) {
		if (err instanceof WizardCancelled) {
			p.cancel("Setup cancelled");
			return EXIT_CANCELLED;
		}
		throw err;
	}
}
/**
* A context for one reused handler. The handler reports failure through
* `process.exitCode`; this proxy keeps that code to itself, so a failed step
* never leaks its exit code into the wizard's own.
*/
function stepContext() {
	let code;
	return {
		ctx: buildContext(new Proxy(process, {
			get(target, prop) {
				if (prop === "exitCode") return code;
				return Reflect.get(target, prop);
			},
			set(target, prop, value) {
				if (prop === "exitCode") {
					code = typeof value === "number" ? value : Number(value ?? 0);
					return true;
				}
				return Reflect.set(target, prop, value);
			}
		})),
		exitCode: () => code ?? 0
	};
}
function stepResultOf(exitCode) {
	if (exitCode === 0) return "ok";
	return exitCode === EXIT_CANCELLED ? "cancelled" : "failed";
}
function gitRunner() {
	return (args, cwd) => {
		const r = spawnSync("git", [...args], {
			cwd,
			encoding: "utf8",
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			]
		});
		if (r.error) return {
			code: -1,
			stdout: ""
		};
		return {
			code: r.status ?? -1,
			stdout: r.stdout ?? ""
		};
	};
}
async function clackPrompts() {
	const c = await import("@clack/prompts");
	return {
		intro: (m) => c.intro(m),
		outro: (m) => c.outro(m),
		cancel: (m) => c.cancel(m),
		note: (m, title) => c.note(m, title),
		info: (m) => c.log.info(m),
		success: (m) => c.log.success(m),
		error: (m) => c.log.error(m),
		confirm: (o) => c.confirm(o),
		select: (o) => c.select({
			message: o.message,
			options: o.options.map((x) => x.hint === void 0 ? {
				value: x.value,
				label: x.label
			} : {
				value: x.value,
				label: x.label,
				hint: x.hint
			})
		}),
		isCancel: (v) => c.isCancel(v)
	};
}
/** The wizard wired to the real stores and the existing command handlers. */
async function liveOnboardingDeps(base) {
	return {
		prompts: await clackPrompts(),
		async hasValidCredentials() {
			if (readCredentials() === null && getPatToken() === void 0) return false;
			try {
				configureClient(await resolveToken());
				return true;
			} catch {
				return false;
			}
		},
		async signIn(mode) {
			const { performLogin } = await import("./loginHandler-ut3ugpCn.js");
			const step = stepContext();
			if (await performLogin(step.ctx, {
				deviceCode: false,
				...mode === "signup" ? { screenHint: "signup" } : {}
			})) {
				configureClient(await resolveToken());
				return "ok";
			}
			return stepResultOf(step.exitCode() || 1);
		},
		async listWorkspaces() {
			return (await fetchSites()).map((s) => ({
				id: s.workspace_id,
				name: s.workspace_name
			}));
		},
		pinnedWorkspace: () => loadWorkspace(),
		pinWorkspace: (id) => saveWorkspace(id),
		mcpClients: () => detectedClients(),
		async addMcp() {
			const { mcpAddHandler } = await import("./addHandler-CcoUHsO5.js");
			const step = stepContext();
			await mcpAddHandler.call(step.ctx, {
				all: false,
				yes: false,
				"dry-run": false
			});
			return stepResultOf(step.exitCode());
		},
		async addBrowserMcp() {
			const { mcpAddHandler } = await import("./addHandler-CcoUHsO5.js");
			const plan = browserInstallPlan(detectSync(void 0, { serverName: DEFAULT_SERVER_NAME }));
			const pinned = loadWorkspace();
			const site = pinned === null ? void 0 : (await fetchSites()).find((s) => s.workspace_id === pinned);
			const base$1 = {
				all: false,
				yes: false,
				"dry-run": false,
				name: BROWSER_SERVER_NAME,
				url: `${resolveMcpUrl().url}/browser`,
				...site ? { workspace: site.workspace_url_key } : {}
			};
			if (plan.length === 0) {
				const step = stepContext();
				await mcpAddHandler.call(step.ctx, base$1);
				return stepResultOf(step.exitCode());
			}
			let worst = 0;
			for (const { scope, clients } of plan) {
				const step = stepContext();
				await mcpAddHandler.call(step.ctx, {
					...base$1,
					scope,
					client: clients
				});
				worst = Math.max(worst, step.exitCode());
			}
			return stepResultOf(worst);
		},
		async inRepo() {
			return (await resolveRepoContext({
				cwd: base.cwd(),
				git: gitRunner(),
				ssh: () => ({
					code: -1,
					stdout: ""
				}),
				askIsSshAlias: () => Promise.resolve(false),
				note: () => {}
			})).ok;
		},
		async gatesStatus() {
			const { liveGatesSetupStatus } = await import("./setupHandler-Cpo2SDYL.js");
			return liveGatesSetupStatus(stepContext().ctx);
		},
		async gatesSetup() {
			const { gatesSetupHandler } = await import("./setupHandler-Cpo2SDYL.js");
			const step = stepContext();
			await gatesSetupHandler.call(step.ctx, {
				"dry-run": false,
				yes: false
			});
			return stepResultOf(step.exitCode());
		}
	};
}
/**
* Installed MCP clients, and whether each already has a `levr` and a
* `levr-browser` entry. Any URL counts: the wizard does not judge which
* backend an existing entry points at.
*/
function detectedClients() {
	const browser = new Map(detectSync(void 0, { serverName: BROWSER_SERVER_NAME }).map((d) => [d.label, d.scopes.some((s) => s.alreadyConfigured)]));
	return detectSync(void 0, { serverName: DEFAULT_SERVER_NAME }).filter((d) => d.installed).map((d) => ({
		label: d.label,
		hasLevr: d.scopes.some((s) => s.alreadyConfigured),
		hasBrowser: browser.get(d.label) ?? false
	}));
}
/**
* [issue:ENG-8227] Where to add `levr-browser`: the same clients, at the same
* scopes, as their existing `levr` entry, grouped by scope (the installer
* takes one scope per call). Empty when no installed client has `levr`.
*/
function browserInstallPlan(detected) {
	const byScope = /* @__PURE__ */ new Map();
	for (const d of detected) {
		if (!d.installed) continue;
		for (const s of d.scopes) {
			if (!s.alreadyConfigured) continue;
			byScope.set(s.scope, [...byScope.get(s.scope) ?? [], d.id]);
		}
	}
	return [...byScope].map(([scope, clients]) => ({
		scope,
		clients
	}));
}

//#endregion
export { liveOnboardingDeps, runOnboarding };