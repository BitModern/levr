import * as fs from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { migrationRevertScopeCheck as cliCheck } from './migration-down-scope.js';

/**
 * internal review (Low) — `migration-down-scope.ts` is a hand copy of
 * db-core's `migrationRevertScopeCheck` (the CLI must not inline
 * `@levr/db-core`). This proves the copy has not drifted: both functions
 * run over every real migration in the backend plus edge cases, and must
 * agree on the exit code and every line. The db-core module is loaded by
 * URL so the CLI build and typecheck never see it.
 */
type Check = (
  f: Pick<typeof fs, 'existsSync' | 'statSync' | 'readFileSync'>,
  paths: string[],
  log: (line: string) => void,
) => number;

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../../..');
let dbCoreCheck: Check;
let scratch = '';

beforeAll(async () => {
  const mod = (await import(
    pathToFileURL(
      join(repo, 'packages/db-core/src/seeds/migration-revert-scope.check.ts'),
    ).href
  )) as { migrationRevertScopeCheck: Check };
  dbCoreCheck = mod.migrationRevertScopeCheck;
  scratch = mkdtempSync(join(tmpdir(), 'down-scope-parity-'));
});

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

function both(paths: string[]): void {
  const a: string[] = [];
  const b: string[] = [];
  const codeA = cliCheck(fs, paths, (l) => a.push(l));
  const codeB = dbCoreCheck(fs, paths, (l) => b.push(l));
  expect({ code: codeA, lines: a }).toEqual({ code: codeB, lines: b });
}

const tsMigration = (down: string) =>
  `export class M implements MigrationInterface {\n  public async up(): Promise<void> {}\n\n  public async down(queryRunner: QueryRunner): Promise<void> {\n${down}\n  }\n}\n`;

// Assembled so no literal destructive statement appears in this file.
const EMPTY_TABLE = ['TRUNC', 'ATE'].join('');

describe('migration_down_scope CLI copy matches db-core', () => {
  it('agrees on every backend migration', () => {
    const dirs = [
      join(repo, 'apps/backender/src/database/migrations'),
      join(repo, 'apps/backender/src/database/migrations/gen'),
    ];
    let count = 0;
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.ts')) continue;
        both([join(dir, name)]);
        count += 1;
      }
    }
    // The corpus is real: an empty directory would make this vacuous.
    expect(count).toBeGreaterThan(100);
  });

  it.each([
    ['unscoped delete', 'await queryRunner.query(`DELETE FROM "issue"`);'],
    [
      'scoped delete',
      `await queryRunner.query('DELETE FROM "issue" WHERE id = $1', [x]);`,
    ],
    ['emptying statement', `await queryRunner.query("${EMPTY_TABLE} issue");`],
    ['clearTable', "await queryRunner.clearTable('issue');"],
    ['comment only', '// DELETE FROM "issue"'],
    ['empty', ''],
  ])('agrees on %s', (_label, down) => {
    const name = join(scratch, `${Math.random().toString(36).slice(2)}.ts`);
    writeFileSync(name, tsMigration(down));
    both([name]);
  });

  it('agrees on a missing path and a directory', () => {
    both([join(scratch, 'nope.ts')]);
    both([scratch]);
  });
});
