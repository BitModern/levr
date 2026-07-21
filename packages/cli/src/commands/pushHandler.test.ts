import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectSource, getCiMetadata } from '../utils/ci-detect.js';
import { resetDetectionCache } from '@levr/ci-env';

describe('pushHandler source resolution', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetDetectionCache();
    // Start with a minimal env so real CI variables (GITHUB_*, RUNNER_*, etc.)
    // don't leak into tests via detectCiEnvironment(). Matches the pattern in
    // sibling ci-detect.test.ts.
    process.env = {
      PATH: originalEnv['PATH'],
      HOME: originalEnv['HOME'],
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should resolve source from CI environment', () => {
    process.env['GITHUB_ACTIONS'] = 'true';
    process.env['GITHUB_REPOSITORY'] = 'BitModern/tq-llm-eval';
    process.env['GITHUB_WORKFLOW'] = 'CI Tests';

    const source = detectSource();
    expect(source).toBe('tq-llm-eval/CI Tests');
  });

  it('should return CI metadata with normalized field names', () => {
    process.env['GITHUB_ACTIONS'] = 'true';
    process.env['GITHUB_REPOSITORY'] = 'BitModern/tq-llm-eval';
    process.env['GITHUB_SHA'] = 'abc123';
    process.env['GITHUB_RUN_ID'] = '99';
    process.env['GITHUB_SERVER_URL'] = 'https://github.com';
    process.env['GITHUB_REF'] = 'refs/heads/main';

    const meta = getCiMetadata();
    expect(meta?.ci_provider).toBe('github_actions');
    expect(meta?.commit_sha).toBe('abc123');
    expect(meta?.ci_build_id).toBe('99');
  });

  it('should return undefined source when not in CI', () => {
    delete process.env['CI'];
    delete process.env['GITHUB_ACTIONS'];
    delete process.env['GITLAB_CI'];
    delete process.env['CIRCLECI'];
    delete process.env['JENKINS_URL'];
    delete process.env['TF_BUILD'];

    expect(detectSource()).toBeUndefined();
    expect(getCiMetadata()).toBeUndefined();
  });
});
