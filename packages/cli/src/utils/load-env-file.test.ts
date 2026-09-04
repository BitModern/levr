import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { loadEnvFile } from './load-env-file';

function withEnvFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'levr-env-'));
  writeFileSync(join(dir, '.env'), contents);
  return dir;
}

describe('loadEnvFile', () => {
  it('applies LEVR_ keys from .env', () => {
    const dir = withEnvFile('LEVR_URL=http://localhost:8280\n');
    const env: NodeJS.ProcessEnv = {};

    const result = loadEnvFile(dir, env);

    expect(env['LEVR_URL']).toBe('http://localhost:8280');
    expect(result.applied).toEqual(['LEVR_URL']);
  });

  it('does NOT override a real environment variable', () => {
    // The whole precedence contract: `LEVR_URL=… levr push` must still beat a
    // checked-in .env, and CI variables must never be shadowed by one.
    const dir = withEnvFile('LEVR_URL=http://from-file\n');
    const env: NodeJS.ProcessEnv = { LEVR_URL: 'http://from-real-env' };

    const result = loadEnvFile(dir, env);

    expect(env['LEVR_URL']).toBe('http://from-real-env');
    expect(result.applied).toEqual([]);
  });

  it('IGNORES every non-LEVR key', () => {
    // The reason this parses instead of calling dotenv.config(): a checkout's
    // .env routinely carries variables that change how Node itself behaves,
    // and none of them are ours to apply just because someone ran the CLI in
    // that directory.
    const dir = withEnvFile(
      [
        'NODE_TLS_REJECT_UNAUTHORIZED=0',
        'HTTP_PROXY=http://evil',
        'NODE_OPTIONS=--inspect',
        'DATABASE_URL=postgres://x',
        'LEVR_TEAM_ID=team-1',
      ].join('\n'),
    );
    const env: NodeJS.ProcessEnv = {};

    const result = loadEnvFile(dir, env);

    expect(result.applied).toEqual(['LEVR_TEAM_ID']);
    expect(env['NODE_TLS_REJECT_UNAUTHORIZED']).toBeUndefined();
    expect(env['HTTP_PROXY']).toBeUndefined();
    expect(env['NODE_OPTIONS']).toBeUndefined();
    expect(env['DATABASE_URL']).toBeUndefined();
  });

  it('does not match keys that merely START with something LEVR-like', () => {
    const dir = withEnvFile('LEVRISH=1\nLEVR=2\nMY_LEVR_URL=3\n');
    const env: NodeJS.ProcessEnv = {};

    loadEnvFile(dir, env);

    expect(env['LEVRISH']).toBeUndefined();
    expect(env['MY_LEVR_URL']).toBeUndefined();
  });

  it('is a no-op when there is no .env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'levr-noenv-'));
    const env: NodeJS.ProcessEnv = {};

    const result = loadEnvFile(dir, env);

    expect(result).toEqual({ path: null, applied: [] });
  });

  it('reads the file LEVR_ENV_FILE names, relative to cwd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'levr-explicit-'));
    writeFileSync(join(dir, 'custom.env'), 'LEVR_URL=http://custom\n');
    const env: NodeJS.ProcessEnv = { LEVR_ENV_FILE: 'custom.env' };

    loadEnvFile(dir, env);

    expect(env['LEVR_URL']).toBe('http://custom');
  });

  it('THROWS when LEVR_ENV_FILE names a file that is not there', () => {
    // Asymmetric on purpose: a missing incidental `.env` is normal and silent,
    // but naming a file and getting silence hides a typo'd path — the one case
    // where quiet failure costs more than it saves.
    const dir = mkdtempSync(join(tmpdir(), 'levr-missing-'));
    const env: NodeJS.ProcessEnv = { LEVR_ENV_FILE: 'nope.env' };

    expect(() => loadEnvFile(dir, env)).toThrow(/does not exist/);
  });

  it('survives an unreadable incidental .env', () => {
    // A directory named `.env` — readFileSync throws EISDIR. The command the
    // user asked for must still run.
    const dir = mkdtempSync(join(tmpdir(), 'levr-eisdir-'));
    mkdirSync(join(dir, '.env'));
    const env: NodeJS.ProcessEnv = {};

    expect(() => loadEnvFile(dir, env)).not.toThrow();
    expect(loadEnvFile(dir, env).applied).toEqual([]);
  });

  it('treats an EMPTY real env var as unset (F-007)', () => {
    // `!== undefined` said "set"; every consumer gates on truthiness and said
    // "unset". A CI template filling LEVR_URL from an unset secret exports ""
    // — the .env fallback was skipped and the run targeted production.
    const dir = withEnvFile('LEVR_URL=http://from-file\n');
    const env: NodeJS.ProcessEnv = { LEVR_URL: '' };

    const result = loadEnvFile(dir, env);

    expect(env['LEVR_URL']).toBe('http://from-file');
    expect(result.applied).toEqual(['LEVR_URL']);
  });
});
