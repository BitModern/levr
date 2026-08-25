import { describe, expect, it } from 'vitest';
import { parseLogoutArgs } from './logout-args.js';

describe('parseLogoutArgs', () => {
  it('defaults to the configured backend when nothing is named', () => {
    expect(parseLogoutArgs([])).toEqual({ kind: 'configured' });
  });

  // review F-002. `args.indexOf('--backend')` saw only the space-separated
  // form, so `--backend=<url>` fell through to the CONFIGURED backend —
  // clearing one the operator had not named, and exiting 0.
  it.each([
    ['space-separated', ['--backend', 'http://localhost:9480']],
    ['inline', ['--backend=http://localhost:9480']],
  ])('accepts the %s --backend form', (_label, args) => {
    expect(parseLogoutArgs(args)).toEqual({
      kind: 'backend',
      url: 'http://localhost:9480',
    });
  });

  it.each([
    ['space-separated', ['--env', 'staging']],
    ['inline', ['--env=staging']],
  ])('accepts the %s --env form', (_label, args) => {
    expect(parseLogoutArgs(args)).toEqual({ kind: 'env', env: 'staging' });
  });

  it('normalizes a trailing slash on --backend', () => {
    expect(parseLogoutArgs(['--backend=https://api.levr.now/'])).toEqual({
      kind: 'backend',
      url: 'https://api.levr.now',
    });
  });

  it('recognises --all', () => {
    expect(parseLogoutArgs(['--all'])).toEqual({ kind: 'all' });
  });

  // Fails CLOSED: an unrecognised argument must never fall back to a default
  // target, which is the whole-file-wipe failure mode via argument parsing.
  it.each([
    [['--target', 'http://localhost:9480']],
    [['--backened=http://localhost:9480']],
    [['http://localhost:9480']],
    [['--backend', 'http://x', '--extra']],
  ])('rejects unknown arguments %j', (args) => {
    const r = parseLogoutArgs(args);
    expect(r.kind).toBe('error');
    expect(r.kind === 'error' && r.message).toMatch(/Unknown argument/);
  });

  it('rejects two targets rather than silently picking one', () => {
    const r = parseLogoutArgs(['--backend=http://localhost:9480', '--all']);
    expect(r.kind).toBe('error');
    expect(r.kind === 'error' && r.message).toMatch(/only one of/);
  });

  it.each([
    ['a bare flag', ['--backend']],
    ['an empty inline value', ['--backend=']],
    ['a following flag', ['--backend', '--all']],
  ])('rejects --backend with no url (%s)', (_label, args) => {
    expect(parseLogoutArgs(args).kind).toBe('error');
  });

  it.each(['localhost:8580', 'ftp://x', '/tmp/nope', 'api.levr.now'])(
    'rejects %s as a backend url',
    (value) => {
      const r = parseLogoutArgs([`--backend=${value}`]);
      expect(r.kind).toBe('error');
      expect(r.kind === 'error' && r.message).toMatch(/Not a backend url/);
    },
  );

  it('rejects an unknown environment name', () => {
    const r = parseLogoutArgs(['--env=staging-typo']);
    expect(r.kind).toBe('error');
    expect(r.kind === 'error' && r.message).toMatch(/Unknown environment/);
  });

  it.each(['local', 'staging', 'production'])('accepts --env %s', (env) => {
    expect(parseLogoutArgs([`--env=${env}`])).toEqual({ kind: 'env', env });
  });
});
