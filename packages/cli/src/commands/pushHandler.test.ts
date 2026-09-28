import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectSource, getCiMetadata } from '../utils/ci-detect.js';
import { resetDetectionCache } from '@levr/ci-env';
import type { LocalContext } from '../context.js';
import type { PushCommandFlags } from '../types/push-types.js';

vi.mock('../auth/resolve-token.js', () => ({
  resolveToken: vi.fn().mockResolvedValue({ type: 'pat', token: 't' }),
}));

vi.mock('../utils/sdk-client.js', () => ({
  configureClient: vi.fn(),
  uploadImport: vi.fn(),
}));

vi.mock('ora', () => ({
  default: () => ({ start: () => ({ stop: vi.fn() }) }),
}));

import { pushHandler } from './pushHandler.js';
import { uploadImport } from '../utils/sdk-client.js';

const mockUploadImport = vi.mocked(uploadImport);

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

// internal — routing and the source guard. `-a` alone must work outside CI
// (the guard used to run before the UUID was read), and both flags now
// reach POST /v1/imports: the name as `automation_source`, the UUID as
// `automation_source_id`, never both.
describe('pushHandler routing', () => {
  const originalEnv = process.env;
  let dir: string;
  let file: string;
  const errors: string[] = [];
  const warnings: string[] = [];

  function ctx(): LocalContext {
    return {
      process: {
        stdout: { write: vi.fn(() => true) },
        stderr: { write: vi.fn() },
        exitCode: 0,
      },
      logger: {
        error: (m: string) => errors.push(m),
        warning: (m: string) => warnings.push(m),
        info: vi.fn(),
        success: vi.fn(),
        debug: vi.fn(),
        setVerbose: vi.fn(),
      },
    } as unknown as LocalContext;
  }

  function flags(extra: Partial<PushCommandFlags> = {}): PushCommandFlags {
    return { 'update-mode': 'update', verbose: false, ...extra };
  }

  beforeEach(() => {
    resetDetectionCache();
    // No CI variables: outside CI there is no auto-detected source name.
    process.env = { PATH: originalEnv['PATH'], HOME: originalEnv['HOME'] };
    errors.length = 0;
    warnings.length = 0;
    mockUploadImport.mockReset();
    mockUploadImport.mockResolvedValue({ status: 'completed' });
    dir = mkdtempSync(join(tmpdir(), 'levr-push-'));
    file = join(dir, 'results.xml');
    writeFileSync(file, '<testsuites/>');
  });

  afterEach(() => {
    process.env = originalEnv;
    rmSync(dir, { recursive: true, force: true });
  });

  it('-a alone succeeds outside CI and sends only automation_source_id', async () => {
    const c = ctx();
    await pushHandler.call(c, flags({ 'automation-source': 'src-uuid' }), file);

    expect(c.process.exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(mockUploadImport).toHaveBeenCalledTimes(1);
    const opts = mockUploadImport.mock.calls[0]![0];
    expect(opts.automationSourceId).toBe('src-uuid');
    expect(opts.automationSource).toBeUndefined();
  });

  it('LEVR_AUTOMATION_SOURCE_ID alone behaves like -a', async () => {
    process.env['LEVR_AUTOMATION_SOURCE_ID'] = 'env-uuid';
    const c = ctx();
    await pushHandler.call(c, flags(), file);

    expect(c.process.exitCode).toBe(0);
    expect(mockUploadImport.mock.calls[0]![0].automationSourceId).toBe(
      'env-uuid',
    );
  });

  it('-s alone sends only the source name', async () => {
    const c = ctx();
    await pushHandler.call(c, flags({ source: 'backend-unit' }), file);

    expect(c.process.exitCode).toBe(0);
    const opts = mockUploadImport.mock.calls[0]![0];
    expect(opts.automationSource).toBe('backend-unit');
    expect(opts.automationSourceId).toBeUndefined();
  });

  it('neither -s nor -a outside CI errors before any upload', async () => {
    const c = ctx();
    await pushHandler.call(c, flags(), file);

    expect(c.process.exitCode).toBe(1);
    expect(errors[0]).toMatch(/--source is required/);
    expect(mockUploadImport).not.toHaveBeenCalled();
  });

  it('-a with an explicit -s uses the UUID and warns that the name is ignored', async () => {
    const c = ctx();
    await pushHandler.call(
      c,
      flags({ source: 'backend-unit', 'automation-source': 'src-uuid' }),
      file,
    );

    expect(c.process.exitCode).toBe(0);
    const opts = mockUploadImport.mock.calls[0]![0];
    expect(opts.automationSourceId).toBe('src-uuid');
    expect(opts.automationSource).toBeUndefined();
    expect(warnings[0]).toMatch(/ignoring source name "backend-unit"/);
  });

  it('-a in CI drops the auto-detected name without a warning', async () => {
    process.env['GITHUB_ACTIONS'] = 'true';
    process.env['GITHUB_REPOSITORY'] = 'BitModern/tq-llm-eval';
    process.env['GITHUB_WORKFLOW'] = 'CI Tests';
    const c = ctx();
    await pushHandler.call(c, flags({ 'automation-source': 'src-uuid' }), file);

    const opts = mockUploadImport.mock.calls[0]![0];
    expect(opts.automationSourceId).toBe('src-uuid');
    expect(opts.automationSource).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it('-a does not forward a LEVR_TEAM_ID default, which may name another team', async () => {
    process.env['LEVR_TEAM_ID'] = 'env-team';
    const c = ctx();
    await pushHandler.call(c, flags({ 'automation-source': 'src-uuid' }), file);

    expect(mockUploadImport.mock.calls[0]![0].teamId).toBeUndefined();
  });

  it('-s still forwards a LEVR_TEAM_ID default', async () => {
    process.env['LEVR_TEAM_ID'] = 'env-team';
    const c = ctx();
    await pushHandler.call(c, flags({ source: 'backend-unit' }), file);

    expect(mockUploadImport.mock.calls[0]![0].teamId).toBe('env-team');
  });

  it('-a forwards --team-id so the server can check it against the source', async () => {
    const c = ctx();
    await pushHandler.call(
      c,
      flags({ 'automation-source': 'src-uuid', 'team-id': 'team-uuid' }),
      file,
    );

    expect(mockUploadImport.mock.calls[0]![0].teamId).toBe('team-uuid');
  });
});
