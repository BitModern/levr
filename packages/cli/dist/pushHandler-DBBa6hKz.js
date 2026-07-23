import { getApiUrl, getAutomationSourceIdOverride, getSourceOverride, getTeamId } from "./env-NxtzJJPk.js";
import { client, configureClient, uploadAutomationIngest, uploadImport } from "./sdk-client-BeE6mXns.js";
import "./workspace-store-4hfvsEHS.js";
import { resolveWorkspace } from "./resolve-workspace-Dj7jgtE3.js";
import "./token-refresh-Cz-FqDtC.js";
import { resolveToken } from "./resolve-token-BRPrqdG-.js";
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import ora from "ora";
import { execSync } from "node:child_process";

//#region ../ci-env/dist/providers/github.js
const MAX_EVENT_PAYLOAD_BYTES = 5 * 1024 * 1024;
const PR_EVENT_NAMES = new Set(["pull_request", "pull_request_target"]);
function readPullRequestEvent(eventPath) {
	if (!eventPath) return void 0;
	try {
		if (statSync(eventPath).size > MAX_EVENT_PAYLOAD_BYTES) return void 0;
		const raw = readFileSync(eventPath, "utf8");
		return JSON.parse(raw);
	} catch {
		return;
	}
}
const github = {
	name: "github_actions",
	detect(env) {
		return env.GITHUB_ACTIONS === "true";
	},
	extract(env) {
		const isPr = !!env.GITHUB_EVENT_NAME && PR_EVENT_NAMES.has(env.GITHUB_EVENT_NAME);
		const ref = env.GITHUB_REF ?? "";
		const prPayload = isPr ? readPullRequestEvent(env.GITHUB_EVENT_PATH) : void 0;
		const refMatch = isPr ? /^refs\/pull\/(\d+)\/merge$/.exec(ref) : null;
		const prNumber = prPayload?.pull_request?.number?.toString() ?? refMatch?.[1];
		const serverUrl = env.GITHUB_SERVER_URL ?? "https://github.com";
		const repo = env.GITHUB_REPOSITORY ?? "";
		const commitSha = env.GITHUB_PULL_REQUEST_HEAD_SHA ?? prPayload?.pull_request?.head?.sha ?? env.GITHUB_SHA;
		return {
			ci_provider: "github_actions",
			ci_build_id: env.GITHUB_RUN_ID,
			ci_build_number: env.GITHUB_RUN_NUMBER,
			ci_build_url: repo ? `${serverUrl}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : void 0,
			ci_job_name: env.GITHUB_JOB,
			ci_job_url: repo ? `${serverUrl}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : void 0,
			commit_sha: commitSha,
			commit_author: env.GITHUB_ACTOR,
			branch: isPr ? env.GITHUB_HEAD_REF : ref.startsWith("refs/heads/") ? ref.replace(/^refs\/heads\//, "") : void 0,
			tag: ref.startsWith("refs/tags/") ? ref.replace(/^refs\/tags\//, "") : void 0,
			is_pr: isPr,
			pr_number: prNumber,
			pr_branch: isPr ? env.GITHUB_HEAD_REF : void 0,
			pr_target_branch: isPr ? env.GITHUB_BASE_REF : void 0,
			repository_url: repo ? `${serverUrl}/${repo}` : void 0,
			repository_slug: repo || void 0,
			runner_os: env.RUNNER_OS?.toLowerCase(),
			runner_arch: env.RUNNER_ARCH?.toLowerCase(),
			runner_name: env.RUNNER_NAME
		};
	}
};

//#endregion
//#region ../ci-env/dist/providers/gitlab.js
const gitlab = {
	name: "gitlab_ci",
	detect(env) {
		return env.GITLAB_CI === "true";
	},
	extract(env) {
		const isPr = !!env.CI_MERGE_REQUEST_IID;
		return {
			ci_provider: "gitlab_ci",
			ci_build_id: env.CI_PIPELINE_ID,
			ci_build_number: env.CI_PIPELINE_IID,
			ci_build_url: env.CI_PIPELINE_URL,
			ci_job_name: env.CI_JOB_NAME,
			ci_job_url: env.CI_JOB_URL,
			commit_sha: env.CI_COMMIT_SHA,
			commit_message: env.CI_COMMIT_MESSAGE,
			commit_author: env.CI_COMMIT_AUTHOR,
			branch: env.CI_COMMIT_BRANCH ?? env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME,
			tag: env.CI_COMMIT_TAG,
			is_pr: isPr,
			pr_number: env.CI_MERGE_REQUEST_IID,
			pr_branch: env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME,
			pr_target_branch: env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME,
			repository_url: env.CI_PROJECT_URL,
			repository_slug: env.CI_PROJECT_PATH,
			runner_name: env.CI_RUNNER_DESCRIPTION
		};
	}
};

//#endregion
//#region ../ci-env/dist/providers/jenkins.js
const jenkins = {
	name: "jenkins",
	detect(env) {
		return !!env.JENKINS_URL;
	},
	extract(env) {
		const isPr = !!env.CHANGE_ID;
		return {
			ci_provider: "jenkins",
			ci_build_id: env.BUILD_ID,
			ci_build_number: env.BUILD_NUMBER,
			ci_build_url: env.BUILD_URL,
			ci_job_name: env.JOB_NAME,
			ci_job_url: env.JOB_URL,
			commit_sha: env.GIT_COMMIT,
			branch: env.GIT_BRANCH ?? env.BRANCH_NAME,
			is_pr: isPr,
			pr_number: env.CHANGE_ID,
			pr_branch: env.CHANGE_BRANCH,
			pr_target_branch: env.CHANGE_TARGET,
			repository_url: env.GIT_URL
		};
	}
};

//#endregion
//#region ../ci-env/dist/providers/circleci.js
const circleci = {
	name: "circleci",
	detect(env) {
		return env.CIRCLECI === "true";
	},
	extract(env) {
		const isPr = !!env.CIRCLE_PULL_REQUEST;
		const prNumber = (env.CIRCLE_PULL_REQUEST ?? "").split("/").pop();
		return {
			ci_provider: "circleci",
			ci_build_id: env.CIRCLE_WORKFLOW_ID,
			ci_build_number: env.CIRCLE_BUILD_NUM,
			ci_build_url: env.CIRCLE_BUILD_URL,
			ci_job_name: env.CIRCLE_JOB,
			commit_sha: env.CIRCLE_SHA1,
			branch: env.CIRCLE_BRANCH,
			tag: env.CIRCLE_TAG,
			is_pr: isPr,
			pr_number: isPr ? prNumber : void 0,
			repository_url: env.CIRCLE_REPOSITORY_URL,
			repository_slug: env.CIRCLE_PROJECT_USERNAME && env.CIRCLE_PROJECT_REPONAME ? `${env.CIRCLE_PROJECT_USERNAME}/${env.CIRCLE_PROJECT_REPONAME}` : void 0
		};
	}
};

//#endregion
//#region ../ci-env/dist/providers/azure.js
const azure = {
	name: "azure_devops",
	detect(env) {
		return env.TF_BUILD === "True";
	},
	extract(env) {
		const isPr = env.BUILD_REASON === "PullRequest" || !!env.SYSTEM_PULLREQUEST_PULLREQUESTID;
		const orgUrl = env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI ?? "";
		const project = env.SYSTEM_TEAMPROJECT ?? "";
		const buildId = env.BUILD_BUILDID ?? "";
		return {
			ci_provider: "azure_devops",
			ci_build_id: buildId,
			ci_build_number: env.BUILD_BUILDNUMBER,
			ci_build_url: orgUrl && project && buildId ? `${orgUrl}${project}/_build/results?buildId=${buildId}` : void 0,
			ci_job_name: env.AGENT_JOBNAME,
			commit_sha: env.BUILD_SOURCEVERSION,
			commit_message: env.BUILD_SOURCEVERSIONMESSAGE,
			branch: env.BUILD_SOURCEBRANCH?.replace(/^refs\/heads\//, ""),
			is_pr: isPr,
			pr_number: env.SYSTEM_PULLREQUEST_PULLREQUESTID,
			pr_branch: env.SYSTEM_PULLREQUEST_SOURCEBRANCH?.replace(/^refs\/heads\//, ""),
			pr_target_branch: env.SYSTEM_PULLREQUEST_TARGETBRANCH?.replace(/^refs\/heads\//, ""),
			repository_url: env.BUILD_REPOSITORY_URI,
			repository_slug: env.BUILD_REPOSITORY_NAME,
			runner_os: env.AGENT_OS?.toLowerCase(),
			runner_name: env.AGENT_NAME
		};
	}
};

//#endregion
//#region ../ci-env/dist/providers/buildkite.js
const buildkite = {
	name: "buildkite",
	detect(env) {
		return env.BUILDKITE === "true";
	},
	extract(env) {
		const isPr = env.BUILDKITE_PULL_REQUEST !== "false" && !!env.BUILDKITE_PULL_REQUEST;
		return {
			ci_provider: "buildkite",
			ci_build_id: env.BUILDKITE_BUILD_ID,
			ci_build_number: env.BUILDKITE_BUILD_NUMBER,
			ci_build_url: env.BUILDKITE_BUILD_URL,
			ci_job_name: env.BUILDKITE_LABEL ?? env.BUILDKITE_STEP_KEY,
			commit_sha: env.BUILDKITE_COMMIT,
			commit_message: env.BUILDKITE_MESSAGE,
			commit_author: env.BUILDKITE_BUILD_AUTHOR,
			branch: env.BUILDKITE_BRANCH,
			tag: env.BUILDKITE_TAG,
			is_pr: isPr,
			pr_number: isPr ? env.BUILDKITE_PULL_REQUEST : void 0,
			pr_branch: isPr ? env.BUILDKITE_BRANCH : void 0,
			pr_target_branch: isPr ? env.BUILDKITE_PULL_REQUEST_BASE_BRANCH : void 0,
			repository_url: env.BUILDKITE_REPO,
			repository_slug: env.BUILDKITE_PIPELINE_SLUG ? `${env.BUILDKITE_ORGANIZATION_SLUG}/${env.BUILDKITE_PIPELINE_SLUG}` : void 0,
			runner_name: env.BUILDKITE_AGENT_NAME
		};
	}
};

//#endregion
//#region ../ci-env/dist/providers/bitbucket.js
const bitbucket = {
	name: "bitbucket",
	detect(env) {
		return !!env.BITBUCKET_BUILD_NUMBER;
	},
	extract(env) {
		const isPr = !!env.BITBUCKET_PR_ID;
		const workspace = env.BITBUCKET_WORKSPACE ?? "";
		const repo = env.BITBUCKET_REPO_SLUG ?? "";
		return {
			ci_provider: "bitbucket",
			ci_build_id: env.BITBUCKET_PIPELINE_UUID,
			ci_build_number: env.BITBUCKET_BUILD_NUMBER,
			ci_build_url: workspace && repo && env.BITBUCKET_BUILD_NUMBER ? `https://bitbucket.org/${workspace}/${repo}/pipelines/results/${env.BITBUCKET_BUILD_NUMBER}` : void 0,
			ci_job_name: env.BITBUCKET_STEP_UUID,
			commit_sha: env.BITBUCKET_COMMIT,
			branch: env.BITBUCKET_BRANCH,
			tag: env.BITBUCKET_TAG,
			is_pr: isPr,
			pr_number: env.BITBUCKET_PR_ID,
			pr_branch: isPr ? env.BITBUCKET_BRANCH : void 0,
			pr_target_branch: env.BITBUCKET_PR_DESTINATION_BRANCH,
			repository_url: workspace && repo ? `https://bitbucket.org/${workspace}/${repo}` : void 0,
			repository_slug: workspace && repo ? `${workspace}/${repo}` : void 0
		};
	}
};

//#endregion
//#region ../ci-env/dist/providers/generic.js
/**
* Generic CI fallback — detects basic CI environment using common env vars.
* Used when no specific provider is matched.
*/
const generic = {
	name: "generic_ci",
	detect(env) {
		return env.CI === "true" || env.CI === "1" || env.CONTINUOUS_INTEGRATION === "true";
	},
	extract(env) {
		return {
			ci_provider: "generic_ci",
			ci_build_id: env.BUILD_ID ?? env.BUILD_NUMBER,
			ci_build_number: env.BUILD_NUMBER,
			ci_build_url: env.BUILD_URL,
			commit_sha: env.GIT_COMMIT ?? env.COMMIT_SHA,
			commit_author: env.GIT_AUTHOR_NAME,
			branch: env.GIT_BRANCH ?? env.BRANCH_NAME ?? env.BRANCH,
			tag: env.GIT_TAG ?? env.TAG_NAME,
			repository_url: env.GIT_URL ?? env.REPOSITORY_URL
		};
	}
};

//#endregion
//#region ../ci-env/dist/workspace-path.js
/**
* Detect the workspace path relative to the git repository root.
* Useful for monorepos to distinguish which sub-project ran tests.
*
* Returns undefined if not in a git repository or git is unavailable.
*/
function detectWorkspacePath() {
	try {
		return execSync("git rev-parse --show-prefix", {
			encoding: "utf-8",
			timeout: 5e3,
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			]
		}).trim().replace(/\/$/, "") || void 0;
	} catch {
		return;
	}
}

//#endregion
//#region ../ci-env/dist/detect.js
/**
* Ordered list of CI providers to check.
* More specific providers first, generic fallback last.
*/
const PROVIDERS = [
	github,
	gitlab,
	jenkins,
	circleci,
	azure,
	buildkite,
	bitbucket,
	generic
];
let cachedResult;
/**
* Detect the CI environment from environment variables.
*
* @param env - Environment variables to inspect. Defaults to `process.env`.
* @returns Normalized CI environment metadata, or `null` if not running in CI.
*/
function detectCiEnvironment(env) {
	if (env === void 0 && cachedResult !== void 0) return cachedResult;
	const source = env ?? process.env;
	for (const provider of PROVIDERS) if (provider.detect(source)) {
		const result = provider.extract(source);
		if (!result.workspace_path) result.workspace_path = detectWorkspacePath();
		if (!result.runner_os) result.runner_os = process.platform;
		if (!result.runner_arch) result.runner_arch = process.arch;
		const cleaned = Object.fromEntries(Object.entries(result).filter(([, v]) => v !== void 0));
		if (env === void 0) cachedResult = cleaned;
		return cleaned;
	}
	if (env === void 0) cachedResult = null;
	return null;
}

//#endregion
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
	if (auth.type === "jwt") try {
		const ws = await resolveWorkspace(flags["workspace-id"]);
		client.setConfig({
			...client.getConfig(),
			workspaceId: ws.workspaceId
		});
		if (flags.verbose) this.logger.debug(`Workspace: ${ws.workspaceId} (${ws.source})`);
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
	if (!sourceName) {
		this.logger.error("Error: --source is required. Provide it explicitly with --source, set the LEVR_SOURCE env var, or run in a supported CI environment for auto-detection.");
		this.logger.error("");
		this.logger.error("Example:");
		this.logger.error("  levr push results.xml --source backend-unit-tests");
		this.process.exitCode = 1;
		return;
	}
	const automationSourceId = flags["automation-source"] ?? getAutomationSourceIdOverride();
	const automationSourceOrigin = flags["automation-source"] ? "explicit" : automationSourceId ? "LEVR_AUTOMATION_SOURCE_ID" : void 0;
	const ciMeta = getCiMetadata();
	if (flags.verbose) {
		this.logger.debug(`Team: ${teamId ?? "(server default)"}`);
		this.logger.debug(`File: ${file} (${formatBytes(fileStat.size)})`);
		if (flags.format) this.logger.debug(`Format: ${flags.format}`);
		if (flags["update-mode"]) this.logger.debug(`Update mode: ${flags["update-mode"]}`);
		if (sourceName) this.logger.debug(`Source: ${sourceName} (${sourceOrigin})`);
		if (automationSourceId) this.logger.debug(`Automation source: ${automationSourceId} (${automationSourceOrigin}) → POST /v1/automation-run/ingest`);
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
		const fileObj = new File([fileBuffer], fileName);
		if (automationSourceId) {
			const ingestResult = await uploadAutomationIngest({
				file: fileObj,
				fileName,
				automationSourceId,
				runName: flags["run-name"],
				format: flags.format,
				externalRunKey: ciMeta?.ci_build_id,
				importMetadata: ciMeta
			});
			spinner.stop();
			this.process.stdout.write("\nAutomation run ingested!\n\n");
			this.process.stdout.write(`  Run ID:   ${ingestResult.automation_run_id}\n`);
			this.process.stdout.write(`  Source:   ${automationSourceId}\n`);
			this.process.stdout.write(`  Results:  ${ingestResult.passed} passed, ${ingestResult.failed} failed, ${ingestResult.errored} errored, ${ingestResult.skipped} skipped\n`);
			this.process.stdout.write(`  Total:    ${ingestResult.total_tests}\n`);
			if (ciMeta) {
				const prettyProvider = ciMeta.ci_provider?.replace(/_/g, " ") ?? "CI";
				const ciLabel = ciMeta.ci_build_id ? `${prettyProvider} #${ciMeta.ci_build_id}` : prettyProvider;
				this.process.stdout.write(`  CI:       ${ciLabel}\n`);
			}
			return;
		}
		const result = await uploadImport({
			teamId,
			file: fileObj,
			fileName,
			format: flags.format,
			parentFolderId: flags["parent-folder-id"],
			runName: flags["run-name"],
			updateMode: flags["update-mode"],
			automationSource: sourceName,
			importMetadata: ciMeta
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
			if (sourceName) this.process.stdout.write(`  Source:   ${sourceName}${sourceOrigin ? ` (${sourceOrigin})` : ""}\n`);
			if (result.result?.stats) {
				const { tests_created, tests_updated } = result.result.stats;
				this.process.stdout.write(`  Tests:    ${tests_created} created, ${tests_updated} updated\n`);
			}
			if (result.result?.run_id) this.process.stdout.write(`  Run:      ${result.result.run_id}\n`);
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

//#endregion
export { pushHandler };