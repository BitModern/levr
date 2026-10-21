import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  buildEngineRequest,
  engines,
  findProjectRoot,
  isRefsLanguage,
  REFS_LANGUAGES,
  ScopeTooBroadError,
  SymbolTooCommonError,
  ToolchainError,
  type ReferenceLocation,
  type SymbolResolution,
} from '@levr/code-intel';

import type { LocalContext } from '../../context.js';

/**
 * `levr gates refs` (internal D5): is a symbol declared in a scope AND
 * referenced from another module? The `symbol_referenced` gate runs it.
 *
 * Exit 0 when the symbol is declared in scope and referenced from outside
 * its declaring file, 1 when it is not referenced or not found, 2 for a
 * usage, scope or toolchain error. Any other failure is also 2: a crash must
 * never read as "not referenced".
 */
export interface RefsFlags {
  lang: string;
  symbol: string;
  scope: string;
  'include-tests': boolean;
}

export interface RefsOutcome {
  exitCode: 0 | 1 | 2;
  stdout: string;
  stderr: string;
}

/** Locations printed after the verdict. */
const MAX_LOCATIONS = 20;

function usage(message: string): RefsOutcome {
  return { exitCode: 2, stdout: '', stderr: `gates refs: ${message}\n` };
}

/** A relative path that leaves its base (`..` or `../x`, not `..cache`). */
function escapes(rel: string): boolean {
  return (
    rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)
  );
}

/**
 * The scope, repository-relative, or a reason it is refused. It must exist
 * and resolve INSIDE the repository, never to the root itself: the root is
 * the whole repository, which no engine loads (the resolver's internal
 * rule). Symlinks are resolved first, so a link cannot point the search
 * outside.
 */
export function resolveScope(
  projectRoot: string,
  scope: string,
): { scope: string } | { error: string } {
  const trimmed = scope.trim();
  if (!trimmed) return { error: '--scope is required' };
  const root = fs.realpathSync(projectRoot);
  const target = path.resolve(root, trimmed);
  let real: string;
  try {
    real = fs.realpathSync(target);
  } catch {
    const rel = path.relative(root, target);
    if (escapes(rel)) {
      return {
        error: `--scope "${scope}" resolves outside the repository (${root})`,
      };
    }
    return { error: `--scope "${scope}" does not exist` };
  }
  const rel = path.relative(root, real);
  if (escapes(rel)) {
    return {
      error: `--scope "${scope}" resolves outside the repository (${root})`,
    };
  }
  if (rel === '') {
    return {
      error:
        `--scope "${scope}" is the repository root; name a directory ` +
        'narrower than the root (e.g. apps/backender/src)',
    };
  }
  return { scope: rel };
}

function formatLocation(loc: ReferenceLocation): string {
  return `  ${loc.kind.padEnd(11)} ${loc.file}:${loc.line}:${loc.col}`;
}

/** One-line verdict plus up to MAX_LOCATIONS locations. */
export function formatRefs(
  resolution: SymbolResolution,
  language: string,
  scope: string,
): string {
  const { symbol, result } = resolution;
  const where = `[${language}, scope ${scope}]`;
  if (!result.found) {
    return `FAIL ${symbol}: not found in ${result.filesScanned} file(s) ${where}\n`;
  }
  const tests = result.excludedTestReferences
    ? `; ${result.excludedTestReferences} in test code not counted (--include-tests counts them)`
    : '';
  const head =
    result.referenceCount > 0
      ? `PASS ${symbol}: declared in ${result.declarationFiles.join(', ')}; ` +
        `${result.referenceCount} reference(s) from ${result.referencingFiles.length} other module(s)${tests} ${where}`
      : `FAIL ${symbol}: declared in ${result.declarationFiles.join(', ')} ` +
        `but not referenced from any other module${tests} ${where}`;
  const lines = [head];
  // Declarations, then the references that count, then discounted test
  // references, so the cap never hides the evidence for the verdict.
  const rank = { declaration: 0, reference: 1, test: 2 } as const;
  const ordered = [...resolution.locations].sort(
    (a, b) => rank[a.kind] - rank[b.kind],
  );
  const shown = ordered.slice(0, MAX_LOCATIONS);
  lines.push(...shown.map(formatLocation));
  const more = ordered.length - shown.length;
  if (more > 0) lines.push(`  … ${more} more`);
  return lines.join('\n') + '\n';
}

/** The whole command minus process I/O, so tests can drive it. */
export async function executeRefs(
  flags: RefsFlags,
  cwd: string = process.cwd(),
): Promise<RefsOutcome> {
  if (!isRefsLanguage(flags.lang)) {
    return usage(
      `--lang "${flags.lang}" is not a language this CLI resolves; ` +
        `expected one of: ${REFS_LANGUAGES.join(', ')}`,
    );
  }
  const symbol = flags.symbol.trim();
  if (!symbol) return usage('--symbol is required');

  const projectRoot = findProjectRoot(cwd);
  const scoped = resolveScope(projectRoot, flags.scope);
  if ('error' in scoped) return usage(scoped.error);

  try {
    const request = buildEngineRequest({
      language: flags.lang,
      symbols: [symbol],
      projectRoot,
      scopes: [scoped.scope],
      includeTests: flags['include-tests'],
    });
    const [resolution] = await engines[flags.lang].resolve(request);
    if (!resolution) return usage(`no answer for "${symbol}"`);
    const passed =
      resolution.result.found && resolution.result.referenceCount > 0;
    return {
      exitCode: passed ? 0 : 1,
      stdout: formatRefs(resolution, flags.lang, scoped.scope),
      stderr: '',
    };
  } catch (error) {
    if (
      error instanceof ToolchainError ||
      error instanceof ScopeTooBroadError ||
      error instanceof SymbolTooCommonError
    ) {
      return usage(error.message);
    }
    const message = error instanceof Error ? error.message : String(error);
    return usage(`resolution failed for "${symbol}": ${message}`);
  }
}

export async function gatesRefsHandler(
  this: LocalContext,
  flags: RefsFlags,
): Promise<void> {
  const result = await executeRefs(flags);
  if (result.stdout.length > 0) this.process.stdout.write(result.stdout);
  if (result.stderr.length > 0) this.process.stderr.write(result.stderr);
  this.process.exitCode = result.exitCode;
}
