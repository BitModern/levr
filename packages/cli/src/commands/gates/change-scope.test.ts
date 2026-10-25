import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  computeChangeScope,
  globToRegExp,
  matchesAny,
  NoMergeBaseError,
  parseNameStatus,
  parseDiffPath,
  parseUnifiedDiff,
  readAtBase,
  resolveBaseRef,
  runGit,
  type ChangedFile,
} from './change-scope.js';
import { lines, TempRepo } from './change-scope.test-helpers.js';

/**
 * internal D4.1 — the change scope shared by `gates changed-coverage` and
 * `gates dependency-audit`. The integration cases run real git in a temp
 * repository, so renames, deletions, binaries and untracked files come from
 * git itself rather than from a fixture of its output.
 */

let repo: TempRepo;
beforeEach(() => {
  repo = new TempRepo();
});
afterEach(() => {
  repo.dispose();
});

const byPath = (files: ChangedFile[], p: string) =>
  files.find((f) => f.path === p);

describe('resolveBaseRef — first match wins', () => {
  it('uses --base when given', () => {
    repo.write('a.txt', 'a\n');
    repo.commitBase();
    expect(resolveBaseRef(runGit, repo.root, 'main', 'develop')).toEqual({
      ref: 'main',
      source: 'flag',
    });
  });

  it('treats an empty --base as not given and falls through to the CI target branch', () => {
    repo.write('a.txt', 'a\n');
    repo.commitBase();
    // origin/main exists, so the CI branch resolves to the remote-tracking ref.
    expect(resolveBaseRef(runGit, repo.root, '', 'main')).toEqual({
      ref: 'origin/main',
      source: 'ci',
    });
    expect(resolveBaseRef(runGit, repo.root, '   ', 'main').source).toBe('ci');
  });

  // internal D3: a gate binding cannot pass an empty argument, so an omitted
  // `base` param renders as `--base auto`.
  it('treats --base auto exactly like an empty --base', () => {
    repo.write('a.txt', 'a\n');
    repo.commitBase();
    expect(resolveBaseRef(runGit, repo.root, 'auto', 'main')).toEqual({
      ref: 'origin/main',
      source: 'ci',
    });
    expect(resolveBaseRef(runGit, repo.root, ' auto ', undefined)).toEqual({
      ref: 'origin/HEAD',
      source: 'origin-head',
    });
  });

  it('uses the bare CI branch when no remote-tracking ref exists', () => {
    repo.write('a.txt', 'a\n');
    repo.commitBase();
    expect(resolveBaseRef(runGit, repo.root, undefined, 'feature')).toEqual({
      ref: 'feature',
      source: 'ci',
    });
  });

  it('falls back to origin/HEAD with neither --base nor a CI target', () => {
    expect(resolveBaseRef(runGit, repo.root, '', undefined)).toEqual({
      ref: 'origin/HEAD',
      source: 'origin-head',
    });
  });
});

describe('computeChangeScope — no merge base', () => {
  it('throws NoMergeBaseError (exit 2 upstream), never an empty pass', () => {
    repo.write('a.ts', 'a\n');
    repo.commit('only commit, no origin/HEAD');
    expect(() =>
      computeChangeScope({ cwd: repo.root, base: '', ciTargetBranch: '' }),
    ).toThrow(NoMergeBaseError);
    expect(() =>
      computeChangeScope({
        cwd: repo.root,
        base: 'no-such-ref',
        ciTargetBranch: '',
      }),
    ).toThrow(/no merge base between HEAD and no-such-ref/);
  });
});

describe('computeChangeScope — what the change touched', () => {
  beforeEach(() => {
    repo.write('src/keep.ts', lines(5));
    repo.write('src/old-name.ts', lines(30, 'stable'));
    repo.write('src/gone.ts', lines(3));
    repo.write('docs/readme.md', 'hello\n');
    repo.commitBase();
  });

  const scope = (
    extra: Parameters<typeof computeChangeScope>[0] = { cwd: '' },
  ) => computeChangeScope({ ciTargetBranch: '', ...extra, cwd: repo.root });

  it('lists the added lines of a modified file, committed and uncommitted', () => {
    repo.write('src/keep.ts', `${lines(5)}added 6\nadded 7\n`);
    repo.commit('append');
    repo.write('src/keep.ts', `${lines(5)}added 6\nadded 7\nuncommitted 8\n`);
    const result = scope();
    expect(result.baseSource).toBe('origin-head');
    expect(byPath(result.files, 'src/keep.ts')).toMatchObject({
      status: 'modified',
      addedLines: [6, 7, 8],
      untracked: false,
    });
  });

  it('follows a renamed file and counts only its changed lines', () => {
    repo.git('mv', 'src/old-name.ts', 'src/new-name.ts');
    repo.write(
      'src/new-name.ts',
      lines(30, 'stable').replace('stable 4\n', 'edited 4\n'),
    );
    repo.commit('rename');
    const file = byPath(scope().files, 'src/new-name.ts');
    expect(file).toMatchObject({
      status: 'renamed',
      oldPath: 'src/old-name.ts',
      addedLines: [4],
    });
  });

  it('reports a deleted file with no added lines', () => {
    repo.git('rm', '-q', 'src/gone.ts');
    repo.commit('delete');
    expect(byPath(scope().files, 'src/gone.ts')).toMatchObject({
      status: 'deleted',
      addedLines: [],
    });
  });

  it('treats a new committed file as every line added', () => {
    repo.write('src/fresh.ts', lines(4));
    repo.commit('add');
    expect(byPath(scope().files, 'src/fresh.ts')).toMatchObject({
      status: 'added',
      addedLines: [1, 2, 3, 4],
      untracked: false,
    });
  });

  it('marks a binary file and gives it no lines', () => {
    repo.write('assets/logo.bin', Buffer.from([0, 1, 2, 0, 3]));
    repo.commit('binary');
    expect(byPath(scope().files, 'assets/logo.bin')).toMatchObject({
      binary: true,
      addedLines: [],
    });
  });

  it('flags a binary that is only renamed, only changes mode, or is deleted', () => {
    repo.write('assets/a.bin', Buffer.from([0, 1, 0]));
    repo.write('assets/b.bin', Buffer.from([0, 2, 0]));
    repo.write('assets/c.bin', Buffer.from([0, 3, 0]));
    // A TAB in the name: numstat -z leaves it unquoted inside the path field.
    repo.write('assets/tab\tname.bin', Buffer.from([0, 4, 0]));
    repo.commit('binaries');
    repo.git('mv', 'assets/a.bin', 'assets/renamed.bin');
    chmodSync(join(repo.root, 'assets/b.bin'), 0o755);
    repo.git('rm', '-q', 'assets/c.bin');
    repo.git('rm', '-q', 'assets/tab\tname.bin');
    repo.commit('rename, chmod, delete');
    // Diff against the commit that added them, so each shows its change kind.
    const base = repo.git('rev-parse', 'HEAD~1').trim();
    const files = computeChangeScope({
      cwd: repo.root,
      base,
      ciTargetBranch: '',
    }).files;
    expect(byPath(files, 'assets/renamed.bin')).toMatchObject({
      status: 'renamed',
      binary: true,
    });
    expect(byPath(files, 'assets/b.bin')).toMatchObject({
      status: 'modified',
      binary: true,
    });
    expect(byPath(files, 'assets/c.bin')).toMatchObject({
      status: 'deleted',
      binary: true,
    });
    expect(byPath(files, 'assets/tab\tname.bin')).toMatchObject({
      status: 'deleted',
      binary: true,
    });
  });

  it('includes an untracked new .ts file with every line added (review R2 C2)', () => {
    repo.write('src/untracked.ts', lines(3));
    expect(byPath(scope().files, 'src/untracked.ts')).toMatchObject({
      status: 'added',
      untracked: true,
      addedLines: [1, 2, 3],
    });
  });

  it('includes an untracked lockfile, which has no content at the base', () => {
    repo.write('yarn.lock', 'lock\n');
    const result = scope();
    const lock = byPath(result.files, 'yarn.lock');
    expect(lock?.untracked).toBe(true);
    expect(readAtBase(result, lock as ChangedFile)).toBeNull();
  });

  it('skips an untracked file that .gitignore excludes', () => {
    repo.write('.gitignore', 'coverage/\n');
    repo.commit('ignore');
    repo.write('coverage/lcov.info', 'SF:x\n');
    expect(byPath(scope().files, 'coverage/lcov.info')).toBeUndefined();
  });

  it('narrows to --scope when it is narrower than the diff', () => {
    repo.write('src/keep.ts', `${lines(5)}added\n`);
    repo.write('docs/readme.md', 'hello\nmore\n');
    repo.write('docs/new.md', 'new\n');
    const files = scope({ cwd: '', scope: ['src'] }).files.map((f) => f.path);
    expect(files).toEqual(['src/keep.ts']);
  });

  it('honours --base over origin/HEAD', () => {
    const first = repo.commit('empty on feature');
    repo.write('src/keep.ts', `${lines(5)}after first\n`);
    const result = scope({ cwd: '', base: first });
    expect(result.baseSource).toBe('flag');
    expect(result.mergeBase).toBe(first);
    expect(byPath(result.files, 'src/keep.ts')?.addedLines).toEqual([6]);
  });

  it('reads a modified file at the merge base through git show', () => {
    repo.write('src/keep.ts', `${lines(5)}x\n`);
    const result = scope();
    const file = byPath(result.files, 'src/keep.ts') as ChangedFile;
    expect(readAtBase(result, file)).toBe(lines(5));
  });

  it('keeps the added lines of paths git quotes or tab-terminates in patch headers', () => {
    // A space makes git append a TAB to `+++ b/…`; a quote or tab makes it
    // C-quote the path. Taken verbatim, both lost their added lines.
    const awkward = [
      'src/with space.ts',
      'src/quo"te.ts',
      'src/tab\tname.ts',
      'src/ünï.ts',
    ];
    for (const p of awkward) repo.write(p, lines(2));
    repo.commit('awkward names');
    for (const p of awkward) repo.write(p, `${lines(2)}added\n`);
    // New since the merge base, so every line is added; the old parser gave [].
    const files = scope().files;
    for (const p of awkward) {
      expect(byPath(files, p)?.addedLines, p).toEqual([1, 2, 3]);
    }
  });
});

describe('parseDiffPath', () => {
  it('unquotes C-quoted paths, octal bytes, and strips the space-path TAB', () => {
    expect(parseDiffPath('"b/quo\\"te.ts"', 'b')).toBe('quo"te.ts');
    expect(parseDiffPath('"b/tab\\tname.ts"', 'b')).toBe('tab\tname.ts');
    expect(parseDiffPath('"b/\\303\\274.ts"', 'b')).toBe('ü.ts');
    expect(parseDiffPath('b/with space.ts\t', 'b')).toBe('with space.ts');
    expect(parseDiffPath('b/plain.ts', 'b')).toBe('plain.ts');
    expect(parseDiffPath('/dev/null', 'b')).toBeNull();
  });
});

describe('diff parsers', () => {
  it('parseNameStatus reads NUL-separated status, rename and copy entries', () => {
    const out = [
      'M',
      'a.ts',
      'R087',
      'old.ts',
      'new.ts',
      'D',
      'gone.ts',
      'A',
      'n.ts',
      '',
    ].join('\0');
    expect(parseNameStatus(out)).toEqual([
      { path: 'a.ts', status: 'modified' },
      { path: 'new.ts', status: 'renamed', oldPath: 'old.ts' },
      { path: 'gone.ts', status: 'deleted' },
      { path: 'n.ts', status: 'added' },
    ]);
  });

  it('parseUnifiedDiff reads hunk counts, including omitted and zero counts', () => {
    const diff = [
      'diff --git a/x.ts b/x.ts',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -3 +3 @@',
      '@@ -10,0 +11,2 @@',
      '@@ -20,2 +22,0 @@',
      'diff --git a/gone.ts b/gone.ts',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      'diff --git a/i.png b/i.png',
      'Binary files a/i.png and b/i.png differ',
    ].join('\n');
    const { added, binary } = parseUnifiedDiff(diff);
    expect(added.get('x.ts')).toEqual([3, 11, 12]);
    expect(added.has('gone.ts')).toBe(false);
    expect(binary.has('i.png')).toBe(true);
  });
});

describe('globToRegExp', () => {
  it('matches a basename pattern anywhere and ** across directories', () => {
    expect(matchesAny('apps/x/src/a.test.ts', ['*.test.ts'])).toBe(true);
    expect(matchesAny('src/gen/a.ts', ['**/src/gen/**'])).toBe(true);
    expect(matchesAny('apps/backender/src/gen/a/b.ts', ['**/src/gen/**'])).toBe(
      true,
    );
    expect(matchesAny('crates/c/tests/it/x.rs', ['**/tests/**/*.rs'])).toBe(
      true,
    );
    expect(matchesAny('crates/c/src/lib.rs', ['**/tests/**/*.rs'])).toBe(false);
    expect(matchesAny('apps/x/src/generic.ts', ['**/src/gen/**'])).toBe(false);
  });

  it('keeps * inside one segment and escapes regex characters', () => {
    expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false);
    expect(globToRegExp('src/a+b.ts').test('src/a+b.ts')).toBe(true);
    expect(globToRegExp('src/a+b.ts').test('src/aab.ts')).toBe(false);
  });
});
