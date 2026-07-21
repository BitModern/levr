import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectSource, getCiMetadata } from './ci-detect.js';
import { resetDetectionCache } from '@levr/ci-env';

describe('ci-detect', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetDetectionCache();
    // Start with a minimal env so real CI variables (GITHUB_*, RUNNER_*, etc.)
    // don't leak into tests. Only preserve PATH and HOME for basic functionality.
    process.env = {
      PATH: originalEnv['PATH'],
      HOME: originalEnv['HOME'],
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('detectSource', () => {
    it('should return undefined when not in CI', () => {
      delete process.env['CI'];
      delete process.env['GITHUB_ACTIONS'];
      delete process.env['GITLAB_CI'];
      expect(detectSource()).toBeUndefined();
    });

    it('should detect GitHub Actions with repo and workflow', () => {
      process.env['GITHUB_ACTIONS'] = 'true';
      process.env['GITHUB_REPOSITORY'] = 'BitModern/tq-llm-eval';
      process.env['GITHUB_WORKFLOW'] = 'CI Tests';
      expect(detectSource()).toBe('tq-llm-eval/CI Tests');
    });

    it('should detect GitHub Actions with repo only', () => {
      process.env['GITHUB_ACTIONS'] = 'true';
      process.env['GITHUB_REPOSITORY'] = 'BitModern/tq-llm-eval';
      expect(detectSource()).toBe('tq-llm-eval');
    });

    it('should detect GitLab CI with repo and job', () => {
      process.env['GITLAB_CI'] = 'true';
      process.env['CI_PROJECT_PATH'] = 'group/project';
      process.env['CI_JOB_NAME'] = 'unit-tests';
      expect(detectSource()).toBe('project/unit-tests');
    });

    it('should detect Jenkins with job name', () => {
      process.env['JENKINS_URL'] = 'http://jenkins.local';
      process.env['JOB_NAME'] = 'backend-unit-tests';
      expect(detectSource()).toBe('backend-unit-tests');
    });

    it('should detect CircleCI', () => {
      process.env['CIRCLECI'] = 'true';
      process.env['CIRCLE_PROJECT_USERNAME'] = 'BitModern';
      process.env['CIRCLE_PROJECT_REPONAME'] = 'tq-llm-eval';
      process.env['CIRCLE_JOB'] = 'test';
      expect(detectSource()).toBe('tq-llm-eval/test');
    });
  });

  describe('getCiMetadata', () => {
    it('should return undefined when not in CI', () => {
      delete process.env['CI'];
      delete process.env['GITHUB_ACTIONS'];
      expect(getCiMetadata()).toBeUndefined();
    });

    it('should return normalized metadata for GitHub Actions', () => {
      process.env['GITHUB_ACTIONS'] = 'true';
      process.env['GITHUB_REPOSITORY'] = 'BitModern/tq-llm-eval';
      process.env['GITHUB_REF'] = 'refs/heads/main';
      process.env['GITHUB_SHA'] = 'abc123';
      process.env['GITHUB_RUN_ID'] = '12345';
      process.env['GITHUB_SERVER_URL'] = 'https://github.com';

      const meta = getCiMetadata();
      expect(meta).toBeDefined();
      expect(meta!.ci_provider).toBe('github_actions');
      expect(meta!.repository_slug).toBe('BitModern/tq-llm-eval');
      expect(meta!.branch).toBe('main');
      expect(meta!.commit_sha).toBe('abc123');
      expect(meta!.ci_build_id).toBe('12345');
      expect(meta!.ci_build_url).toBe(
        'https://github.com/BitModern/tq-llm-eval/actions/runs/12345',
      );
    });

    it('should return pull_request.head.sha instead of synthetic merge SHA on PR events', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'ci-detect-pr-'));
      const eventPath = join(tmpDir, 'event.json');
      const headSha = '7859fdec1111111111111111111111111111aaaa';
      const syntheticSha = 'f0a187992222222222222222222222222222bbbb';
      writeFileSync(
        eventPath,
        JSON.stringify({ pull_request: { head: { sha: headSha } } }),
      );

      process.env['GITHUB_ACTIONS'] = 'true';
      process.env['GITHUB_EVENT_NAME'] = 'pull_request';
      process.env['GITHUB_EVENT_PATH'] = eventPath;
      process.env['GITHUB_SHA'] = syntheticSha;
      process.env['GITHUB_REF'] = 'refs/pull/99/merge';

      try {
        const meta = getCiMetadata();
        expect(meta!.commit_sha).toBe(headSha);
        expect(meta!.is_pr).toBe(true);
        expect(meta!.pr_number).toBe('99');
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
