import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TempRepo } from './change-scope.test-helpers.js';
import {
  diffPackages,
  executeDependencyAudit,
  parseCargoLock,
  parsePackageLock,
  parsePnpmLock,
  parseYarnLock,
  TRIVY_ARGS,
  type DependencyAuditFlags,
  type TrivyRunner,
} from './dependencyAuditHandler.js';

/**
 * internal D4.3 — `levr gates dependency-audit`. The lockfile diff runs real
 * git in a temp repository; trivy is stubbed through the injected runner, so
 * the tests need no scanner or database and assert exactly what it was
 * asked to run.
 */

let repo: TempRepo;
beforeEach(() => {
  repo = new TempRepo('gates-dependency-audit-');
});
afterEach(() => {
  repo.dispose();
});

type Vuln = {
  PkgName: string;
  InstalledVersion: string;
  VulnerabilityID: string;
  Severity: string;
};
type License = { PkgName: string; Name: string };

function trivyStub(
  vulns: Vuln[] = [],
  licenses: License[] = [],
): TrivyRunner & { calls: Array<readonly string[]> } {
  const calls: Array<readonly string[]> = [];
  const runner: TrivyRunner = (args) => {
    calls.push(args);
    return {
      code: 0,
      stdout: JSON.stringify({
        Results: [
          { Target: 'lockfiles', Vulnerabilities: vulns, Licenses: licenses },
        ],
      }),
      stderr: '',
      missing: false,
    };
  };
  return Object.assign(runner, { calls });
}

const run = (trivy: TrivyRunner, over: Partial<DependencyAuditFlags> = {}) =>
  executeDependencyAudit({ base: '', severity: 'HIGH', ...over }, repo.root, {
    scopeOptions: { ciTargetBranch: '' },
    trivy,
  });

const yarnBerry = (entries: Array<[string, string]>) =>
  [
    '__metadata:',
    '  version: 8',
    '',
    ...entries.flatMap(([name, version]) => [
      `"${name}@npm:^${version}":`,
      `  version: ${version}`,
      `  resolution: "${name}@npm:${version}"`,
      '',
    ]),
  ].join('\n');

const cargo = (entries: Array<[string, string]>) =>
  [
    'version = 3',
    '',
    ...entries.map(
      ([n, v]) => `[[package]]\nname = "${n}"\nversion = "${v}"\n`,
    ),
  ].join('\n');

const vuln = (
  PkgName: string,
  InstalledVersion: string,
  Severity = 'HIGH',
  VulnerabilityID = 'CVE-2026-0001',
): Vuln => ({
  PkgName,
  InstalledVersion,
  Severity,
  VulnerabilityID,
});

describe('gates dependency-audit — lockfile diff (yarn)', () => {
  beforeEach(() => {
    repo.write(
      'yarn.lock',
      yarnBerry([
        ['old-vuln', '1.0.0'],
        ['lodash', '4.17.20'],
      ]),
    );
    repo.commitBase();
  });

  it('fails on a finding in an ADDED package', () => {
    repo.write(
      'yarn.lock',
      yarnBerry([
        ['old-vuln', '1.0.0'],
        ['lodash', '4.17.20'],
        ['new-pkg', '2.0.0'],
      ]),
    );
    const out = run(
      trivyStub([vuln('new-pkg', '2.0.0', 'CRITICAL', 'CVE-2026-1234')]),
    );
    expect(out.exitCode).toBe(1);
    expect(out.stdout).toContain('new-pkg@2.0.0 CVE-2026-1234 (CRITICAL)');
  });

  it('fails on a finding in an UPGRADED package', () => {
    repo.write(
      'yarn.lock',
      yarnBerry([
        ['old-vuln', '1.0.0'],
        ['lodash', '4.17.21'],
      ]),
    );
    const out = run(trivyStub([vuln('lodash', '4.17.21')]));
    expect(out.exitCode).toBe(1);
    expect(out.stdout).toContain('lodash@4.17.21');
  });

  it('an untouched vulnerable dependency stays green', () => {
    repo.write(
      'yarn.lock',
      yarnBerry([
        ['old-vuln', '1.0.0'],
        ['lodash', '4.17.20'],
        ['clean', '1.0.0'],
      ]),
    );
    const out = run(trivyStub([vuln('old-vuln', '1.0.0', 'CRITICAL')]));
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain(
      'PASS no HIGH+ findings in 1 added or upgraded package version(s)',
    );
  });

  it('keeps only findings at or above --severity', () => {
    repo.write(
      'yarn.lock',
      yarnBerry([
        ['old-vuln', '1.0.0'],
        ['lodash', '4.17.20'],
        ['new-pkg', '2.0.0'],
      ]),
    );
    const medium = trivyStub([vuln('new-pkg', '2.0.0', 'MEDIUM')]);
    expect(run(medium).exitCode).toBe(0);
    expect(run(medium, { severity: 'medium' }).exitCode).toBe(1);
    expect(
      run(trivyStub([vuln('new-pkg', '2.0.0', 'CRITICAL')]), {
        severity: 'CRITICAL',
      }).exitCode,
    ).toBe(1);
  });

  it('fails on a license outside --allow-licenses, for changed packages only', () => {
    repo.write(
      'yarn.lock',
      yarnBerry([
        ['old-vuln', '1.0.0'],
        ['lodash', '4.17.20'],
        ['gpl-pkg', '1.0.0'],
      ]),
    );
    const stub = trivyStub(
      [],
      [
        { PkgName: 'gpl-pkg', Name: 'GPL-3.0' },
        { PkgName: 'old-vuln', Name: 'AGPL-3.0' },
      ],
    );
    const out = run(stub, { 'allow-licenses': 'MIT, Apache-2.0' });
    expect(out.exitCode).toBe(1);
    expect(out.stdout).toContain(
      'gpl-pkg license GPL-3.0 is not in --allow-licenses',
    );
    expect(out.stdout).not.toContain('old-vuln');
    // Without the flag the license check is off.
    expect(run(stub).exitCode).toBe(0);
    // An allowed license passes (case-insensitive).
    expect(run(stub, { 'allow-licenses': 'mit,gpl-3.0' }).exitCode).toBe(0);
  });

  it('passes without running trivy when no lockfile changed', () => {
    repo.write('src/a.ts', 'x\n');
    const stub = trivyStub([vuln('old-vuln', '1.0.0', 'CRITICAL')]);
    const out = run(stub);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain('no added or upgraded packages');
    expect(stub.calls).toHaveLength(0);
  });

  it('runs trivy offline, against its existing database, writing no file', () => {
    repo.write(
      'yarn.lock',
      yarnBerry([
        ['old-vuln', '1.0.0'],
        ['lodash', '4.17.20'],
        ['x', '1.0.0'],
      ]),
    );
    const stub = trivyStub();
    run(stub);
    expect(stub.calls).toEqual([TRIVY_ARGS]);
    expect(TRIVY_ARGS).toEqual(
      expect.arrayContaining(['--skip-db-update', '--offline-scan']),
    );
    expect(TRIVY_ARGS.join(' ')).not.toMatch(/--output|--download/);
  });
});

describe('gates dependency-audit — lockfile diff (Cargo, untracked)', () => {
  it('diffs Cargo.lock at the merge base', () => {
    repo.write(
      'Cargo.lock',
      cargo([
        ['serde', '1.0.0'],
        ['old', '0.1.0'],
      ]),
    );
    repo.commitBase();
    repo.write(
      'Cargo.lock',
      cargo([
        ['serde', '1.0.1'],
        ['old', '0.1.0'],
        ['ring', '0.17.0'],
      ]),
    );
    const out = run(trivyStub([vuln('ring', '0.17.0'), vuln('old', '0.1.0')]));
    expect(out.exitCode).toBe(1);
    expect(out.stdout).toContain('ring@0.17.0');
    expect(out.stdout).not.toContain('old@0.1.0');
    expect(out.stdout).toContain('2 added or upgraded package version(s)');
  });

  it('treats an untracked lockfile as every package added (review R2 C2)', () => {
    repo.write('README.md', 'x\n');
    repo.commitBase();
    repo.write(
      'crates/new/Cargo.lock',
      cargo([
        ['a', '1.0.0'],
        ['b', '2.0.0'],
      ]),
    );
    const out = run(trivyStub([vuln('b', '2.0.0')]));
    expect(out.exitCode).toBe(1);
    expect(out.stdout).toContain('b@2.0.0');
  });
});

describe('gates dependency-audit — failures exit 2, never a pass', () => {
  beforeEach(() => {
    repo.write('yarn.lock', yarnBerry([['a', '1.0.0']]));
    repo.commitBase();
    repo.write(
      'yarn.lock',
      yarnBerry([
        ['a', '1.0.0'],
        ['b', '1.0.0'],
      ]),
    );
  });

  it('missing trivy exits 2', () => {
    const missing: TrivyRunner = () => ({
      code: 127,
      stdout: '',
      stderr: '',
      missing: true,
    });
    const out = run(missing);
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain('trivy is not installed');
  });

  it('a trivy failure (e.g. no database yet) exits 2', () => {
    const noDb: TrivyRunner = () => ({
      code: 1,
      stdout: '',
      stderr: 'FATAL --skip-db-update cannot be specified on the first run',
      missing: false,
    });
    const out = run(noDb);
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain('empty or missing vulnerability database');
    expect(out.stderr).toContain('cannot be specified on the first run');
  });

  it('non-JSON trivy output exits 2', () => {
    const garbage: TrivyRunner = () => ({
      code: 0,
      stdout: 'not json',
      stderr: '',
      missing: false,
    });
    expect(run(garbage).exitCode).toBe(2);
  });

  it('exits 2 when anything throws, validation included', () => {
    const out = run(trivyStub(), {
      severity: undefined as unknown as string,
    });
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain('crashed');
  });

  it('an unknown --severity exits 2', () => {
    const out = run(trivyStub(), { severity: 'SEVERE' });
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain('--severity');
  });

  it('no merge base exits 2', () => {
    const bare = new TempRepo('gates-dependency-audit-nobase-');
    try {
      bare.write('yarn.lock', yarnBerry([['a', '1.0.0']]));
      bare.commit('no origin/HEAD');
      const out = executeDependencyAudit(
        { base: '', severity: 'HIGH' },
        bare.root,
        { scopeOptions: { ciTargetBranch: '' }, trivy: trivyStub() },
      );
      expect(out.exitCode).toBe(2);
      expect(out.stderr).toContain('no merge base');
    } finally {
      bare.dispose();
    }
  });
});

describe('lockfile parsers', () => {
  it('yarn classic and berry, scoped names, multi-descriptor headers', () => {
    const classic = [
      '# yarn lockfile v1',
      '',
      '"@scope/pkg@^1.0.0", "@scope/pkg@^1.1.0":',
      '  version "1.2.3"',
      '',
      'left-pad@^1.0.0:',
      '  version "1.3.0"',
    ].join('\n');
    expect(parseYarnLock(classic)).toEqual(
      new Map([
        ['@scope/pkg', new Set(['1.2.3'])],
        ['left-pad', new Set(['1.3.0'])],
      ]),
    );
    expect(parseYarnLock(yarnBerry([['@a/b', '2.0.0']]))).toEqual(
      new Map([['@a/b', new Set(['2.0.0'])]]),
    );
  });

  it('package-lock v3 packages and v1 dependencies', () => {
    const v3 = JSON.stringify({
      packages: {
        '': { name: 'root', version: '0.0.0' },
        'node_modules/a': { version: '1.0.0' },
        'node_modules/a/node_modules/@s/b': { version: '2.0.0' },
        'node_modules/linked': { link: true },
      },
    });
    expect(parsePackageLock(v3)).toEqual(
      new Map([
        ['a', new Set(['1.0.0'])],
        ['@s/b', new Set(['2.0.0'])],
      ]),
    );
    const v1 = JSON.stringify({
      dependencies: {
        a: { version: '1.0.0', dependencies: { b: { version: '3.0.0' } } },
      },
    });
    expect(parsePackageLock(v1)).toEqual(
      new Map([
        ['a', new Set(['1.0.0'])],
        ['b', new Set(['3.0.0'])],
      ]),
    );
  });

  it('pnpm v6+ and v5 package keys', () => {
    const pnpm = [
      'lockfileVersion: 6.0',
      'packages:',
      '  /a@1.0.0:',
      '    resolution: {integrity: x}',
      "  '@s/b@2.0.0(react@18.0.0)':",
      '    resolution: {integrity: y}',
      '  /c/3.0.0:',
      '    resolution: {integrity: z}',
    ].join('\n');
    expect(parsePnpmLock(pnpm)).toEqual(
      new Map([
        ['a', new Set(['1.0.0'])],
        ['@s/b', new Set(['2.0.0'])],
        ['c', new Set(['3.0.0'])],
      ]),
    );
  });

  it('Cargo.lock and diffPackages', () => {
    const before = parseCargoLock(cargo([['x', '1.0.0']]));
    const after = parseCargoLock(
      cargo([
        ['x', '1.0.0'],
        ['x', '2.0.0'],
        ['y', '0.1.0'],
      ]),
    );
    expect(diffPackages(before, after)).toEqual(
      new Map([
        ['x', new Set(['2.0.0'])],
        ['y', new Set(['0.1.0'])],
      ]),
    );
  });
});
