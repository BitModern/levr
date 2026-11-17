import "./gate-op-CvE5u-xj.js";
import { client, configureClient } from "./sdk-client-COhVazCc.js";
import { JUDGE_GATE_KEYS, JUDGE_PRESETS, JUDGE_PRESET_IDS, PayloadError, buildJudgeSetupPrompt, gateBindingTransferExportConfigV1, gateBindingTransferImportConfigV1, isJudgePresetId, jsonEqual, parsePayload, validatePayload } from "./dist-CjYnrSGu.js";
import "./token-refresh-ChElPPiG.js";
import "./env-D31eVXPZ.js";
import { resolveToken } from "./resolve-token-QPDOFGfO.js";
import "./workspace-store-DYXnmPDY.js";
import { resolveWorkspaceFor } from "./resolve-workspace-Q8FOM4UC.js";
import { defaultEnv, whichSync } from "./paths-BWrY8EUd.js";
import { resolveRepoContext } from "./repo-context-BcZAgfR2.js";
import * as fs from "node:fs";
import { spawnSync } from "node:child_process";

//#region ../sdk-public/dist/gen/repository-ref-catalog/functions.js
/** GET /v1/repository-catalog/resolve */
const repositoryRefCatalogResolveByRemoteV1 = (options) => {
	return (options?.client ?? client).get({
		security: [{
			scheme: "bearer",
			type: "http"
		}],
		url: "/v1/repository-catalog/resolve",
		...options
	});
};
/** POST /v1/repository-catalog */
const repositoryRefCatalogCreateV1 = (options) => {
	return (options?.client ?? client).post({
		security: [{
			scheme: "bearer",
			type: "http"
		}],
		url: "/v1/repository-catalog",
		...options
	});
};

//#endregion
//#region src/commands/gates/setup-detect.ts
const COMMAND_SLOT_IDS = [
	"typecheck",
	"test.unit",
	"test.e2e",
	"lint"
];
/** The gate type each slot configures. */
const SLOT_GATE_KEYS = {
	typecheck: "typecheck",
	"test.unit": "unit_test_pass",
	"test.e2e": "e2e_test_pass",
	lint: "lint",
	ast_pattern: "ast_pattern"
};
function join(root, file) {
	return root.endsWith("/") ? `${root}${file}` : `${root}/${file}`;
}
/** The first script name present, in preference order. */
function firstScript(scripts, names) {
	for (const name of names) if (typeof scripts[name] === "string" && scripts[name] !== "") return name;
	return null;
}
const SCRIPT_NAMES = {
	typecheck: [
		"typecheck",
		"type-check",
		"check-types",
		"tsc"
	],
	"test.unit": [
		"test:unit",
		"unit",
		"test"
	],
	"test.e2e": ["test:e2e", "e2e"],
	lint: ["lint"]
};
function packageRunner(root, read) {
	if (read(join(root, "pnpm-lock.yaml")) != null) return "pnpm run";
	if (read(join(root, "yarn.lock")) != null) return "yarn run";
	if (read(join(root, "bun.lockb")) != null || read(join(root, "bun.lock")) != null) return "bun run";
	return "npm run";
}
function fromPackageJson(root, read) {
	const text = read(join(root, "package.json"));
	if (text == null) return [];
	let scripts;
	try {
		const parsed = JSON.parse(text);
		if (!parsed.scripts || typeof parsed.scripts !== "object" || Array.isArray(parsed.scripts)) return [];
		scripts = parsed.scripts;
	} catch {
		return [];
	}
	const runner$1 = packageRunner(root, read);
	const out = [];
	for (const slot of COMMAND_SLOT_IDS) {
		const name = firstScript(scripts, SCRIPT_NAMES[slot]);
		if (!name) continue;
		out.push({
			slot,
			gateKey: SLOT_GATE_KEYS[slot],
			command: `${runner$1} ${name}`,
			source: `package.json "${name}"`
		});
	}
	return out;
}
function fromComposerJson(root, read) {
	const text = read(join(root, "composer.json"));
	if (text == null) return [];
	let scripts;
	try {
		const parsed = JSON.parse(text);
		if (!parsed.scripts || typeof parsed.scripts !== "object") return [];
		scripts = parsed.scripts;
	} catch {
		return [];
	}
	const out = [];
	const names = {
		typecheck: [
			"phpstan",
			"analyse",
			"psalm",
			"typecheck"
		],
		"test.unit": ["test:unit", "test"],
		"test.e2e": ["test:e2e", "e2e"],
		lint: ["lint", "cs"]
	};
	for (const slot of COMMAND_SLOT_IDS) {
		const name = names[slot].find((n) => scripts[n] != null);
		if (!name) continue;
		out.push({
			slot,
			gateKey: SLOT_GATE_KEYS[slot],
			command: `composer run-script ${name}`,
			source: `composer.json "${name}"`
		});
	}
	return out;
}
function fromCargoToml(root, read) {
	if (read(join(root, "Cargo.toml")) == null) return [];
	const locked = read(join(root, "Cargo.lock")) != null ? " --locked" : "";
	const source = "Cargo.toml";
	return [
		{
			slot: "typecheck",
			gateKey: SLOT_GATE_KEYS.typecheck,
			command: `cargo check --workspace${locked}`,
			source
		},
		{
			slot: "test.unit",
			gateKey: SLOT_GATE_KEYS["test.unit"],
			command: `cargo test --workspace${locked}`,
			source
		},
		{
			slot: "lint",
			gateKey: SLOT_GATE_KEYS.lint,
			command: `cargo clippy --workspace --all-targets${locked} -- -D warnings`,
			source
		}
	];
}
function fromGoMod(root, read) {
	if (read(join(root, "go.mod")) == null) return [];
	const source = "go.mod";
	return [
		{
			slot: "typecheck",
			gateKey: SLOT_GATE_KEYS.typecheck,
			command: "go build ./...",
			source
		},
		{
			slot: "test.unit",
			gateKey: SLOT_GATE_KEYS["test.unit"],
			command: "go test ./...",
			source
		},
		{
			slot: "lint",
			gateKey: SLOT_GATE_KEYS.lint,
			command: "go vet ./...",
			source
		}
	];
}
function fromPyproject(root, read) {
	const text = read(join(root, "pyproject.toml"));
	if (text == null) return [];
	const runner$1 = read(join(root, "uv.lock")) != null ? "uv run" : read(join(root, "poetry.lock")) != null ? "poetry run" : "python -m";
	const mentions = (tool) => new RegExp(`\\b${tool}\\b`, "i").test(text);
	const source = "pyproject.toml";
	const out = [];
	if (mentions("mypy")) out.push({
		slot: "typecheck",
		gateKey: SLOT_GATE_KEYS.typecheck,
		command: `${runner$1} mypy .`,
		source
	});
	if (mentions("pytest")) out.push({
		slot: "test.unit",
		gateKey: SLOT_GATE_KEYS["test.unit"],
		command: `${runner$1} pytest`,
		source
	});
	if (mentions("ruff")) out.push({
		slot: "lint",
		gateKey: SLOT_GATE_KEYS.lint,
		command: `${runner$1} ruff check .`,
		source
	});
	return out;
}
/**
* The command slots the repository's manifests suggest, one proposal per slot
* at most (the first manifest that has one wins, in the order package.json,
* Cargo.toml, go.mod, pyproject.toml, composer.json), in slot order.
*/
function detectCommandSlots(root, readFile) {
	const all = [
		...fromPackageJson(root, readFile),
		...fromCargoToml(root, readFile),
		...fromGoMod(root, readFile),
		...fromPyproject(root, readFile),
		...fromComposerJson(root, readFile)
	];
	const out = [];
	for (const slot of COMMAND_SLOT_IDS) {
		const first = all.find((p) => p.slot === slot);
		if (first) out.push(first);
	}
	return out;
}
/**
* The NESTED config a slot's command goes under: `test.unit` is
* `{ cmd: { test: { unit: command } } }`. A dotted key is refused by the
* binding validator and never read, so it is never written.
*/
function slotConfig(slot, command) {
	const path = slot.split(".");
	let node = { [path[path.length - 1]]: command };
	for (let i = path.length - 2; i >= 0; i--) node = { [path[i]]: node };
	return { cmd: node };
}
/**
* [issue:ENG-8225] The ast-grep language a repository's manifest names, for
* AST Pattern's default (`params.ast_pattern.language`). None for a
* `package.json` repository: the gate type already defaults to TypeScript
* and Tsx. None when manifests disagree, rather than a guess.
*/
function detectAstGrepLanguage(root, read) {
	const has = (f) => read(join(root, f)) != null;
	if (has("package.json")) return null;
	const found = [
		has("Cargo.toml") ? "Rust" : null,
		has("go.mod") ? "Go" : null,
		has("pyproject.toml") || has("setup.py") || has("requirements.txt") ? "Python" : null,
		has("pom.xml") || has("build.gradle") || has("build.gradle.kts") ? "Java" : null
	].filter((l) => l !== null);
	return found.length === 1 ? found[0] : null;
}
/** Counts ast-grep's JSON matches and fails below `{min_matches}`. */
const MATCH_COUNTERS = [
	["node", `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const n=JSON.parse(s).length;if(n<{min_matches})process.exit(1);console.log('PASS '+n)})"`],
	["python3", `python3 -c "import json,sys;n=len(json.load(sys.stdin));print('PASS',n);sys.exit(0 if n>={min_matches} else 1)"`],
	["jq", `jq -e 'length >= {min_matches}'`]
];
/**
* [issue:ENG-8225] The AST Pattern slot (`cmd.ast_pattern`), proposed when
* ast-grep is installed: from the repository's `node_modules` (run with
* `npx --no-install`, so a checkout without it fails rather than fetching a
* package of the same name) or on the PATH (Homebrew, cargo, pip). Its
* matches are counted with the first of node, python3 or jq on the PATH.
* Offered unselected, like every slot.
*/
function detectAstPatternSlot(root, read, which) {
	const local = read(join(root, "node_modules/@ast-grep/cli/package.json")) != null;
	const runner$1 = local ? "npx --no-install ast-grep" : which("ast-grep") ? "ast-grep" : null;
	if (runner$1 === null) return "no-ast-grep";
	const counter = MATCH_COUNTERS.find(([bin]) => which(bin));
	if (!counter) return "no-counter";
	const language = detectAstGrepLanguage(root, read);
	return {
		slot: "ast_pattern",
		gateKey: SLOT_GATE_KEYS.ast_pattern,
		command: `${runner$1} scan --inline-rules {rule} --json {path} | ${counter[1]}`,
		source: local ? "node_modules/@ast-grep/cli" : `ast-grep on the PATH${language ? `, ${language}` : ""}`,
		...language ? { extraConfig: { params: { ast_pattern: { language } } } } : {}
	};
}

//#endregion
//#region src/commands/gates/setupHandler.ts
/** Exit code for a prompt cancelled with Ctrl+C (shared with D9's wizard). */
const EXIT_CANCELLED = 130;
const OWNER_ADMIN_MESSAGE = "Only workspace Owners/Admins can configure gates. Ask an Owner or Admin to run `levr gates setup`, or to give you the Admin role.";
const PROVIDERS = [
	{
		value: "github",
		label: "GitHub (Enterprise Server)"
	},
	{
		value: "gitlab",
		label: "GitLab (self-managed)"
	},
	{
		value: "bitbucket",
		label: "Bitbucket (Data Center)"
	},
	{
		value: "other",
		label: "Other"
	}
];
/** Raised to stop the flow with an exit code; the message is already written. */
var Stop = class extends Error {
	constructor(exitCode) {
		super(`stop ${exitCode}`);
		this.exitCode = exitCode;
	}
};
/** The server's own message for a refusal (Nest puts it in `message`). */
function serverMessage(body, status) {
	if (body && typeof body === "object") {
		const m = body.message;
		if (typeof m === "string") return m;
		if (Array.isArray(m)) return m.map(String).join("; ");
	}
	if (typeof body === "string" && body.trim()) return body.trim();
	return `HTTP ${status}`;
}
const sameKey = (a, b) => a != null && b != null && a.toLowerCase() === b.toLowerCase();
function tierLabel(repoKey) {
	return repoKey ? repoKey : "workspace-wide";
}
/** What a binding holds, for a person: `judge: codex`, `cmd.typecheck: tsc`. */
function describeConfig(gateKey, config) {
	if (JUDGE_GATE_KEYS.includes(gateKey)) {
		const judge = config["judge"];
		if (typeof judge === "string") return `judge: ${judge}`;
		if (judge && typeof judge === "object") {
			const name = judge.name;
			return `judge: ${typeof name === "string" ? name : "custom"}`;
		}
		return "no judge";
	}
	const parts = [];
	const walk = (node, at) => {
		if (typeof node === "string") {
			parts.push(`${at}: ${node}`);
			return;
		}
		if (node && typeof node === "object" && !Array.isArray(node)) for (const [k, v] of Object.entries(node)) walk(v, at ? `${at}.${k}` : k);
	};
	walk(config, "");
	return parts.join(", ") || "{}";
}
/** What a stored judge binding is, for the replace question. */
function storedJudgeLabel(row) {
	if (row.enabled === false) return "disabled";
	const judge = row.config?.["judge"];
	if (typeof judge === "string") return judge;
	if (judge && typeof judge === "object") {
		const name = judge.name;
		return typeof name === "string" ? name : "custom";
	}
	return "no judge";
}
/** The slot a written binding configures, for messages: `cmd.typecheck (typecheck)`. */
function slotName(entry) {
	if (JUDGE_GATE_KEYS.includes(entry.gate_key)) return `${entry.gate_key} judge`;
	const cmd = entry.config["cmd"];
	const path = ["cmd"];
	let node = cmd;
	while (node && typeof node === "object" && !Array.isArray(node)) {
		const keys = Object.keys(node);
		if (keys.length !== 1) break;
		path.push(keys[0]);
		node = node[keys[0]];
	}
	return `${path.join(".")} (${entry.gate_key})`;
}
const SLOT_LABELS = {
	typecheck: "Typecheck",
	"test.unit": "Unit tests",
	"test.e2e": "E2E tests",
	lint: "Lint",
	ast_pattern: "AST pattern"
};
/**
* The setup flow, with every effect injected. Returns what to print and the
* exit code; nothing here touches the process.
*/
async function executeGatesSetup(flags, deps) {
	const out = new OutputLines(deps.write);
	const err = new OutputLines(deps.writeErr);
	const finish = (exitCode) => ({
		exitCode,
		stdout: out.text(),
		stderr: err.text()
	});
	try {
		await runSetup(flags, deps, out, err);
		return finish(0);
	} catch (e) {
		if (e instanceof Stop) return finish(e.exitCode);
		throw e;
	}
}
/**
* Lines of output: kept for the outcome, and streamed through `sink` (when
* given) the moment each is pushed, so nothing waits for the exit.
*/
var OutputLines = class {
	lines = [];
	constructor(sink) {
		this.sink = sink;
	}
	push(...lines) {
		this.lines.push(...lines);
		if (this.sink) for (const line of lines) this.sink(`${line}\n`);
	}
	get length() {
		return this.lines.length;
	}
	text() {
		return this.lines.length ? `${this.lines.join("\n")}\n` : "";
	}
};
async function runSetup(flags, deps, out, err) {
	const interactive = !flags.yes;
	const fail = (code, message) => {
		err.push(`gates setup: ${message}`);
		throw new Stop(code);
	};
	const cancelled = () => {
		out.push("Cancelled. Gate settings not written.");
		throw new Stop(EXIT_CANCELLED);
	};
	const answered = (value) => value === null ? cancelled() : value;
	/** A request; a 403 is the Owner/Admin message, anything else its own. */
	const request = async (what, run, opts = {}) => {
		let reply;
		try {
			reply = await run();
		} catch (e) {
			return fail(1, `${what} failed: ${e instanceof Error ? e.message : String(e)}`);
		}
		if (reply.status === 403) {
			err.push(OWNER_ADMIN_MESSAGE);
			if (opts.forbiddenContinues) return null;
			throw new Stop(1);
		}
		if (reply.status < 200 || reply.status >= 300) return fail(1, `${what} refused: ${serverMessage(reply.body, reply.status)}`);
		return reply;
	};
	if (flags.judge !== void 0 && !isJudgePresetId(flags.judge)) fail(2, `--judge "${flags.judge}" is not a judge preset (${JUDGE_PRESET_IDS.join(", ")}). A custom judge is set up over MCP: run without --judge to print the prompt.`);
	const repo = await resolveRepoContext({
		cwd: deps.cwd,
		git: deps.git,
		ssh: deps.ssh,
		askIsSshAlias: async (host) => interactive ? await deps.prompts.confirm({
			message: `The remote's host "${host}" is no provider's default host. Is it an ssh alias from your ~/.ssh/config?`,
			initialValue: false
		}) === true : false,
		note: (line) => out.push(line)
	});
	if (!repo.ok) {
		err.push(repo.message);
		throw new Stop(repo.exitCode);
	}
	const ctx = repo.context;
	out.push(`Repository: ${ctx.root}${ctx.remote ? ` (origin ${ctx.remote})` : " (no origin remote)"}`);
	if (deps.connect) {
		const connected = await deps.connect();
		if (!connected.ok) fail(1, connected.message);
	}
	const stored = ((await request("reading the workspace gate configuration", () => deps.exportConfig()))?.body)?.bindings ?? [];
	let repoKey = null;
	if (ctx.remote) {
		const remote = ctx.remote;
		const found = ((await request("resolving the remote", () => deps.resolveRemote(remote)))?.body)?.repository;
		if (found) {
			repoKey = found.repo_key;
			out.push(`Repository in Levr: ${repoKey}`);
		} else if (!interactive) out.push(`${remote} is not in the workspace's repository catalog; --yes does not add it. Run without --yes to add it.`);
		else {
			let provider;
			if (!ctx.isDefaultProviderHost) provider = answered(await deps.prompts.select({
				message: `Which provider serves ${ctx.host ?? remote}?`,
				options: PROVIDERS
			}));
			if (answered(await deps.prompts.confirm({
				message: `${remote} is not in the workspace's repository catalog. Add it, so gate settings can be scoped to it?`,
				initialValue: true
			}))) {
				const created = await request("adding the repository", () => deps.createRepository(remote, provider), { forbiddenContinues: true });
				if (created) {
					repoKey = created.body.repo_key ?? null;
					if (repoKey) out.push(`Added the repository: ${repoKey}`);
				} else err.push("Continuing at workspace tier.");
			}
		}
	}
	let scopeKey = null;
	if (repoKey) {
		const key = repoKey;
		if (stored.some((b) => sameKey(b.repo_key, key))) {
			scopeKey = key;
			out.push(`Scope: repository ${key} (the workspace already has gate settings for it)`);
		} else if (interactive && answered(await deps.prompts.confirm({
			message: `Write these gate settings for ${key} only? No writes them for the whole workspace.`,
			initialValue: false
		}))) {
			scopeKey = key;
			out.push(`Scope: repository ${key} (chosen)`);
		}
	}
	if (!scopeKey) out.push("Scope: workspace (every repository)");
	const atTier = (gate_key, config) => ({
		gate_key,
		...scopeKey ? { repo_key: scopeKey } : {},
		enabled: true,
		config
	});
	const storedAtTier = (gateKey) => stored.find((b) => b.gate_key === gateKey && (b.repo_key ?? null) === scopeKey && (b.path_prefix ?? null) === null);
	const detected = JUDGE_PRESET_IDS.filter((id) => deps.which(JUDGE_PRESETS[id].bin));
	let judge = null;
	if (flags.judge !== void 0) {
		judge = flags.judge;
		out.push(`Judge: ${judge} (--judge)`);
	} else if (interactive && detected.length === 1) {
		judge = detected[0];
		out.push(`Judge: ${judge} (the one judge CLI on PATH)`);
	} else if (interactive && detected.length > 1) for (;;) {
		const checked = answered(await deps.prompts.multiselect({
			message: "Several judge CLIs are on PATH. Toggle the one the judge gates should run (Space), then Enter. Enter with none checked chooses later.",
			options: detected.map((id) => ({
				value: id,
				label: id
			})),
			initialValues: [],
			required: false
		}));
		if (checked.length > 1) {
			out.push(`Choose one judge, not ${checked.length} (${checked.join(", ")}). Asking again.`);
			continue;
		}
		if (checked.length === 1) {
			judge = checked[0];
			out.push(`Judge: ${judge} (chosen)`);
		} else out.push("Judge: none chosen (the judge gates stay unconfigured)");
		break;
	}
	if (judge === null) out.push("", buildJudgeSetupPrompt({ detected }), "");
	const entries = [];
	let replaceJudge = false;
	if (judge !== null) {
		const wanted = { judge };
		const differing = JUDGE_GATE_KEYS.map((k) => storedAtTier(k)).filter((row) => row !== void 0 && !(row.enabled !== false && jsonEqual(row.config ?? {}, wanted)));
		let keep = true;
		if (differing.length > 0) {
			const labels = [...new Set(differing.map(storedJudgeLabel))].join(", ");
			if (interactive) replaceJudge = answered(await deps.prompts.confirm({
				message: `Replace the existing judge setting (${labels}) with ${judge}?`,
				initialValue: false
			}));
			if (!replaceJudge) {
				keep = false;
				out.push(`Kept the existing judge setting (${labels}).${interactive ? "" : " --yes never replaces one; run without --yes, or use `levr gates bindings import --replace-judge`."}`);
			}
		}
		if (keep) for (const key of JUDGE_GATE_KEYS) entries.push(atTier(key, { judge }));
	}
	const proposals = detectCommandSlots(ctx.root, deps.readFile);
	const ast = detectAstPatternSlot(ctx.root, deps.readFile, deps.which);
	if (typeof ast === "string") out.push(ast === "no-ast-grep" ? "AST pattern: not offered, ast-grep is not installed (npm i -D @ast-grep/cli, brew install ast-grep, cargo install ast-grep, or pip install ast-grep-cli)." : "AST pattern: not offered, counting its matches needs node, python3 or jq on the PATH.");
	else proposals.push(ast);
	if (!interactive && proposals.length > 0) {
		out.push("Detected commands (not written: --yes takes only what was passed):");
		for (const p of proposals) out.push(`  ${p.slot}: ${p.command}  (${p.source})`);
	}
	if (interactive && proposals.length > 0) {
		const checked = answered(await deps.prompts.multiselect({
			message: "Detected commands. Check the ones to write (Space), then Enter. Enter with none checked writes none.",
			options: proposals.map((p) => ({
				value: p.slot,
				label: `${SLOT_LABELS[p.slot] ?? p.slot} (${p.gateKey}): ${p.command}`,
				hint: `from ${p.source}`
			})),
			initialValues: [],
			required: false
		}));
		const chosen = proposals.filter((p) => checked.includes(p.slot));
		const toEdit = chosen.length === 0 ? [] : answered(await deps.prompts.multiselect({
			message: "Edit any of these commands before writing? Check the ones to edit, then Enter. Enter with none checked writes them as shown.",
			options: chosen.map((p) => ({
				value: p.slot,
				label: `${SLOT_LABELS[p.slot] ?? p.slot}: ${p.command}`
			})),
			initialValues: [],
			required: false
		}));
		for (const p of chosen) {
			let command = p.command;
			if (toEdit.includes(p.slot)) {
				command = answered(await deps.prompts.text({
					message: `Command for ${p.slot} (empty skips the slot)`,
					initialValue: p.command
				})).trim();
				if (command === "") continue;
			}
			entries.push(atTier(p.gateKey, {
				...slotConfig(p.slot, command),
				...p.extraConfig ?? {}
			}));
		}
	}
	if (entries.length === 0) {
		out.push("Nothing to write.");
		return;
	}
	const payload = {
		description: "Written by levr gates setup",
		bindings: entries
	};
	try {
		validatePayload(parsePayload(payload));
	} catch (e) {
		if (e instanceof PayloadError) fail(2, `refused, nothing sent: ${e.message}`);
		throw e;
	}
	const printPlan = (rows) => {
		for (const r of rows) {
			const note = r.action === "differs" ? "  (NOT applied: the stored row differs)" : r.action === "replace" ? "  (the stored judge setting is replaced)" : "";
			const technique = r.technique ? ` (${r.technique})` : "";
			const entry = entries.find((e) => e.gate_key === r.gate_key && (e.repo_key ?? null) === (r.repo_key ?? null));
			const sets = entry ? `  ${describeConfig(entry.gate_key, entry.config)}` : "";
			out.push(`${r.action.padEnd(8)} ${r.gate_key}${technique} [${tierLabel(r.repo_key)}]${sets}${note}`);
		}
	};
	const previewRows = ((await request("previewing the import", () => deps.importConfig(payload, {
		dryRun: true,
		replaceJudge
	})))?.body)?.bindings ?? [];
	out.push("Dry run:");
	printPlan(previewRows);
	const differsIn = (rows) => rows.filter((r) => r.action === "differs").length;
	const reportDiffers = (rows) => {
		const n = differsIn(rows);
		if (n > 0) {
			err.push(`gates setup: ${n} row(s) differ from what the workspace stores and are not written; change them in the workspace on purpose, or delete them and run setup again.`);
			throw new Stop(1);
		}
	};
	if (flags["dry-run"]) {
		out.push("# Dry run: nothing written. Run again without --dry-run to apply.");
		reportDiffers(previewRows);
		return;
	}
	if (interactive && !answered(await deps.prompts.confirm({
		message: "Write these gate settings?",
		initialValue: true
	}))) {
		out.push("Gate settings not written.");
		return;
	}
	const appliedRows = ((await request("writing the bindings", () => deps.importConfig(payload, {
		dryRun: false,
		replaceJudge
	})))?.body)?.bindings ?? [];
	printPlan(appliedRows);
	out.push(`# Applied: ${appliedRows.filter((r) => r.applied).length} row(s) written.`);
	const now = ((await request("reading the bindings back", () => deps.exportConfig()))?.body)?.bindings ?? [];
	const mismatches = [];
	entries.forEach((entry, i) => {
		if (appliedRows[i]?.action === "differs") return;
		const tier = entry.repo_key ?? null;
		const row = now.find((b) => b.gate_key === entry.gate_key && (b.repo_key ?? null) === tier && (b.path_prefix ?? null) === null);
		if (!row) mismatches.push(`read-back mismatch: ${slotName(entry)} [${tierLabel(tier)}] is not in the workspace`);
		else if (row.enabled !== true || !jsonEqual(row.config ?? {}, entry.config)) mismatches.push(`read-back mismatch: ${slotName(entry)} [${tierLabel(tier)}]: wrote ${describeConfig(entry.gate_key, entry.config)}, the workspace has ${row.enabled === false ? "it disabled" : describeConfig(row.gate_key, row.config ?? {})}`);
		else out.push(`Read back: ${entry.gate_key} [${tierLabel(tier)}] ${describeConfig(entry.gate_key, row.config)}`);
	});
	if (mismatches.length > 0) {
		for (const m of mismatches) err.push(`gates setup: ${m}`);
		throw new Stop(1);
	}
	if (scopeKey && ctx.remote) {
		const remote = ctx.remote;
		const key = scopeKey;
		const reach = ((await request("checking the repository key", () => deps.resolveRemote(remote)))?.body)?.repository;
		if (!(reach != null && (reach.repository_ref_id != null || reach.github_repository_id != null) && sameKey(reach.repo_key, key))) fail(1, `the gate settings were written for repository key "${key}", but no repository an issue can link carries that key, so no issue will read them. If ${ctx.host ?? "the remote host"} is an ssh alias, run setup again and answer yes to the ssh alias question; otherwise add the repository in Levr.`);
	}
	reportDiffers(appliedRows);
}
/** git, ssh: spawned with an argv, never a shell string. */
function runner(program, timeoutMs) {
	return (args, cwd) => {
		const r = spawnSync(program, [...args], {
			cwd,
			encoding: "utf8",
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			],
			...timeoutMs ? { timeout: timeoutMs } : {}
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
	const p = await import("@clack/prompts");
	return {
		async select(o) {
			const v = await p.select({
				message: o.message,
				options: o.options.map((x) => x.hint === void 0 ? {
					value: x.value,
					label: x.label
				} : {
					value: x.value,
					label: x.label,
					hint: x.hint
				})
			});
			return p.isCancel(v) ? null : v;
		},
		async multiselect(o) {
			const v = await p.multiselect({
				message: o.message,
				options: o.options.map((x) => x.hint === void 0 ? {
					value: x.value,
					label: x.label
				} : {
					value: x.value,
					label: x.label,
					hint: x.hint
				}),
				initialValues: o.initialValues,
				required: o.required
			});
			return p.isCancel(v) ? null : v;
		},
		async confirm(o) {
			const v = await p.confirm(o);
			return p.isCancel(v) ? null : v;
		},
		async text(o) {
			const v = await p.text({
				message: o.message,
				initialValue: o.initialValue
			});
			return p.isCancel(v) ? null : v;
		}
	};
}
function liveDeps(ctx, flags, prompts) {
	const reply = (r) => ({
		status: r.response.status,
		body: r.ok ? r.data : r.error
	});
	return {
		cwd: ctx.process.cwd(),
		git: runner("git"),
		ssh: runner("ssh", 1e4),
		which: (bin) => whichSync(bin, defaultEnv()),
		readFile: (p) => {
			try {
				return fs.readFileSync(p, "utf8");
			} catch {
				return null;
			}
		},
		prompts,
		connect: async () => {
			try {
				const auth = await resolveToken();
				configureClient(auth);
				const ws = await resolveWorkspaceFor(auth, flags["workspace-id"]);
				if (ws) client.setConfig({
					...client.getConfig(),
					workspaceId: ws.workspaceId
				});
				return { ok: true };
			} catch (e) {
				return {
					ok: false,
					message: e instanceof Error ? e.message : "Authentication failed."
				};
			}
		},
		resolveRemote: async (remote) => reply(await repositoryRefCatalogResolveByRemoteV1({ query: { remote } })),
		createRepository: async (remote, provider) => reply(await repositoryRefCatalogCreateV1({ body: {
			remote,
			...provider ? { provider } : {}
		} })),
		exportConfig: async () => reply(await gateBindingTransferExportConfigV1()),
		importConfig: async (payload, opts) => {
			const query = {
				...opts.dryRun ? { dry_run: "true" } : {},
				...opts.replaceJudge ? { replace_judge: "true" } : {}
			};
			return reply(await gateBindingTransferImportConfigV1({
				body: payload,
				...Object.keys(query).length > 0 ? { query } : {}
			}));
		}
	};
}
async function gatesSetupHandler(flags) {
	if (!flags.yes && this.process.stdin.isTTY !== true) {
		this.process.stderr.write("gates setup: asks questions, and stdin is not a terminal. Run it in a terminal, or pass --yes (with --judge) to accept only what you pass.\n");
		this.process.exitCode = 2;
		return;
	}
	const prompts = await clackPrompts();
	const deps = liveDeps(this, flags, prompts);
	deps.write = (text) => this.process.stdout.write(text);
	deps.writeErr = (text) => this.process.stderr.write(text);
	const outcome = await executeGatesSetup(flags, deps);
	this.process.exitCode = outcome.exitCode;
}
/**
* [issue:ENG-8227] Read-only: what setup would still offer here, so the
* wizard does not ask again in a repository already set up (user report
* 2026-11-11: bare `levr` asked every run). A setting applies when it is
* enabled at the workspace tier or at THIS repository's tier. Missing: the
* judge when no judge gate type has a setting, and each slot setup detects
* (the manifest commands, AST pattern) whose gate type has none. Never
* prompts and never writes. Null when it cannot tell (not a repository, not
* signed in, the read refused): the caller then asks as before.
*/
async function gatesSetupStatus(deps) {
	const repo = await resolveRepoContext({
		cwd: deps.cwd,
		git: deps.git,
		ssh: deps.ssh,
		askIsSshAlias: () => Promise.resolve(false),
		note: () => {}
	});
	if (!repo.ok) return null;
	if (deps.connect && !(await deps.connect()).ok) return null;
	const exported = await deps.exportConfig();
	if (exported.status >= 400) return null;
	const stored = exported.body?.bindings ?? [];
	let repoKey = null;
	if (repo.context.remote) {
		const resolved = await deps.resolveRemote(repo.context.remote);
		if (resolved.status < 400) repoKey = resolved.body?.repository?.repo_key ?? null;
	}
	const here = stored.filter((b) => b.enabled !== false && (b.path_prefix ?? null) === null && ((b.repo_key ?? null) === null || b.repo_key === repoKey));
	const applies = (gateKey) => here.some((b) => b.gate_key === gateKey);
	const missing = [];
	if (!JUDGE_GATE_KEYS.some(applies)) missing.push("judge");
	const proposals = detectCommandSlots(repo.context.root, deps.readFile);
	const ast = detectAstPatternSlot(repo.context.root, deps.readFile, deps.which);
	if (typeof ast !== "string") proposals.push(ast);
	for (const p of proposals) if (!applies(p.gateKey)) missing.push(SLOT_LABELS[p.slot] ?? p.slot);
	return {
		missing,
		anyConfigured: here.length > 0
	};
}
/** {@link gatesSetupStatus} with the live repository, session and API. */
async function liveGatesSetupStatus(ctx) {
	const silent = {
		select: () => Promise.resolve(null),
		multiselect: () => Promise.resolve(null),
		confirm: () => Promise.resolve(null),
		text: () => Promise.resolve(null)
	};
	const deps = liveDeps(ctx, {
		"dry-run": true,
		yes: true
	}, silent);
	try {
		return await gatesSetupStatus(deps);
	} catch {
		return null;
	}
}

//#endregion
export { gatesSetupHandler, liveGatesSetupStatus };