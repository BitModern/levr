import { appendActualResult, createComment } from "./sdk-client-B_urshDp.js";
import "./env-CdwyPHGV.js";
import "./token-refresh-DeusLK8H.js";
import "./resolve-token-7xb7kG7h.js";
import "./workspace-store-CnrxyYRB.js";
import "./resolve-workspace-Dsm8Xzut.js";
import { connect } from "./connect-CPybjrXT.js";
import "./sleep-BpJ39Ypm.js";
import { TargetParseError, embedMarkdown, parseTarget, uploadArtifactFile } from "./artifact-upload-BnqeVY_b.js";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

//#region src/commands/attachHandler.ts
/**
* `levr attach` (ENG-6164 D4). fail_closed: any file that fails or is
* skipped, and any failed embed write, exits 1 — an explicit attach is a
* request, unlike `levr push --artifacts`.
*
* Visibility: every upload is private, --embed included (ENG-6165 code
* review F-006). Levr serves a private attachment's url to any signed-in
* workspace member, so the embedded link renders in Levr without making the
* file readable by anyone holding the link. --embed writes
* append-only — a NEW comment on an issue, test or run, or a server-side
* `append_actual_result` on an execution result — never a rewrite of
* entity text (audit A3).
*/
async function attachHandler(flags, ...args) {
	if (flags.verbose) this.logger.setVerbose(true);
	let jobs;
	try {
		jobs = flags.manifest ? readManifest(flags.manifest) : [singleJob(args, flags)];
	} catch (err) {
		this.logger.error(err instanceof Error ? err.message : String(err));
		this.process.exitCode = 1;
		return;
	}
	if (flags.embed) {
		for (const job of jobs) if (!embedWriter(job.target)) {
			this.logger.error(`--embed is not supported for ${job.target.relatedType} targets (issue, test, run or run_result_variant only).`);
			this.process.exitCode = 1;
			return;
		}
	}
	if (!await connect(this, flags["workspace-id"])) return;
	let failed = false;
	for (const job of jobs) {
		const uploaded = [];
		for (const file of job.files) {
			const result = await uploadArtifactFile({
				target: job.target,
				filePath: file,
				kind: job.kind,
				attemptIndex: job.attempt
			});
			report(this, file, result);
			if (result.status === "uploaded" || result.status === "deduplicated") {
				if (result.url && result.target_id) uploaded.push({
					name: basename(file),
					url: result.url,
					targetId: result.target_id
				});
			} else failed = true;
		}
		const first = uploaded[0];
		if (flags.embed && first) {
			const markdown = uploaded.map((u) => embedMarkdown(u.name, u.url)).join("\n");
			try {
				await writeEmbed(job.target, first.targetId, markdown);
				this.process.stdout.write(`  embedded ${uploaded.length} file(s) on ${job.target.relatedId}\n`);
			} catch (err) {
				this.logger.error(`Embed failed for ${job.target.relatedId}: ${err instanceof Error ? err.message : String(err)}`);
				failed = true;
			}
		}
	}
	if (failed) this.process.exitCode = 1;
}
function singleJob(args, flags) {
	const [targetArg, ...files] = args;
	if (!targetArg || files.length === 0) throw new Error("Usage: levr attach <target> <files...>  (or levr attach --manifest <json>)");
	return {
		target: parseTarget(targetArg),
		files,
		kind: flags.kind,
		attempt: flags.attempt
	};
}
/** `[{ target, files[], kind?, attempt? }]` — validated before any upload. */
function readManifest(file) {
	let raw;
	try {
		raw = JSON.parse(readFileSync(file, "utf8"));
	} catch (err) {
		throw new Error(`Cannot read manifest ${file}: ${err instanceof Error ? err.message : String(err)}`);
	}
	if (!Array.isArray(raw)) throw new Error(`Manifest ${file} must be a JSON array`);
	return raw.map((entry, i) => {
		const e = entry;
		if (typeof e?.target !== "string") throw new Error(`Manifest entry ${i}: "target" must be a string`);
		if (!Array.isArray(e.files) || e.files.length === 0 || !e.files.every((f) => typeof f === "string")) throw new Error(`Manifest entry ${i}: "files" must be a string array`);
		if (e.attempt !== void 0 && !(Number.isInteger(e.attempt) && e.attempt >= 0)) throw new Error(`Manifest entry ${i}: "attempt" must be an integer >= 0`);
		try {
			return {
				target: parseTarget(e.target),
				files: e.files,
				kind: typeof e.kind === "string" ? e.kind : void 0,
				attempt: e.attempt
			};
		} catch (err) {
			if (err instanceof TargetParseError) throw new Error(`Manifest entry ${i}: ${err.message}`);
			throw err;
		}
	});
}
function embedWriter(target) {
	if (target.relatedType === "run_result_variant") return "actual_result";
	if (target.relatedType === "issue" || target.relatedType === "test" || target.relatedType === "run") return "comment";
}
/** Append-only: a new comment, or the server-side actual-result append. */
async function writeEmbed(target, targetId, markdown) {
	if (embedWriter(target) === "actual_result") {
		await appendActualResult(targetId, markdown);
		return;
	}
	await createComment(target.relatedType, targetId, markdown);
}
function report(ctx, file, result) {
	switch (result.status) {
		case "uploaded":
			ctx.process.stdout.write(`  attached ${file} (${result.id})\n`);
			return;
		case "deduplicated":
			ctx.process.stdout.write(`  already attached ${file} (${result.id})\n`);
			return;
		case "skipped":
			ctx.logger.warning(`skipped ${file}: larger than 50 MiB`);
			return;
		case "missing":
			ctx.logger.error(`not found: ${file}`);
			return;
		case "rejected":
			ctx.logger.error(`refused ${file}: ${result.message}`);
			return;
		case "failed":
			ctx.logger.error(`failed ${file}: ${result.message}`);
			return;
	}
}

//#endregion
export { attachHandler };