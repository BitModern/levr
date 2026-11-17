import "./gate-op-CvE5u-xj.js";
import { client, configureClient } from "./sdk-client-COhVazCc.js";
import { PayloadError, gateBindingTransferExportConfigV1, gateBindingTransferImportConfigV1, missingFiles, namedFiles, parsePayload, validatePayload } from "./dist-CjYnrSGu.js";
import "./token-refresh-ChElPPiG.js";
import "./env-D31eVXPZ.js";
import { resolveToken } from "./resolve-token-QPDOFGfO.js";
import "./workspace-store-DYXnmPDY.js";
import { resolveWorkspaceFor } from "./resolve-workspace-Q8FOM4UC.js";
import * as fs from "node:fs";
import * as path$1 from "node:path";

//#region src/commands/gates/bindingsHandler.ts
function fail(code, cmd, message) {
	return {
		exitCode: code,
		stdout: "",
		stderr: `gates bindings ${cmd}: ${message}\n`
	};
}
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
function tierLabel(b) {
	if (b.repo_key == null) return "workspace-wide";
	return b.path_prefix ? `${b.repo_key}:${b.path_prefix}` : b.repo_key;
}
/** `export`: the file on stdout, or written to `--out`. */
async function executeBindingsExport(flags, deps) {
	let reply;
	try {
		reply = await deps.exportConfig();
	} catch (err) {
		return fail(1, "export", `request failed: ${err instanceof Error ? err.message : String(err)}`);
	}
	if (reply.status !== 200) return fail(1, "export", serverMessage(reply.body, reply.status));
	const text = `${JSON.stringify(reply.body, null, 2)}\n`;
	if (!flags.out) return {
		exitCode: 0,
		stdout: text,
		stderr: ""
	};
	try {
		deps.writeFile(flags.out, text);
	} catch (err) {
		return fail(2, "export", `cannot write ${flags.out}: ${err instanceof Error ? err.message : String(err)}`);
	}
	const body = reply.body;
	return {
		exitCode: 0,
		stdout: "",
		stderr: `Wrote ${flags.out}: ${body.bindings?.length ?? 0} binding(s), ${body.definitions?.length ?? 0} definition(s).\n`
	};
}
/** `import <file>`: check locally, then apply (or preview with --dry-run). */
async function executeBindingsImport(flags, file, deps) {
	let raw;
	try {
		raw = JSON.parse(deps.readFile(file));
	} catch (err) {
		return fail(2, "import", `cannot read ${file} as JSON: ${err instanceof Error ? err.message : String(err)}`);
	}
	let payload;
	try {
		payload = parsePayload(raw);
		validatePayload(payload);
	} catch (err) {
		if (err instanceof PayloadError) return fail(2, "import", `${file} refused, nothing sent: ${err.message}`);
		throw err;
	}
	const out = [];
	if (flags["repo-root"]) {
		const root = flags["repo-root"];
		const missing = missingFiles(payload, (rel) => deps.exists(root, rel));
		for (const f of namedFiles(payload)) out.push(`${missing.includes(f) ? "MISSING" : "present"}  ${f}`);
		if (missing.length > 0) return {
			exitCode: 1,
			stdout: `${out.join("\n")}\n`,
			stderr: `gates bindings import: ${missing.length} file(s) the lanes name are missing under ${root}; nothing sent\n`
		};
	}
	let reply;
	try {
		reply = flags["replace-judge"] ? await deps.importConfig(raw, flags["dry-run"], { replaceJudge: true }) : await deps.importConfig(raw, flags["dry-run"]);
	} catch (err) {
		return fail(1, "import", `request failed: ${err instanceof Error ? err.message : String(err)}` + (flags["dry-run"] ? "" : " (the import may or may not have been applied; run it with --dry-run to see)"));
	}
	if (reply.status !== 200) return fail(1, "import", serverMessage(reply.body, reply.status));
	const result = reply.body;
	for (const d of result.definitions ?? []) out.push(`${d.action.padEnd(8)} definition ${d.key}`);
	for (const b of result.bindings ?? []) {
		const differs$1 = b.action === "differs" ? "  (NOT applied: the stored row differs)" : b.action === "replace" ? "  (the stored judge binding is replaced)" : "";
		const note = b.note ? `  # ${b.note}` : "";
		out.push(`${b.action.padEnd(8)} ${b.gate_key} [${tierLabel(b)}]${differs$1}${note}`);
	}
	const rows = [...result.definitions ?? [], ...result.bindings ?? []];
	const written = rows.filter((r) => r.applied).length;
	out.push(result.dry_run ? "# Dry run: nothing written. Run again without --dry-run to apply." : `# Applied: ${written} row(s) written.`);
	const differs = rows.filter((r) => r.action === "differs").length;
	return {
		exitCode: differs > 0 ? 1 : 0,
		stdout: `${out.join("\n")}\n`,
		stderr: differs > 0 ? `gates bindings import: ${differs} row(s) differ from what the workspace stores and were not applied; change them in the workspace on purpose, or delete them and import again.\n` : ""
	};
}
/** The real dependencies: the logged-in backend (the public SDK), the disk. */
async function liveDeps(workspaceFlag) {
	let auth;
	try {
		auth = await resolveToken();
	} catch (err) {
		return fail(1, "auth", err instanceof Error ? err.message : "Authentication failed.");
	}
	configureClient(auth);
	try {
		const ws = await resolveWorkspaceFor(auth, workspaceFlag);
		if (ws) client.setConfig({
			...client.getConfig(),
			workspaceId: ws.workspaceId
		});
	} catch (err) {
		return fail(1, "workspace", err instanceof Error ? err.message : "Workspace resolution failed.");
	}
	const reply = (r) => ({
		status: r.response.status,
		body: r.ok ? r.data : r.error
	});
	return {
		exportConfig: async () => reply(await gateBindingTransferExportConfigV1()),
		importConfig: async (file, dryRun, opts) => {
			const query = {
				...dryRun ? { dry_run: "true" } : {},
				...opts?.replaceJudge ? { replace_judge: "true" } : {}
			};
			return reply(await gateBindingTransferImportConfigV1({
				body: file,
				...Object.keys(query).length > 0 ? { query } : {}
			}));
		},
		readFile: (file) => fs.readFileSync(file, "utf8"),
		writeFile: (file, content) => fs.writeFileSync(file, content),
		exists: (root, rel) => fs.existsSync(path$1.join(root, rel))
	};
}
function emit(ctx, outcome) {
	if (outcome.stdout) ctx.process.stdout.write(outcome.stdout);
	if (outcome.stderr) ctx.process.stderr.write(outcome.stderr);
	ctx.process.exitCode = outcome.exitCode;
}
async function gatesBindingsExportHandler(flags) {
	const deps = await liveDeps(flags["workspace-id"]);
	if ("exitCode" in deps) return emit(this, deps);
	emit(this, await executeBindingsExport(flags, deps));
}
async function gatesBindingsImportHandler(flags, file) {
	let preflight = null;
	try {
		validatePayload(parsePayload(JSON.parse(fs.readFileSync(file, "utf8"))));
	} catch (err) {
		preflight = fail(2, "import", err instanceof PayloadError ? `${file} refused, nothing sent: ${err.message}` : `cannot read ${file} as JSON: ${err instanceof Error ? err.message : String(err)}`);
	}
	if (preflight) return emit(this, preflight);
	const deps = await liveDeps(flags["workspace-id"]);
	if ("exitCode" in deps) return emit(this, deps);
	emit(this, await executeBindingsImport(flags, file, deps));
}

//#endregion
export { gatesBindingsExportHandler, gatesBindingsImportHandler };