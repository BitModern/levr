import { buildCommand } from '@stricli/core';

import { COVERAGE_DEFAULT_EXCLUDES } from './coverage-defaults.js';

export const gatesChangedCoverageCommand = buildCommand({
  docs: {
    brief: 'Check line coverage over only the lines the change added',
    fullDescription: `Read an lcov file and measure coverage over the lines this change added,
against the merge base. This is the command a changed_line_coverage gate runs.

The base is, first match wins: --base (empty or 'auto' counts as not given);
the CI provider's PR target branch (e.g. GITHUB_BASE_REF); origin/HEAD. The
working tree is compared with \`git merge-base HEAD <base>\`, so committed,
staged, unstaged and untracked files all count.

Only changed .ts, .tsx and .rs files are measured, and a line counts only
when the lcov file marks it executable. Every measured file must have an lcov
SF record: one without is reported and exits 2, never read as zero lines.

lcov SF paths are matched against repository paths: an absolute path is made
relative to the repository root, a relative one is resolved against
--lcov-root (e.g. apps/backender when the tests ran from that app).

Excluded by default (--exclude adds to this list):
  ${COVERAGE_DEFAULT_EXCLUDES.join('\n  ')}

Exit code 0 when coverage is at or above --min (default 80), or when fewer
than 20 changed lines are executable (reported as not enforced); 1 below
--min, printing every uncovered file:line; 2 for a usage error, no merge base,
no lcov file, a changed file with no lcov record, or a crash.

Examples:
  levr gates changed-coverage --lcov apps/backender/coverage/lcov.info --lcov-root apps/backender
  levr gates changed-coverage --lcov coverage/lcov.info --base origin/main --scope packages/cli --min 90`,
  },
  parameters: {
    flags: {
      lcov: {
        kind: 'parsed',
        parse: String,
        brief: 'lcov file to read (e.g. coverage/lcov.info)',
        placeholder: 'file',
      },
      min: {
        kind: 'parsed',
        parse: String,
        brief: 'Minimum percentage of changed executable lines covered',
        placeholder: 'percent',
        default: '80',
      },
      base: {
        kind: 'parsed',
        parse: String,
        brief: "Base ref to diff against; empty or 'auto' means auto-detect",
        placeholder: 'ref',
        default: '',
      },
      scope: {
        kind: 'parsed',
        parse: String,
        brief: 'Only count changes under this path (repeatable)',
        placeholder: 'path',
        variadic: true,
        optional: true,
      },
      exclude: {
        kind: 'parsed',
        parse: String,
        brief: 'Also exclude changed files matching this glob (repeatable)',
        placeholder: 'glob',
        variadic: true,
        optional: true,
      },
      'lcov-root': {
        kind: 'parsed',
        parse: String,
        brief: 'Directory relative lcov SF paths are resolved against',
        placeholder: 'dir',
        default: '.',
      },
    },
  },
  loader: async () => {
    const { gatesChangedCoverageHandler } = await import(
      './changedCoverageHandler.js'
    );
    return gatesChangedCoverageHandler;
  },
});
