import { client, configureClient, uploadImport } from "./sdk-client-CSy2LOEh.js";
import "./token-refresh-cvAydkok.js";
import { getApiUrl, getAutomationSourceIdOverride, getSourceOverride, getTeamId } from "./env-Cv-anxJA.js";
import { resolveToken } from "./resolve-token-BeX-Xegl.js";
import "./workspace-store-BJyB_WEG.js";
import { resolveWorkspaceFor } from "./resolve-workspace-CJN1plpd.js";
import "./sleep-DNLj0FMk.js";
import { resolveArtifactPath, uploadArtifactFile } from "./artifact-upload-t6kL20b5.js";
import { detectCiEnvironment } from "./dist-DU3htaZ_.js";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import ora from "ora";

//#region src/utils/ci-detect.ts
/**
* Auto-detect source name from CI environment.
* Returns undefined if not running in CI.
*/
function detectSource() {
	const ci = detectCiEnvironment();
	if (!ci) return void 0;
	const jobName = process.env["GITHUB_WORKFLOW"] ?? ci.ci_job_name;
	const repo = ci.repository_slug?.split("/").pop();
	if (repo && jobName) return `${repo}/${jobName}`;
	if (jobName) return jobName;
	if (repo) return repo;
	return ci.ci_provider;
}
/**
* Get normalized CI metadata for the import endpoint.
* Field names match `run_context` columns so the backend can
* map them directly to structured columns.
*
* Returns undefined if not running in CI.
*/
function getCiMetadata() {
	return detectCiEnvironment() ?? void 0;
}

//#endregion
//#region src/utils/push-artifacts.ts
const ARTIFACT_UPLOAD_CONCURRENCY = 4;
function formatArtifactSummary(s) {
	return `Artifacts: uploaded ${s.uploaded}, deduplicated ${s.deduplicated}, skipped ${s.skipped} (too large), missing ${s.missing}, rejected ${s.rejected} (outside the working directory), failed ${s.failed}`;
}
async function uploadReportArtifacts(options) {
	const summary = {
		uploaded: 0,
		deduplicated: 0,
		skipped: 0,
		missing: 0,
		rejected: 0,
		failed: 0
	};
	const tasks = [];
	for (const result of options.results) for (const att of result.attachments) {
		if (att.stored || !att.path) continue;
		const ref = att.path;
		const upload = async () => {
			let resolved = resolveArtifactPath(ref, options.artifactsDir, options.root);
			if (resolved && resolved.status === "missing") resolved = resolveArtifactPath(ref, options.reportDir, options.root) ?? resolved;
			if (resolved === null) {
				summary.rejected += 1;
				options.onProblem?.(ref, "rejected");
				return;
			}
			if (resolved.status === "missing") {
				summary.missing += 1;
				options.onProblem?.(ref, { status: "missing" });
				return;
			}
			const outcome = await uploadArtifactFile({
				target: {
					relatedType: "automation_run_result",
					relatedId: result.id
				},
				filePath: resolved.path,
				validated: resolved,
				name: att.name ?? void 0,
				kind: att.kind,
				attemptIndex: att.attempt_index
			});
			switch (outcome.status) {
				case "uploaded":
					summary.uploaded += 1;
					return;
				case "deduplicated":
					summary.deduplicated += 1;
					return;
				case "skipped":
					summary.skipped += 1;
					break;
				case "missing":
					summary.missing += 1;
					break;
				case "rejected":
					summary.rejected += 1;
					break;
				case "failed":
					summary.failed += 1;
					break;
			}
			options.onProblem?.(ref, outcome);
		};
		tasks.push(async () => {
			try {
				await upload();
			} catch (err) {
				summary.failed += 1;
				options.onProblem?.(ref, {
					status: "failed",
					message: err instanceof Error ? err.message : String(err)
				});
			}
		});
	}
	await runBounded(tasks, options.concurrency ?? ARTIFACT_UPLOAD_CONCURRENCY);
	return summary;
}
/** Run tasks with at most `limit` in flight. Tasks must not throw. */
async function runBounded(tasks, limit) {
	let next = 0;
	const worker = async () => {
		while (next < tasks.length) {
			const task = tasks[next++];
			if (task) await task();
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

//#endregion
//#region src/commands/pushHandler.ts
const MAX_FILE_SIZE = 10 * 1024 * 1024;
function formatBytes(bytes) {
	if (bytes < 1024) return `${bytes}B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${kb.toFixed(1)}KB`;
	return `${(kb / 1024).toFixed(1)}MB`;
}
async function pushHandler(flags, file) {
	if (flags.verbose) this.logger.setVerbose(true);
	let auth;
	try {
		auth = await resolveToken();
	} catch (err) {
		this.logger.error(err instanceof Error ? err.message : "Authentication failed.");
		this.process.exitCode = 1;
		return;
	}
	configureClient(auth);
	if (flags.verbose) {
		this.logger.debug(`Auth: ${auth.type.toUpperCase()}`);
		this.logger.debug(`API:  ${getApiUrl()}`);
	}
	try {
		const ws = await resolveWorkspaceFor(auth, flags["workspace-id"]);
		if (ws) {
			client.setConfig({
				...client.getConfig(),
				workspaceId: ws.workspaceId
			});
			if (flags.verbose) this.logger.debug(`Workspace: ${ws.workspaceId} (${ws.source})`);
		} else if (flags.verbose) this.logger.debug("Workspace: the token's own");
	} catch (err) {
		this.logger.error(err instanceof Error ? err.message : "Workspace resolution failed.");
		this.process.exitCode = 1;
		return;
	}
	let fileStat;
	try {
		fileStat = statSync(file);
	} catch {
		this.logger.error(`File not found: ${file}`);
		this.process.exitCode = 1;
		return;
	}
	if (fileStat.size > MAX_FILE_SIZE) {
		const sizeMB = (fileStat.size / (1024 * 1024)).toFixed(1);
		this.logger.error(`File too large (${sizeMB}MB). Maximum is 10MB.`);
		this.process.exitCode = 1;
		return;
	}
	const teamId = getTeamId(flags["team-id"]);
	const sourceName = flags.source ?? getSourceOverride() ?? detectSource();
	let sourceOrigin;
	if (flags.source) sourceOrigin = "explicit";
	else if (getSourceOverride()) sourceOrigin = "LEVR_SOURCE";
	else if (sourceName) sourceOrigin = "auto-detected";
	const automationSourceId = flags["automation-source"] ?? getAutomationSourceIdOverride();
	const automationSourceOrigin = flags["automation-source"] ? "explicit" : automationSourceId ? "LEVR_AUTOMATION_SOURCE_ID" : void 0;
	if (!sourceName && !automationSourceId) {
		this.logger.error("Error: --source is required. Provide it explicitly with --source (or an existing source UUID with --automation-source), set the LEVR_SOURCE env var, or run in a supported CI environment for auto-detection.");
		this.logger.error("");
		this.logger.error("Example:");
		this.logger.error("  levr push results.xml --source backend-unit-tests");
		this.process.exitCode = 1;
		return;
	}
	if (automationSourceId && sourceName && sourceOrigin !== "auto-detected") this.logger.warning(`--automation-source (${automationSourceOrigin}) takes precedence; ignoring source name "${sourceName}" (${sourceOrigin}).`);
	const uploadTeamId = automationSourceId && !flags["team-id"] ? void 0 : teamId;
	const ciMeta = getCiMetadata();
	const outputResults = flags["output-results"];
	const artifactsDir = flags.artifacts;
	const includeResults = Boolean(outputResults || artifactsDir);
	if (flags.verbose) {
		this.logger.debug(`Team: ${uploadTeamId ?? (automationSourceId ? "(automation source's team)" : "(server default)")}`);
		this.logger.debug(`File: ${file} (${formatBytes(fileStat.size)})`);
		if (flags.format) this.logger.debug(`Format: ${flags.format}`);
		if (automationSourceId) this.logger.debug(`Automation source: ${automationSourceId} (${automationSourceOrigin})`);
		else if (sourceName) this.logger.debug(`Source: ${sourceName} (${sourceOrigin})`);
		if (ciMeta) {
			this.logger.debug(`CI detected: ${ciMeta.ci_provider?.replace(/_/g, " ") ?? "unknown"}`);
			if (ciMeta.branch) this.logger.debug(`Branch: ${ciMeta.branch}`);
			if (ciMeta.commit_sha) this.logger.debug(`Commit: ${ciMeta.commit_sha.slice(0, 7)}`);
			if (ciMeta.ci_build_id) this.logger.debug(`Build: ${ciMeta.ci_build_id}`);
		}
	}
	const fileName = basename(file);
	this.process.stdout.write(`Pushing ${fileName}...\n`);
	const spinner = ora({
		text: "Uploading...",
		stream: this.process.stdout
	}).start();
	try {
		const fileBuffer = readFileSync(file);
		const result = await uploadImport({
			teamId: uploadTeamId,
			file: new File([fileBuffer], fileName),
			fileName,
			format: flags.format,
			runName: flags["run-name"],
			...automationSourceId ? { automationSourceId } : { automationSource: sourceName },
			importMetadata: ciMeta,
			includeResults
		});
		spinner.stop();
		if (result?.status === "failed") {
			const msg = result.error?.message ?? "Import failed on the server.";
			this.logger.error(msg);
			this.process.exitCode = 1;
			return;
		}
		this.process.stdout.write("\nImport completed!\n\n");
		if (result) {
			if (result.team_id) this.process.stdout.write(`  Team:     ${result.team_id}\n`);
			if (result.format) this.process.stdout.write(`  Format:   ${result.format}\n`);
			if (automationSourceId) this.process.stdout.write(`  Source:   ${result.automation_source_name ?? automationSourceId} (${automationSourceOrigin})\n`);
			else if (sourceName) this.process.stdout.write(`  Source:   ${sourceName}${sourceOrigin ? ` (${sourceOrigin})` : ""}\n`);
			if (result.result?.stats) {
				const { tests_created, tests_updated } = result.result.stats;
				this.process.stdout.write(`  Tests:    ${tests_created} created, ${tests_updated} updated\n`);
			}
			if (result.result?.run_id) {
				this.process.stdout.write(`  Run:      ${result.result.run_id}\n`);
				if (result.result.stats) {
					const s = result.result.stats;
					this.process.stdout.write(`  Results:  ${s.passed} passed, ${s.failed} failed, ${s.errored} errored, ${s.skipped} skipped\n`);
				}
			}
			if (result.status === "completed_with_warnings" && result.result?.warnings?.length) {
				this.process.stdout.write("\n");
				const warnings = result.result.warnings;
				for (const w of warnings) this.logger.warning(`${w.message} (${w.count})`);
			}
			if (ciMeta) {
				const prettyProvider = ciMeta.ci_provider?.replace(/_/g, " ") ?? "CI";
				const ciLabel = ciMeta.ci_build_id ? `${prettyProvider} #${ciMeta.ci_build_id}` : prettyProvider;
				this.process.stdout.write(`  CI:       ${ciLabel}\n`);
			}
			if (includeResults) await handleResultArtifacts(this, result, {
				outputResults,
				artifactsDir,
				reportFile: file
			});
			if (flags.verbose && result.result?.stats) {
				const s = result.result.stats;
				this.process.stdout.write("\n  Details:\n");
				this.process.stdout.write(`    Results:     ${s.passed} passed, ${s.failed} failed, ${s.errored} errored, ${s.skipped} skipped\n`);
				if (s.pending || s.todo || s.flaky) this.process.stdout.write(`                 ${s.pending} pending, ${s.todo} todo, ${s.flaky} flaky\n`);
				if (s.suites_created || s.suites_updated) this.process.stdout.write(`    Suites:      ${s.suites_created} created, ${s.suites_updated} updated\n`);
				if (s.tests_created || s.tests_updated) this.process.stdout.write(`    Tests:       ${s.tests_created} created, ${s.tests_updated} updated\n`);
				if (s.results_created || s.results_updated) this.process.stdout.write(`    Run results: ${s.results_created} created, ${s.results_updated} updated\n`);
				if (s.labels_created || s.label_assignments_created) this.process.stdout.write(`    Labels:      ${s.labels_created} created, ${s.label_assignments_created} assignments\n`);
			}
		}
	} catch (err) {
		spinner.stop();
		this.logger.error(err instanceof Error ? err.message : "Upload failed.");
		this.process.exitCode = 1;
	}
}
/**
* ENG-6164: write the results file and upload the report's artifacts.
* fail_fallback(warn) throughout — nothing here changes the push exit code
* (DD5, ENG-591): every problem becomes a warning or a summary count.
*/
async function handleResultArtifacts(ctx, result, options) {
	const results = result.result?.results ?? [];
	if (options.outputResults) try {
		writeFileSync(options.outputResults, `${JSON.stringify(results, null, 2)}\n`);
		ctx.process.stdout.write(`  Results:  ${results.length} written to ${options.outputResults}\n`);
	} catch (err) {
		ctx.logger.warning(`Could not write ${options.outputResults}: ${err instanceof Error ? err.message : String(err)}`);
	}
	if (options.artifactsDir) try {
		const summary = await uploadReportArtifacts({
			results,
			artifactsDir: resolve(options.artifactsDir),
			reportDir: dirname(resolve(options.reportFile)),
			onProblem: (path$1, outcome) => {
				const why = outcome === "rejected" ? "outside the working directory" : outcome.status === "skipped" ? "larger than 50 MiB" : "message" in outcome ? outcome.message : outcome.status;
				ctx.logger.debug(`artifact ${path$1}: ${why}`);
			}
		});
		const line = formatArtifactSummary(summary);
		if (summary.skipped + summary.missing + summary.rejected + summary.failed > 0) ctx.logger.warning(line);
		else ctx.process.stdout.write(`  ${line}\n`);
	} catch (err) {
		ctx.logger.warning(`Artifact upload stopped: ${err instanceof Error ? err.message : String(err)}`);
	}
}

//#endregion
export { pushHandler };