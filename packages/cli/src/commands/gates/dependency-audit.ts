import { buildCommand } from '@stricli/core';

export const gatesDependencyAuditCommand = buildCommand({
  docs: {
    brief: 'Audit only the dependencies the change added or upgraded',
    fullDescription: `Find the packages this change added or upgraded, by diffing each changed
lockfile (yarn.lock, package-lock.json, pnpm-lock.yaml, Cargo.lock) at the
merge base against the working tree, then run trivy and keep the findings that
name one of those packages. This is the command a dependency_audit gate runs.
A vulnerable dependency the change did not touch does not fail it.

The base is, first match wins: --base (empty or 'auto' counts as not given);
the CI provider's PR target branch (e.g. GITHUB_BASE_REF); origin/HEAD.

trivy runs offline against the database it already has
(trivy fs --scanners vuln,license --skip-db-update --offline-scan --format json)
and never downloads one. Warm its cache outside the gate, for example in a
scheduled CI job or once on a dev machine:
  trivy fs --download-db-only

Exit code 0 when no added or upgraded package has a finding at or above
--severity (default HIGH) or, with --allow-licenses, a license outside the
list; 1 when one does, naming package@version and the CVE or license; 2 for a
usage error, no merge base, trivy missing, an empty or missing database, or a
crash.

Examples:
  levr gates dependency-audit
  levr gates dependency-audit --base origin/main --severity CRITICAL
  levr gates dependency-audit --allow-licenses MIT,Apache-2.0,BSD-3-Clause,ISC`,
  },
  parameters: {
    flags: {
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
        brief: 'Only count lockfiles under this path (repeatable)',
        placeholder: 'path',
        variadic: true,
        optional: true,
      },
      severity: {
        kind: 'parsed',
        parse: String,
        brief:
          'Lowest severity that fails: UNKNOWN, LOW, MEDIUM, HIGH, CRITICAL',
        placeholder: 'level',
        default: 'HIGH',
      },
      'allow-licenses': {
        kind: 'parsed',
        parse: String,
        brief:
          'Comma-separated SPDX licenses allowed; omit to skip the license check',
        placeholder: 'list',
        optional: true,
      },
    },
  },
  loader: async () => {
    const { gatesDependencyAuditHandler } = await import(
      './dependencyAuditHandler.js'
    );
    return gatesDependencyAuditHandler;
  },
});
