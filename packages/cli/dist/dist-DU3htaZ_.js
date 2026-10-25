import { readFileSync, statSync } from "node:fs";
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
export { detectCiEnvironment };