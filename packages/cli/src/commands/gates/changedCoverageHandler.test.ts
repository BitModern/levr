import { utimesSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { lines, TempRepo } from './change-scope.test-helpers.js';
import {
  COVERAGE_DEFAULT_EXCLUDES,
  executeChangedCoverage,
  measureCoverage,
  normaliseLcovPaths,
  parseLcov,
  type ChangedCoverageFlags,
} from './changedCoverageHandler.js';

/**
 * internal D4.2 — `levr gates changed-coverage`. Every case runs against a
 * real temp git repository and a real lcov file, so the verdict comes from
 * the whole command, not from a stubbed diff.
 */

let repo: TempRepo;
beforeEach(() => {
  repo = new TempRepo('gates-changed-coverage-');
});
afterEach(() => {
  repo.dispose();
});

const run = (over: Partial<ChangedCoverageFlags> = {}) =>
  executeChangedCoverage(
    { lcov: 'lcov.info', min: '80', base: '', 'lcov-root': '.', ...over },
    repo.root,
    { ciTargetBranch: '' },
  );

/** An lcov record: every listed line executable, `covered` lines hit once. */
function record(sf: string, executable: number[], covered: number[]): string {
  const hit = new Set(covered);
  return [
    `SF:${sf}`,
    ...executable.map((n) => `DA:${n},${hit.has(n) ? 1 : 0}`),
    'end_of_record',
  ].join('\n');
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('gates changed-coverage — usage and evidence (exit 2)', () => {
  it('exits 2 with "no merge base" when there is no base to diff against', () => {
    repo.write('src/a.ts', 'a\n');
    repo.commit('no origin/HEAD');
    repo.write('lcov.info', record('src/a.ts', [1], [1]));
    const out = run();
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain('no merge base');
  });

  it('exits 2 with "no lcov file" when the lcov file is missing', () => {
    repo.write('src/a.ts', 'a\n');
    repo.commitBase();
    const out = run({ lcov: 'coverage/missing.info' });
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain('no lcov file at coverage/missing.info');
  });

  it('exits 2 when anything throws, validation included (never an uncaught error)', () => {
    // A malformed flags object makes validation itself throw; the command
    // must still answer exit 2 rather than let stricli exit 1 ("below min").
    const out = run({ min: undefined as unknown as string });
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain('crashed');
  });

  it('exits 2 on a non-numeric or out-of-range --min', () => {
    repo.write('lcov.info', '');
    for (const min of ['', 'eighty', '101', '-1', 'NaN']) {
      const out = run({ min });
      expect(out.exitCode, min).toBe(2);
      expect(out.stderr, min).toContain('--min');
    }
  });

  it('exits 2 naming every changed in-scope source file that has no lcov record (never a pass)', () => {
    repo.write('src/a.ts', 'a\n');
    repo.commitBase();
    repo.write('src/a.ts', `a\n${lines(25)}`);
    repo.write('src/view.tsx', lines(3));
    repo.write('crates/core/src/lib.rs', lines(3));
    repo.write('lcov.info', record('src/a.ts', range(2, 26), range(2, 26)));
    const out = run();
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain('no lcov record for src/view.tsx');
    expect(out.stderr).toContain('no lcov record for crates/core/src/lib.rs');
    expect(out.stderr).not.toContain('no lcov record for src/a.ts');
  });

  it('exits 2 for an UNTRACKED new source file with no lcov record (review R2 C2)', () => {
    repo.write('src/a.ts', 'a\n');
    repo.commitBase();
    repo.write('src/brand-new.ts', lines(4));
    repo.write('lcov.info', '');
    const out = run();
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain('no lcov record for src/brand-new.ts');
  });

  it('does not require a record for excluded files (COVERAGE_DEFAULT_EXCLUDES) or non-source files', () => {
    expect(COVERAGE_DEFAULT_EXCLUDES).toEqual(
      expect.arrayContaining([
        '*.spec.ts',
        '**/src/gen/**',
        'build.rs',
        '*.d.ts',
      ]),
    );
    repo.write('README.md', 'x\n');
    repo.commitBase();
    repo.write('apps/api/src/thing.spec.ts', lines(30));
    repo.write('apps/api/src/gen/entity.ts', lines(30));
    repo.write('types/global.d.ts', lines(30));
    repo.write('crates/core/build.rs', lines(30));
    repo.write('crates/core/tests/it.rs', lines(30));
    repo.write('README.md', `x\n${lines(30)}`);
    repo.write('lcov.info', '');
    const out = run();
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain('0 changed executable lines');
  });

  it('--exclude adds to the default list', () => {
    repo.write('README.md', 'x\n');
    repo.commitBase();
    repo.write('scripts/tool.ts', lines(30));
    repo.write('lcov.info', '');
    expect(run().exitCode).toBe(2);
    expect(run({ exclude: ['scripts/**'] }).exitCode).toBe(0);
  });

  it('--scope narrows which changed files must have records', () => {
    repo.write('README.md', 'x\n');
    repo.commitBase();
    repo.write('packages/a/src/x.ts', lines(3));
    repo.write('packages/b/src/y.ts', lines(3));
    repo.write(
      'lcov.info',
      record('packages/a/src/x.ts', [1, 2, 3], [1, 2, 3]),
    );
    expect(run().exitCode).toBe(2);
    const scoped = run({ scope: ['packages/a'] });
    expect(scoped.exitCode).toBe(0);
  });

  it('--base "" falls through to the CI target branch, then the merge base', () => {
    repo.write('src/a.ts', 'a\n');
    repo.commitBase();
    repo.write('src/a.ts', 'a\nb\n');
    repo.write('lcov.info', record('src/a.ts', [1, 2], [1, 2]));
    const viaCi = executeChangedCoverage(
      { lcov: 'lcov.info', min: '80', base: '', 'lcov-root': '.' },
      repo.root,
      { ciTargetBranch: 'main' },
    );
    expect(viaCi.exitCode).toBe(0);
    expect(viaCi.stdout).toContain('against origin/main');
    expect(run().stdout).toContain('against origin/HEAD');
  });
});

describe('gates changed-coverage — the verdict', () => {
  beforeEach(() => {
    repo.write('src/svc.ts', lines(10));
    repo.write('src/old.ts', lines(100, 'stable'));
    repo.commitBase();
  });

  it('fails (exit 1) on uncovered changed lines and prints each file:line', () => {
    repo.write('src/svc.ts', `${lines(10)}${lines(30, 'new')}`);
    // Lines 11-40 are new; 11-30 covered, 31-40 uncovered = 66.7%.
    repo.write(
      'lcov.info',
      record('src/svc.ts', range(1, 40), [...range(1, 10), ...range(11, 30)]),
    );
    const out = run();
    expect(out.exitCode).toBe(1);
    expect(out.stdout).toContain(
      '20/30 changed executable lines covered (66.7%, min 80%)',
    );
    expect(out.stdout).toContain('uncovered changed lines:');
    expect(out.stdout).toContain('src/svc.ts:31');
    expect(out.stdout).toContain('src/svc.ts:40');
    expect(out.stdout).not.toContain('src/svc.ts:30\n');
  });

  it('passes when the covered share is at or above --min', () => {
    repo.write('src/svc.ts', `${lines(10)}${lines(30, 'new')}`);
    repo.write(
      'lcov.info',
      record('src/svc.ts', range(1, 40), [...range(11, 34)]),
    );
    const out = run(); // 24/30 = 80%
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain('PASS 24/30');
    expect(run({ min: '81' }).exitCode).toBe(1);
  });

  // internal review L6: a leftover lcov from before the edit is stale evidence.
  it('exits 2 when the lcov file is older than a changed file it measures', () => {
    repo.write('src/svc.ts', `${lines(10)}${lines(30, 'new')}`);
    repo.write('lcov.info', record('src/svc.ts', range(1, 40), range(1, 40)));
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(repo.root, 'lcov.info'), past, past);
    const out = run();
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain('lcov.info is older than 1 changed file(s)');
    expect(out.stderr).toContain('src/svc.ts');
    // The same files with a fresh lcov measure as usual.
    const now = new Date(Date.now() + 60_000);
    utimesSync(join(repo.root, 'lcov.info'), now, now);
    expect(run().exitCode).toBe(0);
  });

  it('counts only lines lcov marks executable', () => {
    repo.write('src/svc.ts', `${lines(10)}${lines(30, 'new')}`);
    // Only 25 of the 30 new lines are executable; all 25 covered.
    repo.write('lcov.info', record('src/svc.ts', range(16, 40), range(16, 40)));
    const out = run();
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain('25/25');
  });

  it('passes a small change below 20 executable lines as not enforced', () => {
    repo.write('src/svc.ts', `${lines(10)}${lines(5, 'new')}`);
    repo.write('lcov.info', record('src/svc.ts', range(1, 15), []));
    const out = run();
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain('5 changed lines, not enforced');
  });

  it('passes zero changed executable lines and says so', () => {
    repo.write('src/svc.ts', `${lines(10)}// comment\n`);
    repo.write('lcov.info', record('src/svc.ts', range(1, 10), range(1, 10)));
    const out = run();
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain('0 changed executable lines');
  });

  it('still requires an lcov record for a changed file that only lost lines', () => {
    // Deletion-only edit: no added lines, but the file is changed and in
    // scope, so a missing record is missing evidence (exit 2), not a pass.
    repo.write('src/svc.ts', lines(8));
    repo.write('lcov.info', record('src/old.ts', [1], [1]));
    const out = run();
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain('no lcov record for src/svc.ts');

    repo.write('lcov.info', record('src/svc.ts', range(1, 8), range(1, 8)));
    const withRecord = run();
    expect(withRecord.exitCode).toBe(0);
    expect(withRecord.stdout).toContain('0 changed executable lines');
  });

  it('measures a renamed file by its new path and only its edited lines', () => {
    repo.git('mv', 'src/old.ts', 'src/renamed.ts');
    const edited = lines(100, 'stable').replace(
      /stable (1[0-9]|2[0-9])\n/g,
      'edited $1\n',
    );
    repo.write('src/renamed.ts', edited);
    repo.commit('rename and edit lines 10-29');
    // Lines 10-29 changed (20 of 100, so git still sees a rename); cover 10-25 = 16/20 = 80%.
    repo.write(
      'lcov.info',
      record('src/renamed.ts', range(1, 100), range(10, 25)),
    );
    const out = run();
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain('16/20');
  });
});

describe('gates changed-coverage — app-rooted lcov (review R2 C6)', () => {
  it('resolves relative SF paths against --lcov-root and absolute ones against the repo root', () => {
    repo.write('apps/api/src/a.ts', lines(5));
    repo.write('apps/api/src/b.ts', lines(5));
    repo.commitBase();
    repo.write('apps/api/src/a.ts', `${lines(5)}${lines(12, 'new a')}`);
    repo.write('apps/api/src/b.ts', `${lines(5)}${lines(12, 'new b')}`);
    const lcov = [
      // Relative to the app, as a run from apps/api writes it.
      record('src/a.ts', range(6, 17), range(6, 17)),
      // Absolute.
      record(join(repo.root, 'apps/api/src/b.ts'), range(6, 17), range(6, 11)),
      // Outside the repository: reported and ignored.
      record('/elsewhere/x.ts', [1], [1]),
    ].join('\n');
    repo.write('apps/api/coverage/lcov.info', lcov);

    const flags = {
      lcov: 'apps/api/coverage/lcov.info',
      'lcov-root': 'apps/api',
    };
    // a: 12/12 covered, b: 6/12 → 18/24 = 75%.
    const out = run(flags);
    expect(out.exitCode).toBe(1);
    expect(out.stdout).toContain(
      '18/24 changed executable lines covered (75.0%',
    );
    expect(out.stdout).toContain('apps/api/src/b.ts:12');
    expect(out.stdout).toContain(
      'ignored 1 lcov record(s) outside the repository: /elsewhere/x.ts',
    );
    expect(run({ ...flags, min: '75' }).exitCode).toBe(0);

    // Without --lcov-root the relative record does not match: missing evidence.
    const unrooted = run({ lcov: 'apps/api/coverage/lcov.info' });
    expect(unrooted.exitCode).toBe(2);
    expect(unrooted.stderr).toContain('no lcov record for apps/api/src/a.ts');
  });
});

describe('lcov parsing', () => {
  it('reads SF/DA records and keeps the larger hit count for a repeated file', () => {
    const parsed = parseLcov(
      [
        'SF:a.ts',
        'DA:1,0',
        'DA:2,3',
        'end_of_record',
        'SF:a.ts',
        'DA:1,2',
        'end_of_record',
      ].join('\n'),
    );
    expect([...(parsed.get('a.ts') ?? new Map())]).toEqual([
      [1, 2],
      [2, 3],
    ]);
  });

  it('normalises SF paths to repo-root paths', () => {
    const records = parseLcov(
      [
        'SF:src/x.ts',
        'DA:1,1',
        'end_of_record',
        'SF:/repo/apps/y.ts',
        'DA:1,1',
        'end_of_record',
        'SF:../../../out.ts',
        'DA:1,1',
        'end_of_record',
      ].join('\n'),
    );
    const { byFile, outside } = normaliseLcovPaths(
      records,
      '/repo',
      'apps/api',
    );
    expect([...byFile.keys()].sort()).toEqual([
      'apps/api/src/x.ts',
      'apps/y.ts',
    ]);
    expect(outside).toEqual(['../../../out.ts']);
  });

  it('measureCoverage reports a missing record instead of zero lines', () => {
    const result = measureCoverage(
      [
        {
          path: 'a.ts',
          status: 'added',
          addedLines: [1],
          binary: false,
          untracked: false,
        },
      ],
      new Map(),
    );
    expect(result.missingRecords).toEqual(['a.ts']);
    expect(result.executable).toBe(0);
  });
});
