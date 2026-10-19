import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveDisplayCommand } from '@levr/shared/runs/gate-op';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * internal review C1 — the command the server renders for an inspect op must
 * reach a CLI that has `gates inspect` registered. This runs the RENDERED
 * display string through bash, with only the `npx '<pkg>'` prefix swapped for
 * this checkout's CLI entry point, so a missing route (`No command registered
 * for inspect`, exit 251) or a quoting mismatch fails here.
 */
const here = dirname(fileURLToPath(import.meta.url));
const cliEntry = resolve(here, '../../bin/cli.ts');
const tsx = resolve(here, '../../../../../node_modules/.bin/tsx');

let root = '';
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

function runRendered(op: object): { status: number | null; stdout: string } {
  const display = deriveDisplayCommand(op as never, 'posix', {
    cliSpec: '0.0.0-test',
  });
  const prefix = `npx '@levr-one/cli@0.0.0-test' `;
  expect(display.startsWith(prefix)).toBe(true);
  const local = `'${tsx}' '${cliEntry}' ${display.slice(prefix.length)}`;
  const r = spawnSync('bash', ['-c', local], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout };
}

describe('rendered `gates inspect` command runs against this CLI', () => {
  it('passes and fails by the check, with a quote in the pattern', () => {
    root = mkdtempSync(join(tmpdir(), 'gates-inspect-cli-'));
    writeFileSync(join(root, 'note.txt'), "it's alpha\n");
    const hit = runRendered({
      op: 'inspect',
      check: 'contains',
      params: { path: 'note.txt', pattern: "it's" },
    });
    expect(hit.status).toBe(0);
    expect(hit.stdout.trim()).toBe('1');
    const miss = runRendered({
      op: 'inspect',
      check: 'contains',
      params: { path: 'note.txt', pattern: 'beta' },
    });
    expect(miss.status).toBe(1);
  }, 120_000);
});
