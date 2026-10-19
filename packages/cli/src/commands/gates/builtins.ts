/**
 * In-process inspect checks (internal). Pure Node, read-only, no shell.
 *
 * `contains` counts lines case-insensitively, like `grep -Eci`.
 * `not_contains` counts lines case-sensitively, like `grep -Ec`. A pattern is
 * POSIX ERE: bracket classes (`[[:space:]]`) are translated, and syntax whose
 * meaning differs in a JS `RegExp` is refused (exit 2) rather than silently
 * re-read. A directory is walked, the way `grep -r` walks it; a symlink met
 * while walking is skipped, the way `grep -r` skips it. A path that exists
 * as written is used literally, even when it has glob characters
 * (`app/[id]/page.tsx`). Otherwise a glob is expanded here: per-file counts
 * are summed, and a glob that matches no file fails, naming the glob, except
 * for `not_exists`, where no match is the pass. Every path, after following
 * symlinks, must stay inside the repo.
 * `done_criteria`, `json_has_key`, `spec_columns`,
 * and `migration_down_scope` follow the seeded node checks they replace.
 */
import * as fs from 'node:fs';
import path from 'node:path';

import { translatePosixEre } from '@levr/shared/runs/gate-op';

import { migrationRevertScopeCheck } from './migration-down-scope.js';

export type BuiltinCheck =
  | 'exists'
  | 'not_exists'
  | 'contains'
  | 'not_contains'
  | 'done_criteria'
  | 'json_has_key'
  | 'spec_columns'
  | 'migration_down_scope';

export interface BuiltinParams {
  path: string;
  glob?: boolean;
  pattern?: string;
  keywords?: string[];
  literal?: boolean;
  requirements?: Array<string | { pattern: string; label?: string }>;
  key?: string;
  object?: string;
  required_columns?: string | string[];
}

export interface BuiltinRequest {
  check: BuiltinCheck;
  params: BuiltinParams;
}

export interface InspectResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function finish(exitCode: number, stdout: string, stderr = ''): InspectResult {
  const out =
    stdout.length === 0 || stdout.endsWith('\n') ? stdout : `${stdout}\n`;
  const err =
    stderr.length === 0 || stderr.endsWith('\n') ? stderr : `${stderr}\n`;
  return { exitCode, stdout: out, stderr: err };
}

function isGlobPattern(value: string, glob: boolean | undefined): boolean {
  if (glob === false) return false;
  if (glob === true) return true;
  return /[*?[]/.test(value);
}

function escapesRepo(value: string): boolean {
  if (value.length === 0 || value.includes('\0')) return true;
  if (
    value.startsWith('/') ||
    value.startsWith('~') ||
    value.startsWith('\\\\') ||
    value.startsWith('//') ||
    /^[A-Za-z]:[\\/]/.test(value)
  ) {
    return true;
  }
  return value.split(/[\\/]/).includes('..');
}

function segmentToRegExp(segment: string, bracketsLiteral = false): RegExp {
  let body = '';
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i] ?? '';
    if (ch === '*') body += '[^/]*';
    else if (ch === '?') body += '[^/]';
    else if (ch === '[' && !bracketsLiteral) {
      const end = segment.indexOf(']', i + 1);
      if (end === -1) body += '\\[';
      else {
        body += segment.slice(i, end + 1);
        i = end;
      }
    } else {
      body += ch.replace(/[\\^$.|?*+(){}]/g, '\\$&');
    }
  }
  return new RegExp(`^${body}$`);
}

function listDir(abs: string): fs.Dirent[] {
  if (!fs.existsSync(abs)) return [];
  if (!fs.statSync(abs).isDirectory()) return [];
  return fs.readdirSync(abs, { withFileTypes: true });
}

/**
 * Expand a repo-relative glob. `**` crosses directories. Dotfiles match only a
 * leading dot. With `bracketsLiteral`, `[` and `]` are name characters and only
 * `*` / `?` are patterns: the names-first reading (TR-918 #5).
 */
function expandGlob(
  root: string,
  pattern: string,
  bracketsLiteral = false,
): string[] {
  const wild = bracketsLiteral ? /[*?]/ : /[*?[]/;
  const segments = pattern
    .split(/[\\/]/)
    .filter((segment) => segment.length > 0);
  const walk = (dirRel: string, index: number): string[] => {
    if (index >= segments.length) return dirRel.length > 0 ? [dirRel] : [];
    const segment = segments[index] ?? '';
    const dirAbs = dirRel.length === 0 ? root : path.join(root, dirRel);
    if (segment === '**') {
      const here = walk(dirRel, index + 1);
      const nested: string[] = [];
      for (const entry of listDir(dirAbs)) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const child =
          dirRel.length === 0 ? entry.name : path.join(dirRel, entry.name);
        nested.push(...walk(child, index));
      }
      return here.concat(nested);
    }
    if (!wild.test(segment)) {
      const rel = dirRel.length === 0 ? segment : path.join(dirRel, segment);
      const abs = path.join(root, rel);
      if (!fs.existsSync(abs)) return [];
      if (index === segments.length - 1) return [rel];
      return fs.statSync(abs).isDirectory() ? walk(rel, index + 1) : [];
    }
    const re = segmentToRegExp(segment, bracketsLiteral);
    const hits: string[] = [];
    for (const entry of listDir(dirAbs)) {
      if (entry.name.startsWith('.') && !segment.startsWith('.')) continue;
      if (!re.test(entry.name)) continue;
      const rel =
        dirRel.length === 0 ? entry.name : path.join(dirRel, entry.name);
      if (index === segments.length - 1) hits.push(rel);
      else if (entry.isDirectory()) hits.push(...walk(rel, index + 1));
    }
    return hits;
  };
  return walk('', 0);
}

function realRoot(root: string): string {
  try {
    return fs.realpathSync(root);
  } catch {
    return path.resolve(root);
  }
}

/**
 * True when `rel`, with every symlink in it followed, stays inside `root`.
 * A path that does not exist reads nothing, so it is inside.
 */
function staysInRepo(root: string, rel: string): boolean {
  const abs = path.join(root, rel);
  let real: string;
  try {
    real = fs.realpathSync(abs);
  } catch {
    return !fs.existsSync(abs) && !isDanglingLink(abs);
  }
  const base = realRoot(root);
  return real === base || real.startsWith(base + path.sep);
}

function isDanglingLink(abs: string): boolean {
  try {
    return fs.lstatSync(abs).isSymbolicLink();
  } catch {
    return false;
  }
}

function resolveFiles(
  root: string,
  check: BuiltinCheck,
  params: BuiltinParams,
): { files: string[]; failure: InspectResult | null } {
  if (escapesRepo(params.path)) {
    return {
      files: [],
      failure: finish(1, `path escapes the repo: ${params.path}`),
    };
  }
  // LITERAL first: a path that exists as written is that path, even when it
  // contains `[`, `*` or `?` (a Next.js `app/[id]/page.tsx`). Only an
  // explicit `glob: true` expands a path that also exists literally.
  const literalExists =
    params.glob !== true &&
    (fs.existsSync(path.join(root, params.path)) ||
      isDanglingLink(path.join(root, params.path)));
  let files: string[];
  if (literalExists || !isGlobPattern(params.path, params.glob)) {
    files = [params.path];
  } else {
    // Names first (TR-918 #5): unless `glob: true`, a `[...]` is first read
    // as part of a NAME — `routes/[id]/*.bak` is the `[id]` directory, with
    // only the `*` a pattern — and becomes a character class only when that
    // reading matches nothing.
    files =
      params.glob !== true && params.path.includes('[')
        ? expandGlob(root, params.path, true)
        : [];
    if (files.length === 0) files = expandGlob(root, params.path);
    if (files.length === 0) {
      // Nothing matched: for `not_exists` that IS the pass, the way the
      // nullglob bash it replaced passed.
      if (check === 'not_exists') return { files, failure: null };
      return {
        files: [],
        failure: finish(1, `no file matches: ${params.path}`),
      };
    }
  }
  for (const file of files) {
    if (!staysInRepo(root, file)) {
      return {
        files: [],
        failure: finish(1, `path escapes the repo: ${file}`),
      };
    }
  }
  return { files, failure: null };
}

function readText(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export { translatePosixEre };

function compilePattern(source: string, flags: string): RegExp | InspectResult {
  const translated = translatePosixEre(source);
  if (typeof translated !== 'string') {
    return finish(2, `ERROR: unsupported pattern: ${translated.error}`);
  }
  try {
    return new RegExp(translated, flags);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return finish(1, `ERROR: invalid pattern: ${message}`);
  }
}

function matcherFor(
  params: BuiltinParams,
  insensitive: boolean,
): RegExp | InspectResult {
  const keywords = params.keywords ?? [];
  const flags = insensitive ? 'i' : '';
  if (keywords.length > 0) {
    return new RegExp(keywords.map(escapeRegExp).join('|'), flags);
  }
  if (params.pattern != null && params.pattern.length > 0) {
    if (params.literal) return new RegExp(escapeRegExp(params.pattern), flags);
    return compilePattern(params.pattern, flags);
  }
  return finish(1, 'ERROR: pattern or keywords is required');
}

function countLines(text: string, re: RegExp): number {
  let count = 0;
  for (const line of text.split('\n')) {
    if (re.test(line)) count += 1;
  }
  return count;
}

const MAX_WALK_FILES = 100_000;

/**
 * Files under `rel`, which may itself be a file. A directory is walked.
 * `rel` itself has already been checked to stay inside the repo after its
 * symlinks are followed (`resolveFiles`), so it is followed. A symlink met
 * while walking is skipped, the way `grep -r` skips it: following it could
 * leave the repo, and `node_modules/.bin` is full of them.
 */
function collectFiles(
  root: string,
  rel: string,
  acc: string[],
  top = true,
): InspectResult | null {
  if (acc.length > MAX_WALK_FILES) {
    return finish(1, `path is too large to search: ${rel}`);
  }
  const abs = path.join(root, rel);
  let stat: fs.Stats;
  try {
    stat = top ? fs.statSync(abs) : fs.lstatSync(abs);
  } catch {
    return finish(1, `no file matches: ${rel}`);
  }
  if (stat.isSymbolicLink()) return null;
  if (stat.isDirectory()) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return finish(1, `no file matches: ${rel}`);
    }
    for (const entry of entries) {
      const child = rel.length === 0 ? entry.name : path.join(rel, entry.name);
      const nested = collectFiles(root, child, acc, false);
      if (nested) return nested;
    }
    return null;
  }
  if (stat.isFile()) {
    acc.push(rel);
    return null;
  }
  return null;
}

function countAcross(
  root: string,
  files: string[],
  re: RegExp,
): number | InspectResult {
  const expanded: string[] = [];
  for (const file of files) {
    const walked = collectFiles(root, file, expanded);
    if (walked) return walked;
  }
  let total = 0;
  for (const file of expanded) {
    total += countLines(readText(root, file), re);
  }
  return total;
}

function doneCriteria(
  root: string,
  files: string[],
  requirements: NonNullable<BuiltinParams['requirements']>,
): InspectResult {
  let corpus = '';
  for (const file of files) {
    const abs = path.join(root, file);
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      return finish(1, `no file matches: ${file}`);
    }
    corpus += readText(root, file);
    corpus += '\n';
  }
  const lower = corpus.toLowerCase();
  const missing: string[] = [];
  for (const requirement of requirements) {
    if (typeof requirement === 'string') {
      if (!lower.includes(requirement.toLowerCase())) missing.push(requirement);
      continue;
    }
    if (!requirement || typeof requirement.pattern !== 'string') {
      return finish(
        2,
        `ERROR: requirement must be a string or an object with a string pattern: ${JSON.stringify(requirement)}`,
      );
    }
    const re = compilePattern(requirement.pattern, 'i');
    if (!(re instanceof RegExp)) return re;
    if (!re.test(corpus))
      missing.push(requirement.label || requirement.pattern);
  }
  if (missing.length > 0) return finish(1, `MISSING: ${missing.join(', ')}`);
  return finish(0, 'all met');
}

function jsonHasKey(
  root: string,
  file: string,
  key: string,
  object?: string,
): InspectResult {
  const abs = path.join(root, file);
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    return finish(1, `no file matches: ${file}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readText(root, file)) as unknown;
  } catch {
    return finish(1, `ERROR: invalid JSON in ${file}`);
  }
  const record =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  const parent = object === undefined ? record : record?.[object];
  const table =
    parent && typeof parent === 'object' && !Array.isArray(parent)
      ? (parent as Record<string, unknown>)
      : null;
  if (!table || !Object.prototype.hasOwnProperty.call(table, key)) {
    const where = object === undefined ? 'the document' : object;
    return finish(1, `MISSING: ${key} is not a key of ${where} in ${file}`);
  }
  return finish(0, 'PASS');
}

function specColumns(
  root: string,
  file: string,
  required: string | string[],
): InspectResult {
  const abs = path.join(root, file);
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    return finish(1, `no file matches: ${file}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readText(root, file)) as unknown;
  } catch {
    return finish(1, `ERROR: invalid JSON in ${file}`);
  }
  const fields = (parsed as { fields?: unknown } | null)?.fields;
  if (!Array.isArray(fields)) {
    return finish(
      1,
      `SPEC_SHAPE_ERROR: expected fields[] array, got ${fields === null ? 'null' : typeof fields}`,
    );
  }
  const cols = fields
    .map((field) =>
      field && typeof field === 'object' && 'name' in field
        ? (field as { name?: unknown }).name
        : undefined,
    )
    .filter(
      (name): name is string => typeof name === 'string' && name.length > 0,
    );
  const req = (Array.isArray(required) ? required : required.split(',')).map(
    (col) => col.trim(),
  );
  const missing = req.filter((col) => !cols.includes(col));
  if (missing.length > 0) return finish(1, `MISSING: ${missing.join(',')}`);
  return finish(0, 'all present');
}

const SINGLE_FILE_CHECKS: ReadonlySet<BuiltinCheck> = new Set<BuiltinCheck>([
  'done_criteria',
  'json_has_key',
  'spec_columns',
]);

function isRegularFile(root: string, rel: string): boolean {
  try {
    return fs.statSync(path.join(root, rel)).isFile();
  } catch {
    return false;
  }
}

/** Run one inspect check. `root` is the repository root; paths are relative to it. */
export function runBuiltin(
  request: BuiltinRequest,
  root = process.cwd(),
): InspectResult {
  const { files, failure } = resolveFiles(root, request.check, request.params);
  if (failure) return failure;

  // These read ONE file. A glob matching several is red with every name
  // shown, never a silent check of the first (internal L3a).
  if (SINGLE_FILE_CHECKS.has(request.check) && files.length > 1) {
    return finish(
      1,
      `${request.params.path} does not resolve to exactly one file: ${files.join(', ')}`,
    );
  }

  if (request.check === 'exists' || request.check === 'not_exists') {
    if (request.check === 'exists') {
      // A FILE, like the `test -f` it replaced: a directory, or a symlink to
      // one, is not a file (final review F-021, round 2 F-E). Symlinks are
      // followed, so a link to a file counts and a dangling one does not.
      const regular = files.filter((file) => isRegularFile(root, file));
      if (regular.length > 0) {
        return finish(0, `exists: ${regular.join(', ')}`);
      }
      return finish(1, `MISSING: ${files[0] ?? request.params.path}`);
    }
    const present = files.filter((file) =>
      fs.existsSync(path.join(root, file)),
    );
    if (present.length === 0)
      return finish(0, `absent: ${request.params.path}`);
    return finish(1, `exists: ${present.join(', ')}`);
  }

  if (request.check === 'contains' || request.check === 'not_contains') {
    const matcher = matcherFor(request.params, request.check === 'contains');
    if (!(matcher instanceof RegExp)) return matcher;
    const counted = countAcross(root, files, matcher);
    if (typeof counted !== 'number') return counted;
    const pass = request.check === 'contains' ? counted > 0 : counted === 0;
    return finish(pass ? 0 : 1, String(counted));
  }

  if (request.check === 'done_criteria') {
    const requirements = request.params.requirements;
    // A string is truthy and has a length, and `for...of` would then walk
    // characters. That is a pass over a document that contains those letters.
    if (!Array.isArray(requirements) || requirements.length === 0) {
      return finish(2, 'ERROR: requirements must be a non-empty array');
    }
    return doneCriteria(root, files, requirements);
  }

  if (request.check === 'json_has_key') {
    const key = request.params.key;
    if (!key) return finish(1, 'ERROR: key is required');
    for (const file of files) {
      const one = jsonHasKey(root, file, key, request.params.object);
      if (one.exitCode !== 0) return one;
    }
    return finish(0, 'PASS');
  }

  if (request.check === 'spec_columns') {
    const required = request.params.required_columns;
    if (
      required == null ||
      (Array.isArray(required) && required.length === 0)
    ) {
      return finish(1, 'ERROR: required_columns is required');
    }
    for (const file of files) {
      const one = specColumns(root, file, required);
      if (one.exitCode !== 0) return one;
    }
    return finish(0, 'all present');
  }

  const lines: string[] = [];
  const code = migrationRevertScopeCheck(
    fs,
    files.map((file) => path.resolve(root, file)),
    (line) => lines.push(line),
  );
  return finish(code, lines.join('\n'));
}
