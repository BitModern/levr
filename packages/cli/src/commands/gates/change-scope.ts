import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { detectCiEnvironment } from '@levr/ci-env';

/**
 * What a change touches, for the change-scoped gates (internal D4.1):
 * `levr gates changed-coverage` and `levr gates dependency-audit`.
 *
 * The base is resolved first match wins: `--base` (an empty string counts as
 * not given, so a binding can always forward `{base}`); the CI provider's PR
 * target branch (`pr_target_branch`, e.g. GITHUB_BASE_REF); `origin/HEAD`.
 * The diff runs against `git merge-base HEAD <base>`; when there is none the
 * caller exits 2, never a pass. Every git call is read-only.
 *
 * The working tree is compared with the merge base, so committed, staged and
 * unstaged edits all count. `git diff` never lists untracked files (review R2
 * C2), so `git ls-files --others --exclude-standard` adds each one as a new
 * file with every line added.
 *
 * This module only says WHAT changed. Its callers own the verdicts: both map
 * `NoMergeBaseError` and `GitError` to exit 2, and `changedCoverageHandler`
 * requires an lcov record for every changed source file this returns.
 * Binary files (git's own test, or a NUL in an untracked file's first 8000
 * bytes) carry no added lines.
 */

export type GitRunner = (
  args: readonly string[],
  cwd: string,
) => { code: number; stdout: string; stderr: string };

export const runGit: GitRunner = (args, cwd) => {
  const r = spawnSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) {
    return { code: 127, stdout: '', stderr: r.error.message };
  }
  return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
};

export type ChangeStatus = 'added' | 'modified' | 'renamed' | 'deleted';

export interface ChangedFile {
  /** Repo-root-relative path in the working tree (the old path when deleted). */
  path: string;
  status: ChangeStatus;
  /** The path at the merge base, for a rename. */
  oldPath?: string;
  /** 1-based line numbers the change added in the working-tree file. */
  addedLines: number[];
  binary: boolean;
  untracked: boolean;
}

export type BaseSource = 'flag' | 'ci' | 'origin-head';

export interface ChangeScope {
  /** Absolute repository root (`git rev-parse --show-toplevel`). */
  root: string;
  baseRef: string;
  baseSource: BaseSource;
  mergeBase: string;
  files: ChangedFile[];
}

export class NoMergeBaseError extends Error {}

export class GitError extends Error {}

export interface ChangeScopeOptions {
  cwd: string;
  /** `--base`; empty or whitespace counts as not given. */
  base?: string;
  /** Repo paths (relative to `cwd`) the change is narrowed to; empty = all. */
  scope?: readonly string[];
  git?: GitRunner;
  /** The CI PR target branch; defaults to `@levr/ci-env` detection. */
  ciTargetBranch?: string;
}

function gitOrThrow(
  git: GitRunner,
  args: readonly string[],
  cwd: string,
): string {
  const r = git(args, cwd);
  if (r.code !== 0) {
    throw new GitError(
      `git ${args.join(' ')} failed (exit ${r.code}): ${r.stderr.trim()}`,
    );
  }
  return r.stdout;
}

function refExists(git: GitRunner, ref: string, cwd: string): boolean {
  return (
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd).code === 0
  );
}

/**
 * The `--base` value that means "not given" besides an empty one (internal
 * D3). A gate binding cannot pass an empty argument (the server's check
 * renderer refuses an empty argv element), so an omitted `base` param
 * renders as this word instead.
 */
export const AUTO_BASE = 'auto';

/** The ref to diff against, and where it came from. Pure apart from `git`. */
export function resolveBaseRef(
  git: GitRunner,
  cwd: string,
  base: string | undefined,
  ciTargetBranch: string | undefined,
): { ref: string; source: BaseSource } {
  const flag = base?.trim();
  if (flag && flag !== AUTO_BASE) return { ref: flag, source: 'flag' };
  const target = ciTargetBranch?.trim();
  if (target) {
    // CI checkouts usually have only the remote-tracking branch.
    const remote = `origin/${target}`;
    return {
      ref: refExists(git, remote, cwd) ? remote : target,
      source: 'ci',
    };
  }
  return { ref: 'origin/HEAD', source: 'origin-head' };
}

/** Repo-relative pathspecs for `--scope` (resolved against `cwd`). */
export function scopePathspecs(
  root: string,
  cwd: string,
  scope: readonly string[] | undefined,
): string[] {
  const specs: string[] = [];
  for (const raw of scope ?? []) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const rel = path.relative(root, path.resolve(cwd, trimmed));
    if (
      rel === '..' ||
      rel.startsWith(`..${path.sep}`) ||
      path.isAbsolute(rel)
    ) {
      throw new GitError(`--scope "${raw}" resolves outside the repository`);
    }
    specs.push(rel === '' ? '.' : rel.split(path.sep).join('/'));
  }
  return specs;
}

/**
 * `git diff --name-status -z -M` output → path, status and rename source.
 * Entries are NUL-separated: `<status>\0<path>\0` or, for a rename or copy,
 * `R<score>\0<old>\0<new>\0`.
 */
export function parseNameStatus(
  out: string,
): Array<Pick<ChangedFile, 'path' | 'status' | 'oldPath'>> {
  const parts = out.split('\0');
  const entries: Array<Pick<ChangedFile, 'path' | 'status' | 'oldPath'>> = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i];
    if (!code) continue;
    const kind = code[0];
    if (kind === 'R' || kind === 'C') {
      const oldPath = parts[++i] ?? '';
      const newPath = parts[++i] ?? '';
      entries.push(
        kind === 'R'
          ? { path: newPath, status: 'renamed', oldPath }
          : { path: newPath, status: 'added' },
      );
      continue;
    }
    const file = parts[++i] ?? '';
    if (kind === 'A') entries.push({ path: file, status: 'added' });
    else if (kind === 'D') entries.push({ path: file, status: 'deleted' });
    else entries.push({ path: file, status: 'modified' });
  }
  return entries;
}

/**
 * `git diff --numstat -z -M` output → the paths git counts as binary (`-` for
 * both counts). Unlike the patch's `Binary files … differ` line, numstat marks
 * a binary that is only renamed, only changes mode, or is deleted: observed
 * with git 2.54, an exact (100%) binary rename and a mode-only binary change
 * both print `-\t-`, never `0\t0` (the change-scope test asserts all three
 * against real git, a TAB-named file included). Entries are
 * `<add>\t<del>\t<path>\0`, or `<add>\t<del>\t\0<old>\0<new>\0` for a rename;
 * a deleted file is keyed by its old path, as `ChangedFile.path` is.
 */
export function parseNumstatBinary(out: string): Set<string> {
  const binary = new Set<string>();
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    // Only the first two TABs separate fields: with -z git leaves the path
    // unquoted, so a TAB inside a filename is part of the path.
    const fields = /^([^\t]*)\t([^\t]*)\t([\s\S]*)$/.exec(entry);
    if (!fields) continue;
    const [, added, deleted, file] = fields;
    let target = file ?? '';
    if (target === '') {
      i += 1; // old path
      target = parts[++i] ?? '';
    }
    if (added === '-' && deleted === '-' && target) binary.add(target);
  }
  return binary;
}

const C_ESCAPES: Record<string, number> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  '\\': 92,
};

/**
 * A path as a patch header prints it → the repository path. git C-quotes a
 * path holding a quote, backslash or control character (`"b/quo\"te.ts"`,
 * octal escapes for non-UTF-8 bytes even with `core.quotePath=false`), and
 * appends a TAB to an unquoted `---`/`+++` path that contains a space. Taken
 * verbatim, either form misses the name-status path and the file's added
 * lines silently become none. Returns null for `/dev/null`.
 */
export function parseDiffPath(raw: string, side: 'a' | 'b'): string | null {
  let value = raw;
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    const bytes: number[] = [];
    const body = value.slice(1, -1);
    for (let i = 0; i < body.length; i++) {
      const ch = body[i] as string;
      if (ch !== '\\') {
        bytes.push(...Buffer.from(ch, 'utf8'));
        continue;
      }
      const next = body[i + 1] ?? '';
      const octal = /^[0-7]{3}/.exec(body.slice(i + 1));
      if (octal) {
        bytes.push(parseInt(octal[0], 8));
        i += 3;
      } else {
        bytes.push(C_ESCAPES[next] ?? next.charCodeAt(0));
        i += 1;
      }
    }
    value = Buffer.from(bytes).toString('utf8');
  } else {
    value = value.replace(/\t$/, '');
  }
  if (value === '/dev/null') return null;
  const prefix = `${side}/`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

/**
 * `git diff --unified=0` output → added line numbers per new-side path, and
 * the paths git reports as binary. Hunk headers are `@@ -a[,b] +c[,d] @@`;
 * `d` omitted means 1 and `d == 0` adds nothing.
 */
export function parseUnifiedDiff(diff: string): {
  added: Map<string, number[]>;
  binary: Set<string>;
} {
  const added = new Map<string, number[]>();
  const binary = new Set<string>();
  let current: string | null = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      current = parseDiffPath(line.slice(4), 'b');
      if (current !== null && !added.has(current)) added.set(current, []);
      continue;
    }
    if (line.startsWith('Binary files ')) {
      const m = / and ("(?:[^"\\]|\\.)*"|.+) differ$/.exec(line);
      const target = m?.[1] ? parseDiffPath(m[1], 'b') : null;
      if (target !== null) binary.add(target);
      continue;
    }
    if (line.startsWith('@@') && current !== null) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!m) continue;
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      const lines = added.get(current) ?? [];
      for (let n = 0; n < count; n++) lines.push(start + n);
      added.set(current, lines);
    }
  }
  return { added, binary };
}

/** True when the first 8000 bytes contain a NUL, git's own binary test. */
export function looksBinary(content: Buffer): boolean {
  return content.subarray(0, 8000).includes(0);
}

/** Every line of an untracked file, 1..N (none for an empty or binary file). */
function allLines(absPath: string): { lines: number[]; binary: boolean } {
  let content: Buffer;
  try {
    content = fs.readFileSync(absPath);
  } catch {
    return { lines: [], binary: false };
  }
  if (looksBinary(content)) return { lines: [], binary: true };
  const text = content.toString('utf8');
  if (text.length === 0) return { lines: [], binary: false };
  const count = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  return {
    lines: Array.from({ length: count }, (_, i) => i + 1),
    binary: false,
  };
}

/** The change: base, merge base and every changed file inside the scope. */
export function computeChangeScope(options: ChangeScopeOptions): ChangeScope {
  const git = options.git ?? runGit;
  const root = path.resolve(
    gitOrThrow(git, ['rev-parse', '--show-toplevel'], options.cwd).trim(),
  );
  const ciTarget =
    options.ciTargetBranch !== undefined
      ? options.ciTargetBranch
      : detectCiEnvironment()?.pr_target_branch;
  const { ref, source } = resolveBaseRef(git, root, options.base, ciTarget);

  const mb = git(['merge-base', 'HEAD', ref], root);
  const mergeBase = mb.stdout.trim();
  if (mb.code !== 0 || !mergeBase) {
    throw new NoMergeBaseError(
      `no merge base between HEAD and ${ref} (from ${source === 'flag' ? '--base' : source === 'ci' ? 'the CI PR target branch' : 'origin/HEAD'})` +
        (mb.stderr.trim() ? `: ${mb.stderr.trim()}` : '') +
        '. Pass --base <ref>, or fetch the base branch first.',
    );
  }

  const specs = scopePathspecs(root, options.cwd, options.scope);
  const pathspec = specs.length > 0 ? ['--', ...specs] : [];

  const statuses = parseNameStatus(
    gitOrThrow(
      git,
      [
        'diff',
        '--name-status',
        '-z',
        '-M',
        '--no-ext-diff',
        mergeBase,
        ...pathspec,
      ],
      root,
    ),
  );
  const { added, binary } = parseUnifiedDiff(
    gitOrThrow(
      git,
      [
        'diff',
        '--unified=0',
        '--no-color',
        '--no-ext-diff',
        '-M',
        mergeBase,
        ...pathspec,
      ],
      root,
    ),
  );
  for (const file of parseNumstatBinary(
    gitOrThrow(
      git,
      [
        'diff',
        '--numstat',
        '-z',
        '-M',
        '--no-ext-diff',
        mergeBase,
        ...pathspec,
      ],
      root,
    ),
  )) {
    binary.add(file);
  }

  const files: ChangedFile[] = statuses.map((s) => ({
    ...s,
    addedLines: s.status === 'deleted' ? [] : (added.get(s.path) ?? []),
    binary: binary.has(s.path),
    untracked: false,
  }));

  const untracked = gitOrThrow(
    git,
    ['ls-files', '--others', '--exclude-standard', '-z', ...pathspec],
    root,
  )
    .split('\0')
    .filter((p) => p.length > 0);
  for (const file of untracked) {
    const { lines, binary: isBinary } = allLines(path.join(root, file));
    files.push({
      path: file,
      status: 'added',
      addedLines: lines,
      binary: isBinary,
      untracked: true,
    });
  }

  return { root, baseRef: ref, baseSource: source, mergeBase, files };
}

/**
 * A file's content at the merge base through `git show`, or null when it did
 * not exist there (an untracked or added file: every entry in it is new).
 */
export function readAtBase(
  scope: Pick<ChangeScope, 'root' | 'mergeBase'>,
  file: Pick<ChangedFile, 'path' | 'oldPath' | 'status' | 'untracked'>,
  git: GitRunner = runGit,
): string | null {
  if (file.untracked || file.status === 'added') return null;
  const atBase = file.oldPath ?? file.path;
  const r = git(['show', `${scope.mergeBase}:${atBase}`], scope.root);
  return r.code === 0 ? r.stdout : null;
}

/**
 * A minimal glob for exclusion lists, matched against a repo-relative path.
 * `**` crosses directories, `*` and `?` do not. A pattern with no `/` matches
 * the basename (`*.d.ts`, `build.rs`); a leading `**\/` also matches at the
 * root (`**\/src/gen/**` matches `src/gen/x.ts`).
 */
export function globToRegExp(glob: string): RegExp {
  const source = glob.includes('/') ? glob : `**/${glob}`;
  let re = '';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i] as string;
    if (ch === '*') {
      if (source[i + 1] === '*') {
        if (source[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(file: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(file));
}
