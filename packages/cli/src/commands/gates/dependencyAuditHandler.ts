import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { LocalContext } from '../../context.js';
import {
  computeChangeScope,
  GitError,
  NoMergeBaseError,
  readAtBase,
  runGit,
  type ChangeScopeOptions,
  type GitRunner,
} from './change-scope.js';

/**
 * `levr gates dependency-audit` (internal D4.3): vulnerabilities and
 * disallowed licenses in only the packages the change ADDED or UPGRADED. The
 * `dependency_audit` gate runs it; whole-repo scanning stays in CI.
 *
 * Each lockfile in scope is read at the merge base (`git show`) and in the
 * working tree; the (name, version) pairs new in the working tree are the
 * change's packages. trivy scans the checkout against its LOCAL database
 * only, and its findings are kept when they name one of those packages. A
 * vulnerable dependency the change did not touch stays green.
 *
 * Exit 0 no findings; 1 findings (package@version, CVE or license); 2 for a
 * usage error, no merge base, trivy missing, a trivy failure (an empty or
 * missing database included), or a crash. Never a pass on a failure.
 */

export const LOCKFILES = [
  'yarn.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'Cargo.lock',
] as const;

export const SEVERITIES = [
  'UNKNOWN',
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
] as const;
export type Severity = (typeof SEVERITIES)[number];

/** trivy's argv. Reads its existing database and never writes a file. */
export const TRIVY_ARGS: readonly string[] = [
  'fs',
  '--scanners',
  'vuln,license',
  '--skip-db-update',
  '--offline-scan',
  '--format',
  'json',
  '--quiet',
  '.',
];

export type TrivyRunner = (
  args: readonly string[],
  cwd: string,
) => { code: number; stdout: string; stderr: string; missing: boolean };

export const runTrivy: TrivyRunner = (args, cwd) => {
  const r = spawnSync('trivy', [...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  const missing =
    (r.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
  return {
    code: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? (r.error ? r.error.message : ''),
    missing,
  };
};

export interface DependencyAuditFlags {
  base: string;
  scope?: readonly string[];
  severity: string;
  'allow-licenses'?: string;
}

export interface AuditOutcome {
  exitCode: 0 | 1 | 2;
  stdout: string;
  stderr: string;
}

/** name → versions present. */
export type PackageSet = Map<string, Set<string>>;

function add(set: PackageSet, name: string, version: string): void {
  if (!name || !version) return;
  const versions = set.get(name) ?? new Set<string>();
  versions.add(version);
  set.set(name, versions);
}

/** The package name of a yarn descriptor: `@scope/pkg@npm:^1` → `@scope/pkg`. */
function descriptorName(descriptor: string): string {
  const d = descriptor.trim().replace(/^"|"$/g, '');
  const at = d.indexOf('@', 1);
  return at === -1 ? d : d.slice(0, at);
}

/** yarn.lock, classic (`version "1.2.3"`) and berry (`version: 1.2.3`). */
export function parseYarnLock(text: string): PackageSet {
  const set: PackageSet = new Map();
  let name: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    if (!line.startsWith(' ') && line.endsWith(':')) {
      const first = line.slice(0, -1).split(',')[0] ?? '';
      name = first.trim() === '__metadata' ? null : descriptorName(first);
      continue;
    }
    const m = /^\s+version:?\s+"?([^"\s]+)"?\s*$/.exec(line);
    if (m?.[1] && name) {
      add(set, name, m[1]);
      name = null;
    }
  }
  return set;
}

/** package-lock.json v2/v3 (`packages`) with a v1 (`dependencies`) fallback. */
export function parsePackageLock(text: string): PackageSet {
  const set: PackageSet = new Map();
  const json = JSON.parse(text) as {
    packages?: Record<
      string,
      { version?: string; name?: string; link?: boolean }
    >;
    dependencies?: Record<string, { version?: string; dependencies?: unknown }>;
  };
  if (json.packages) {
    for (const [key, entry] of Object.entries(json.packages)) {
      if (!key || entry.link || !entry.version) continue;
      const idx = key.lastIndexOf('node_modules/');
      const name =
        idx === -1
          ? (entry.name ?? key)
          : key.slice(idx + 'node_modules/'.length);
      add(set, name, entry.version);
    }
    return set;
  }
  const walk = (
    deps:
      | Record<string, { version?: string; dependencies?: unknown }>
      | undefined,
  ) => {
    for (const [name, entry] of Object.entries(deps ?? {})) {
      if (entry.version) add(set, name, entry.version);
      walk(entry.dependencies as typeof deps);
    }
  };
  walk(json.dependencies);
  return set;
}

/** pnpm-lock.yaml `packages:` keys: `/name@1.2.3:`, `name@1.2.3(peer):`, `/name/1.2.3:`. */
export function parsePnpmLock(text: string): PackageSet {
  const set: PackageSet = new Map();
  let inPackages = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inPackages = line.startsWith('packages:');
      continue;
    }
    if (!inPackages) continue;
    const m = /^ {2}['"]?\/?([^'"\s]+?)['"]?:\s*$/.exec(line);
    if (!m?.[1]) continue;
    const key = m[1].replace(/\(.*$/, '');
    const at = key.lastIndexOf('@');
    if (at > 0) {
      add(set, key.slice(0, at), key.slice(at + 1));
    } else {
      const slash = key.lastIndexOf('/');
      if (slash > 0) add(set, key.slice(0, slash), key.slice(slash + 1));
    }
  }
  return set;
}

/** Cargo.lock `[[package]]` tables. */
export function parseCargoLock(text: string): PackageSet {
  const set: PackageSet = new Map();
  for (const block of text.split('[[package]]').slice(1)) {
    const name = /^name\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const version = /^version\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    if (name && version) add(set, name, version);
  }
  return set;
}

export function parseLockfile(file: string, text: string): PackageSet {
  const base = path.basename(file);
  if (base === 'yarn.lock') return parseYarnLock(text);
  if (base === 'package-lock.json') return parsePackageLock(text);
  if (base === 'pnpm-lock.yaml') return parsePnpmLock(text);
  if (base === 'Cargo.lock') return parseCargoLock(text);
  return new Map();
}

/** (name, version) pairs in `after` that `before` lacks: added or upgraded. */
export function diffPackages(
  before: PackageSet,
  after: PackageSet,
): PackageSet {
  const changed: PackageSet = new Map();
  for (const [name, versions] of after) {
    const old = before.get(name);
    for (const v of versions) if (!old?.has(v)) add(changed, name, v);
  }
  return changed;
}

interface TrivyReport {
  Results?: Array<{
    Target?: string;
    Vulnerabilities?: Array<{
      PkgName?: string;
      InstalledVersion?: string;
      VulnerabilityID?: string;
      Severity?: string;
    }>;
    Licenses?: Array<{ PkgName?: string; Name?: string; Severity?: string }>;
  }>;
}

export interface Finding {
  kind: 'vulnerability' | 'license';
  pkg: string;
  version?: string;
  id: string;
  severity?: string;
}

/** Findings that name a changed package, at or above the severity floor. */
export function filterFindings(
  report: TrivyReport,
  changed: PackageSet,
  minSeverity: Severity,
  allowedLicenses: ReadonlySet<string> | null,
): Finding[] {
  const floor = SEVERITIES.indexOf(minSeverity);
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const push = (f: Finding) => {
    const key = `${f.kind}|${f.pkg}|${f.version ?? ''}|${f.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(f);
  };
  for (const result of report.Results ?? []) {
    for (const v of result.Vulnerabilities ?? []) {
      const name = v.PkgName ?? '';
      const version = v.InstalledVersion ?? '';
      if (!changed.get(name)?.has(version)) continue;
      const sev = (v.Severity ?? 'UNKNOWN').toUpperCase() as Severity;
      const rank = SEVERITIES.indexOf(sev);
      if ((rank === -1 ? 0 : rank) < floor) continue;
      push({
        kind: 'vulnerability',
        pkg: name,
        version,
        id: v.VulnerabilityID ?? '?',
        severity: sev,
      });
    }
    if (!allowedLicenses) continue;
    for (const l of result.Licenses ?? []) {
      const name = l.PkgName ?? '';
      const license = l.Name ?? '';
      if (!changed.has(name) || !license) continue;
      if (allowedLicenses.has(license.toUpperCase())) continue;
      push({ kind: 'license', pkg: name, id: license, severity: l.Severity });
    }
  }
  return findings;
}

function fail2(message: string): AuditOutcome {
  return {
    exitCode: 2,
    stdout: '',
    stderr: `gates dependency-audit: ${message}\n`,
  };
}

function formatFinding(f: Finding): string {
  return f.kind === 'vulnerability'
    ? `  ${f.pkg}@${f.version} ${f.id} (${f.severity})`
    : `  ${f.pkg} license ${f.id} is not in --allow-licenses`;
}

/** The command body; `execute…` below maps any throw to exit 2. */
function runDependencyAudit(
  flags: DependencyAuditFlags,
  cwd: string = process.cwd(),
  deps: {
    scopeOptions?: Partial<ChangeScopeOptions>;
    trivy?: TrivyRunner;
    git?: GitRunner;
  } = {},
): AuditOutcome {
  const severity = flags.severity.trim().toUpperCase() as Severity;
  if (!SEVERITIES.includes(severity)) {
    return fail2(
      `--severity "${flags.severity}" must be one of: ${SEVERITIES.join(', ')}`,
    );
  }
  const allowed = flags['allow-licenses']?.trim()
    ? new Set(
        flags['allow-licenses']
          .split(',')
          .map((l) => l.trim().toUpperCase())
          .filter(Boolean),
      )
    : null;
  const git = deps.git ?? deps.scopeOptions?.git ?? runGit;

  try {
    const scope = computeChangeScope({
      cwd,
      base: flags.base,
      scope: flags.scope,
      git,
      ...deps.scopeOptions,
    });
    const lockfiles = scope.files.filter(
      (f) =>
        f.status !== 'deleted' &&
        (LOCKFILES as readonly string[]).includes(path.basename(f.path)),
    );
    const changed: PackageSet = new Map();
    for (const file of lockfiles) {
      const atBase = readAtBase(scope, file, git);
      const current = fs.readFileSync(path.join(scope.root, file.path), 'utf8');
      const delta = diffPackages(
        atBase === null
          ? new Map<string, Set<string>>()
          : parseLockfile(file.path, atBase),
        parseLockfile(file.path, current),
      );
      for (const [name, versions] of delta) {
        for (const v of versions) add(changed, name, v);
      }
    }
    const where = `against ${scope.baseRef} (merge base ${scope.mergeBase.slice(0, 12)})`;
    const count = [...changed.values()].reduce((n, s) => n + s.size, 0);
    if (count === 0) {
      return {
        exitCode: 0,
        stdout: `PASS no added or upgraded packages in ${lockfiles.length} changed lockfile(s) ${where}\n`,
        stderr: '',
      };
    }

    const trivy = (deps.trivy ?? runTrivy)(TRIVY_ARGS, scope.root);
    if (trivy.missing) {
      return fail2(
        'trivy is not installed (https://trivy.dev); see `levr gates dependency-audit --help`',
      );
    }
    if (trivy.code !== 0) {
      return fail2(
        `trivy exited ${trivy.code}; an empty or missing vulnerability database ` +
          `is an error here, never a pass (warm the cache first, see --help): ` +
          trivy.stderr.trim().split('\n').slice(-5).join(' | '),
      );
    }
    let report: TrivyReport;
    try {
      report = JSON.parse(trivy.stdout) as TrivyReport;
    } catch {
      return fail2('trivy printed no JSON report');
    }

    const findings = filterFindings(report, changed, severity, allowed);
    const summary = `${count} added or upgraded package version(s) ${where}`;
    if (findings.length === 0) {
      return {
        exitCode: 0,
        stdout: `PASS no ${severity}+ findings${allowed ? ' or disallowed licenses' : ''} in ${summary}\n`,
        stderr: '',
      };
    }
    return {
      exitCode: 1,
      stdout:
        `FAIL ${findings.length} finding(s) in ${summary}:\n` +
        findings.map(formatFinding).join('\n') +
        '\n',
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
export function executeDependencyAudit(
  flags: DependencyAuditFlags,
  cwd?: string,
  deps: {
    scopeOptions?: Partial<ChangeScopeOptions>;
    trivy?: TrivyRunner;
    git?: GitRunner;
  } = {},
): AuditOutcome {
  try {
    return runDependencyAudit(flags, cwd ?? process.cwd(), deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail2(`crashed: ${message}`);
  }
}

export function gatesDependencyAuditHandler(
  this: LocalContext,
  flags: DependencyAuditFlags,
): void {
  const result = executeDependencyAudit(flags);
  if (result.stdout.length > 0) this.process.stdout.write(result.stdout);
  if (result.stderr.length > 0) this.process.stderr.write(result.stderr);
  this.process.exitCode = result.exitCode;
}
