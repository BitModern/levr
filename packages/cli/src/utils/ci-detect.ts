import { detectCiEnvironment, type CiEnvironment } from '@levr/ci-env';

/**
 * Auto-detect source name from CI environment.
 * Returns undefined if not running in CI.
 */
export function detectSource(): string | undefined {
  const ci = detectCiEnvironment();
  if (!ci) return undefined;

  // Prefer workflow name (GITHUB_WORKFLOW) over job name (GITHUB_JOB)
  // for source derivation, since it's more user-recognizable.
  const jobName = process.env['GITHUB_WORKFLOW'] ?? ci.ci_job_name;
  const repo = ci.repository_slug?.split('/').pop();

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
export function getCiMetadata(): CiEnvironment | undefined {
  return detectCiEnvironment() ?? undefined;
}
