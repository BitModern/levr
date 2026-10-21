import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { assertRustAnalyzer, type SymbolResolution } from '@levr/code-intel';

import { executeRefs, formatRefs, resolveScope } from './refsHandler.js';

/**
 * internal D5 — `levr gates refs`. Runs against this repository and the two
 * fixtures in packages/code-intel/test-fixtures (a TS project and a Cargo
 * crate), so the verdicts come from the real engines.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../../..');
const TS_FIXTURE = 'packages/code-intel/test-fixtures/ts-refs';
const RUST_FIXTURE = 'packages/code-intel/test-fixtures/rust-refs';

const flags = (
  over: Partial<Parameters<typeof executeRefs>[0]>,
): Parameters<typeof executeRefs>[0] => ({
  lang: 'ts',
  symbol: 'usedHelper',
  scope: TS_FIXTURE,
  'include-tests': false,
  ...over,
});

/** The engine's own probe: true when rust-analyzer runs on this machine. */
const hasRustAnalyzer = (() => {
  try {
    assertRustAnalyzer();
    return true;
  } catch {
    return false;
  }
})();

const savedPath = process.env['PATH'];
let emptyBin = '';
afterEach(() => {
  process.env['PATH'] = savedPath;
  if (emptyBin) rmSync(emptyBin, { recursive: true, force: true });
  emptyBin = '';
});

describe('gates refs — usage and scope (exit 2)', () => {
  it('T2 refuses the repository root as a scope', async () => {
    const out = await executeRefs(flags({ scope: '.' }), repoRoot);
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain('repository root');
  });

  it('T2 refuses a scope outside the repository', async () => {
    for (const scope of ['../x', '/etc', `${TS_FIXTURE}/../../../../..`]) {
      const out = await executeRefs(flags({ scope }), repoRoot);
      expect(out.exitCode, scope).toBe(2);
      expect(out.stderr, scope).toMatch(
        /outside the repository|repository root/,
      );
    }
  });

  it('refuses a scope that does not exist', async () => {
    const out = await executeRefs(flags({ scope: 'no/such/dir' }), repoRoot);
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain('does not exist');
  });

  it('refuses a language outside the engine registry', async () => {
    const out = await executeRefs(flags({ lang: 'go' }), repoRoot);
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain('expected one of: ts, rust');
  });

  it('T3 names the rustup command when rust-analyzer is missing', async () => {
    emptyBin = mkdtempSync(join(tmpdir(), 'gates-refs-path-'));
    process.env['PATH'] = emptyBin;
    const out = await executeRefs(
      flags({ lang: 'rust', symbol: 'used_helper', scope: RUST_FIXTURE }),
      repoRoot,
    );
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain('rustup component add rust-analyzer');
  });

  it('resolveScope returns the scope repository-relative', () => {
    expect(resolveScope(repoRoot, `./${TS_FIXTURE}/`)).toEqual({
      scope: TS_FIXTURE,
    });
  });
});

describe('gates refs — TypeScript verdicts', () => {
  it('T1 a symbol referenced from another module exits 0 and lists it', async () => {
    const out = await executeRefs(
      flags({ symbol: 'GateDefinitionSeeder', scope: 'packages/db-core/src' }),
      repoRoot,
    );
    expect(out.stderr).toBe('');
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toMatch(/^PASS GateDefinitionSeeder/);
    expect(out.stdout).toContain('label.util.ts');
  });

  it('T4 a symbol referenced only from tests exits 1 without --include-tests', async () => {
    const out = await executeRefs(flags({ symbol: 'onlyTested' }), repoRoot);
    expect(out.exitCode).toBe(1);
    expect(out.stdout).toContain('not referenced from any other module');
    expect(out.stdout).toContain('in test code not counted');
  });

  it('T4 counts the test reference with --include-tests', async () => {
    const out = await executeRefs(
      flags({ symbol: 'onlyTested', 'include-tests': true }),
      repoRoot,
    );
    expect(out.exitCode).toBe(0);
  });

  it('an orphan exits 1 and a missing symbol exits 1', async () => {
    expect(
      (await executeRefs(flags({ symbol: 'orphanHelper' }), repoRoot)).exitCode,
    ).toBe(1);
    const missing = await executeRefs(
      flags({ symbol: 'noSuchHelper' }),
      repoRoot,
    );
    expect(missing.exitCode).toBe(1);
    expect(missing.stdout).toContain('not found');
  });
});

describe.skipIf(!hasRustAnalyzer)(
  'gates refs — Rust verdicts',
  { timeout: 60_000 },
  () => {
    it('T5 a function used from another module exits 0 after indexing', async () => {
      const out = await executeRefs(
        flags({ lang: 'rust', symbol: 'used_helper', scope: RUST_FIXTURE }),
        repoRoot,
      );
      expect(out.stderr).toBe('');
      expect(out.exitCode).toBe(0);
      expect(out.stdout).toContain('src/lib.rs');
    });

    it('a function used only from #[cfg(test)] exits 1 unless --include-tests', async () => {
      const base = flags({
        lang: 'rust',
        symbol: 'only_tested',
        scope: RUST_FIXTURE,
      });
      expect((await executeRefs(base, repoRoot)).exitCode).toBe(1);
      expect(
        (await executeRefs({ ...base, 'include-tests': true }, repoRoot))
          .exitCode,
      ).toBe(0);
    });

    it('a production reference right after a #[cfg(test)] field counts (review round 2)', async () => {
      const out = await executeRefs(
        flags({
          lang: 'rust',
          symbol: 'field_neighbour_helper',
          scope: RUST_FIXTURE,
        }),
        repoRoot,
      );
      expect(out.exitCode).toBe(0);
    });

    it.each([
      ['bare_test_only', 'a bare #[test] function'],
      ['all_test_only', 'a #[cfg(all(test, …))] module'],
      ['out_of_line_only', 'an out-of-line #[cfg(test)] mod'],
      ['use_only_helper', 'a body-less #[cfg(test)] use'],
      ['inner_attr_only', 'a file under #![cfg(test)]'],
    ])(
      '%s (%s) exits 1: test code never counts (review H1)',
      async (symbol) => {
        const out = await executeRefs(
          flags({ lang: 'rust', symbol, scope: RUST_FIXTURE }),
          repoRoot,
        );
        expect(out.exitCode).toBe(1);
        expect(out.stdout).toContain('in test code not counted');
      },
    );
  },
);

describe('formatRefs', () => {
  it('lists declarations and counted references before test hits, capped at 20', () => {
    const resolution: SymbolResolution = {
      symbol: 'X',
      result: {
        found: true,
        resolvedAsMember: false,
        declarationFiles: ['a.ts'],
        referenceCount: 1,
        referencingFiles: ['b.ts'],
        excludedTestReferences: 25,
        filesScanned: 3,
        tsConfigPath: null,
      },
      locations: [
        { file: 'a.ts', line: 1, col: 1, kind: 'declaration' },
        ...Array.from({ length: 25 }, (_, i) => ({
          file: 'a.test.ts',
          line: i + 1,
          col: 1,
          kind: 'test' as const,
        })),
        { file: 'b.ts', line: 3, col: 5, kind: 'reference' },
      ],
    };
    const lines = formatRefs(resolution, 'ts', 'src').trimEnd().split('\n');
    expect(lines[0]).toMatch(/^PASS X/);
    expect(lines[1]).toContain('declaration a.ts:1:1');
    expect(lines[2]).toContain('reference   b.ts:3:5');
    expect(lines).toHaveLength(1 + 20 + 1);
    expect(lines.at(-1)).toContain('7 more');
  });
});
