import * as fs from 'node:fs';
import * as path from 'node:path';

import type { LocalContext } from '../../context.js';
import {
  computeChangeScope,
  GitError,
  matchesAny,
  NoMergeBaseError,
  type ChangeScopeOptions,
  type ChangedFile,
} from './change-scope.js';
import { COVERAGE_DEFAULT_EXCLUDES } from './coverage-defaults.js';

/**
 * `levr gates changed-coverage` (internal D4.2): line coverage over only the
 * lines the change added, read from an lcov file. The `changed_line_coverage`
 * gate runs it.
 *
 * A line counts only when lcov marks it executable (a `DA` record). Every
 * in-scope changed `.ts`, `.tsx` or `.rs` file that is not excluded MUST have
 * an `SF` record: a missing record is missing evidence, so it exits 2 naming
 * the file, never "zero lines" (review R1 C1/C6).
 *
 * Exit 0 when coverage is at or above `--min`; 1 below it, printing every
 * uncovered `file:line`; 2 for a usage error, no merge base, no lcov file, a
 * changed file with no lcov record, or a crash. Zero changed executable lines
 * passes and says so; fewer than SMALL_CHANGE_LINES passes as "not enforced"
 * (the SonarQube small-change rule).
 */

/** Source extensions whose changed lines are measured. */
export const COVERAGE_SOURCE_EXTENSIONS = ['.ts', '.tsx', '.rs'] as const;

/**
 * Changed files never measured, defined in a leaf module so `--help` can print
 * it without loading this handler: tests, `*.d.ts`, generated code
 * (`**\/src/gen/**`), fixtures, migrations, config files, Rust integration
 * tests and `build.rs`. `--exclude` adds to it.
 */
export { COVERAGE_DEFAULT_EXCLUDES };

/** Below this many changed executable lines the threshold is not enforced. */
export const SMALL_CHANGE_LINES = 20;

export interface ChangedCoverageFlags {
  lcov: string;
  min: string;
  base: string;
  scope?: readonly string[];
  exclude?: readonly string[];
  'lcov-root': string;
}

export interface CoverageOutcome {
  exitCode: 0 | 1 | 2;
  stdout: string;
  stderr: string;
}

/** Per-file line hits from an lcov file: SF path → (line → hit count). */
export type LcovRecords = Map<string, Map<number, number>>;

/**
 * Parse lcov `SF:` / `DA:<line>,<hits>` / `end_of_record`. Other records
 * (functions, branches, checksums) are ignored. A file listed twice (two
 * test runs merged) keeps the larger hit count per line.
 */
export function parseLcov(text: string): LcovRecords {
  const records: LcovRecords = new Map();
  let current: Map<number, number> | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      const file = line.slice(3);
      current = records.get(file) ?? new Map<number, number>();
      records.set(file, current);
    } else if (line.startsWith('DA:') && current) {
      const [lineNo, hits] = line.slice(3).split(',');
      const n = Number(lineNo);
      const h = Number(hits);
      if (Number.isInteger(n) && Number.isFinite(h)) {
        current.set(n, Math.max(current.get(n) ?? 0, h));
      }
    } else if (line === 'end_of_record') {
      current = null;
    }
  }
  return records;
}

/**
 * lcov SF paths → repo-root-relative paths (review R2 C6). An absolute path
 * is made relative to the repository root; a relative one is resolved
 * against `lcovRoot` (repo-relative, e.g. `apps/backender` for an app-rooted
 * run). A path outside the repository is returned in `outside`.
 */
export function normaliseLcovPaths(
  records: LcovRecords,
  repoRoot: string,
  lcovRoot: string,
): { byFile: LcovRecords; outside: string[] } {
  const byFile: LcovRecords = new Map();
  const outside: string[] = [];
  const base = path.resolve(repoRoot, lcovRoot);
  for (const [sf, lines] of records) {
    const abs = path.isAbsolute(sf)
      ? path.normalize(sf)
      : path.resolve(base, sf);
    const rel = path.relative(repoRoot, abs);
    if (
      rel === '' ||
      rel === '..' ||
      rel.startsWith(`..${path.sep}`) ||
      path.isAbsolute(rel)
    ) {
      outside.push(sf);
      continue;
    }
    const key = rel.split(path.sep).join('/');
    const merged = byFile.get(key) ?? new Map<number, number>();
    for (const [n, h] of lines) merged.set(n, Math.max(merged.get(n) ?? 0, h));
    byFile.set(key, merged);
  }
  return { byFile, outside };
}

/**
 * Every changed in-scope source file that is not excluded: each must have an
 * lcov record. A file the change only shortened, or renamed untouched, is
 * still changed, so it needs one too even though it adds no lines to count.
 * Only a deleted file is exempt: there is nothing left to measure.
 */
export function measuredFiles(
  files: readonly ChangedFile[],
  excludes: readonly string[],
): ChangedFile[] {
  return files.filter(
    (f) =>
      f.status !== 'deleted' &&
      COVERAGE_SOURCE_EXTENSIONS.some((ext) => f.path.endsWith(ext)) &&
      !matchesAny(f.path, excludes),
  );
}

export interface CoverageResult {
  executable: number;
  covered: number;
  uncovered: string[];
  missingRecords: string[];
}

/** Changed executable lines, covered lines and the uncovered `file:line`s. */
export function measureCoverage(
  files: readonly ChangedFile[],
  byFile: LcovRecords,
): CoverageResult {
  const result: CoverageResult = {
    executable: 0,
    covered: 0,
    uncovered: [],
    missingRecords: [],
  };
  for (const file of files) {
    const hits = byFile.get(file.path);
    if (!hits) {
      result.missingRecords.push(file.path);
      continue;
    }
    for (const n of file.addedLines) {
      const h = hits.get(n);
      if (h === undefined) continue; // not executable
      result.executable++;
      if (h > 0) result.covered++;
      else result.uncovered.push(`${file.path}:${n}`);
    }
  }
  return result;
}

function fail2(message: string): CoverageOutcome {
  return {
    exitCode: 2,
    stdout: '',
    stderr: `gates changed-coverage: ${message}\n`,
  };
}

/** The command body; `execute…` below maps any throw to exit 2. */
function runChangedCoverage(
  flags: ChangedCoverageFlags,
  cwd: string = process.cwd(),
  scopeOptions: Partial<ChangeScopeOptions> = {},
): CoverageOutcome {
  const min = Number(flags.min);
  if (
    flags.min.trim() === '' ||
    !Number.isFinite(min) ||
    min < 0 ||
    min > 100
  ) {
    return fail2(`--min "${flags.min}" must be a number from 0 to 100`);
  }
  if (!flags.lcov.trim()) return fail2('--lcov is required');
  const lcovPath = path.resolve(cwd, flags.lcov);
  if (!fs.existsSync(lcovPath)) {
    return fail2(
      `no lcov file at ${flags.lcov}; run the tests with lcov coverage first`,
    );
  }

  try {
    const scope = computeChangeScope({
      cwd,
      base: flags.base,
      scope: flags.scope,
      ...scopeOptions,
    });
    const excludes = [...COVERAGE_DEFAULT_EXCLUDES, ...(flags.exclude ?? [])];
    const files = measuredFiles(scope.files, excludes);

    // Review L6: an lcov file older than a file it measures maps that file's
    // OLD line numbers onto the new code, which can pass a change no test
    // ran. Missing evidence, so exit 2 and name what changed after it.
    const lcovTime = fs.statSync(lcovPath).mtimeMs;
    const newer = files
      .filter((f) => {
        const abs = path.join(scope.root, f.path);
        return fs.existsSync(abs) && fs.statSync(abs).mtimeMs > lcovTime;
      })
      .map((f) => f.path);
    if (newer.length > 0) {
      return fail2(
        `${flags.lcov} is older than ${newer.length} changed file(s) it would measure (${newer.join(', ')}); ` +
          `run the tests with coverage again so it describes the current code ` +
          `(a coverage file restored from a cache, or a git checkout, stash or rebase after the test run, does this too)`,
      );
    }

    const { byFile, outside } = normaliseLcovPaths(
      parseLcov(fs.readFileSync(lcovPath, 'utf8')),
      scope.root,
      flags['lcov-root'] || '.',
    );
    const notes =
      outside.length > 0
        ? `ignored ${outside.length} lcov record(s) outside the repository: ${outside.join(', ')}\n`
        : '';

    const result = measureCoverage(files, byFile);
    if (result.missingRecords.length > 0) {
      return {
        exitCode: 2,
        stdout: '',
        stderr:
          notes +
          result.missingRecords
            .map((f) => `gates changed-coverage: no lcov record for ${f}\n`)
            .join('') +
          `A changed source file with no lcov record is missing evidence, never zero lines. ` +
          `Run its tests with coverage, check --lcov-root (now "${flags['lcov-root'] || '.'}"), ` +
          `or exclude it with --exclude.\n`,
      };
    }

    const where = `against ${scope.baseRef} (merge base ${scope.mergeBase.slice(0, 12)})`;
    if (result.executable === 0) {
      return {
        exitCode: 0,
        stdout: `${notes}PASS 0 changed executable lines in ${files.length} file(s) ${where}; nothing to measure\n`,
        stderr: '',
      };
    }
    const pct = (100 * result.covered) / result.executable;
    const summary = `${result.covered}/${result.executable} changed executable lines covered (${pct.toFixed(1)}%, min ${min}%) ${where}`;
    if (result.executable < SMALL_CHANGE_LINES) {
      return {
        exitCode: 0,
        stdout: `${notes}PASS ${result.executable} changed lines, not enforced (fewer than ${SMALL_CHANGE_LINES}): ${summary}\n`,
        stderr: '',
      };
    }
    if (pct >= min) {
      return { exitCode: 0, stdout: `${notes}PASS ${summary}\n`, stderr: '' };
    }
    return {
      exitCode: 1,
      stdout:
        `${notes}FAIL ${summary}\nuncovered changed lines:\n` +
        result.uncovered.map((l) => `  ${l}\n`).join(''),
      stderr: '',
    };
  } catch (error) {
    if (error instanceof NoMergeBaseError || error instanceof GitError) {
      return fail2(error.message);
    }
    const message = error instanceof Error ? error.message : String(error);
    return fail2(`crashed: ${message}`);
  }
}

/**
 * The whole command minus process I/O, so tests can drive it. Any throw —
 * from validation, path resolution or anything below — is exit 2, never an
 * uncaught error: stricli would exit 1 for it, which reads as a verdict.
 */
export function executeChangedCoverage(
  flags: ChangedCoverageFlags,
  cwd?: string,
  scopeOptions: Partial<ChangeScopeOptions> = {},
): CoverageOutcome {
  try {
    return runChangedCoverage(flags, cwd ?? process.cwd(), scopeOptions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail2(`crashed: ${message}`);
  }
}

export function gatesChangedCoverageHandler(
  this: LocalContext,
  flags: ChangedCoverageFlags,
): void {
  const result = executeChangedCoverage(flags);
  if (result.stdout.length > 0) this.process.stdout.write(result.stdout);
  if (result.stderr.length > 0) this.process.stderr.write(result.stderr);
  this.process.exitCode = result.exitCode;
}
