import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runLocalCommands, type GateLocalCommand } from './gate-runner.js';

/**
 * internal F — the documented no-install helper and `levr gates run` are ONE
 * contract. The script lives in the help docs (the single place a person
 * copies it from); this test extracts it from that doc, runs it and the CLI's
 * runner over the same real commands, and requires identical payloads. A doc
 * edit that drifts from the CLI — or a CLI change that drifts from the doc —
 * fails here.
 */

const here = dirname(fileURLToPath(import.meta.url));
const DOC = resolve(
  here,
  '../../../../help-content/docs/gates/running-gates.mdx',
);

/** The first ```js fence under the "without the CLI" heading. */
function extractHelperScript(mdx: string): string {
  const section = mdx.split(/^## Running gates without the CLI.*$/m)[1];
  if (!section)
    throw new Error('helper section not found in running-gates.mdx');
  const m = /```js\n([\s\S]*?)```/.exec(section);
  if (!m) throw new Error('no ```js fence in the helper section');
  return m[1]!;
}

const COMMANDS: GateLocalCommand[] = [
  {
    gate_type: 'file_exists',
    command: 'test -f present.txt && echo EXISTS',
    expected: 'EXISTS',
    link_id: '01a0d935-184c-7c51-8a33-ca3be33ad21c',
    step_id: 's1',
    rule_hash: 'e2.f1eb505fbeb2',
  },
  {
    gate_type: 'no_stubs',
    command: 'grep -Ec "TODO" present.txt',
    expected: '0',
    link_id: '01a0d935-19c7-7a22-a43b-573b44453aff',
    step_id: 's2',
    rule_hash: 'e2.e69456051f01',
  },
  {
    gate_type: 'shell',
    command: `node -e "process.stdout.write('x'.repeat(9000)+'\\n  8 passed (2.0s)\\n'); console.error('warn'); process.exit(0)"`,
    link_id: '01a0d935-19fe-7b9d-9bde-20b20f8bfc00',
    step_id: 's3',
  },
  {
    gate_type: 'shell',
    command: 'echo broken >&2; exit 7',
    expected: 'exit 0',
    link_id: '01a0d935-19fe-7b9d-9bde-20b20f8bfc01',
  },
  {
    // internal L1 round 4 F-010 — a killed command: 128 + signal, both sides.
    gate_type: 'no_stubs',
    command: 'kill -TERM $$',
    expected: '0',
    link_id: '01a0d935-19fe-7b9d-9bde-20b20f8bfc02',
  },
];

describe('internal F — the documented helper matches `levr gates run`', () => {
  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'eng5967-helper-'));
    writeFileSync(join(dir, 'present.txt'), 'nothing to see\n');
    writeFileSync(
      join(dir, 'levr-gates-run.mjs'),
      extractHelperScript(readFileSync(DOC, 'utf8')),
    );
    writeFileSync(
      join(dir, 'verify.json'),
      JSON.stringify({ status: 'pending_local', local_commands: COMMANDS }),
    );
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('prints exactly the payload the CLI builds, for the same commands', () => {
    const helper = spawnSync(
      process.execPath,
      ['levr-gates-run.mjs', 'verify.json'],
      { cwd: dir, encoding: 'utf8' },
    );
    expect(helper.status, helper.stderr).toBe(0);
    const fromDoc = JSON.parse(helper.stdout) as { results: unknown[] };

    const cwd = process.cwd();
    process.chdir(dir);
    let fromCli;
    try {
      fromCli = runLocalCommands(COMMANDS);
    } finally {
      process.chdir(cwd);
    }
    expect(fromDoc).toEqual({ results: fromCli });
    // And the facts are the raw ones.
    expect(fromCli.map((r) => r.steps[0]!.exit_code)).toEqual([
      0, 1, 0, 7, 143,
    ]);
    expect(
      fromCli[2]!.steps[0]!.stdout_tail.endsWith('8 passed (2.0s)\n'),
    ).toBe(true);
  });

  it('prints each command to stderr, keeping stdout the payload (F-008)', () => {
    const helper = spawnSync(
      process.execPath,
      ['levr-gates-run.mjs', 'verify.json'],
      { cwd: dir, encoding: 'utf8' },
    );
    expect(helper.stderr).toContain(
      '[1/5] file_exists: test -f present.txt && echo EXISTS',
    );
    expect(() => JSON.parse(helper.stdout) as unknown).not.toThrow();
  });

  it('--dry-run lists the commands and runs NOTHING (F-008)', () => {
    const marker = join(dir, 'ran.marker');
    writeFileSync(
      join(dir, 'touch.json'),
      JSON.stringify([
        { gate_type: 'shell', command: `touch ${marker}`, link_id: 'l1' },
      ]),
    );
    const r = spawnSync(
      process.execPath,
      ['levr-gates-run.mjs', 'touch.json', '--dry-run'],
      { cwd: dir, encoding: 'utf8' },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(marker)).toBe(false);
    const listing = JSON.parse(r.stdout) as {
      dry_run: boolean;
      commands: Array<{ command: string }>;
    };
    expect(listing.dry_run).toBe(true);
    expect(listing.commands[0]!.command).toBe(`touch ${marker}`);
  });

  it('accepts a bare local_commands array as well as the whole verify response', () => {
    writeFileSync(join(dir, 'cmds.json'), JSON.stringify(COMMANDS.slice(0, 1)));
    const r = spawnSync(process.execPath, ['levr-gates-run.mjs', 'cmds.json'], {
      cwd: dir,
      encoding: 'utf8',
    });
    const parsed = JSON.parse(r.stdout) as {
      results: Array<{ step_id: string }>;
    };
    expect(parsed.results.map((x) => x.step_id)).toEqual(['s1']);
  });

  /**
   * User decision 2026-09-25 (review R3-01): no local allowlist. The server
   * validates every command it hands out; the helper, like the CLI, runs
   * what it was given after printing it — inline code included.
   */
  it('runs inline code without any flag, and --dry-run carries no refusal marker', () => {
    const marker = join(dir, 'inline.marker');
    writeFileSync(
      join(dir, 'inline.json'),
      JSON.stringify([
        {
          gate_type: 'shell',
          command: 'test -f present.txt && echo EXISTS',
          link_id: 'l0',
        },
        {
          gate_type: 'shell',
          command: `node -e "require('fs').writeFileSync('${marker}', '')"`,
          link_id: 'l1',
        },
      ]),
    );
    const listed = spawnSync(
      process.execPath,
      ['levr-gates-run.mjs', 'inline.json', '--dry-run'],
      { cwd: dir, encoding: 'utf8' },
    );
    expect(listed.status, listed.stderr).toBe(0);
    expect(listed.stdout).not.toContain('refused_without_yes');
    expect(existsSync(marker)).toBe(false);

    const ran = spawnSync(
      process.execPath,
      ['levr-gates-run.mjs', 'inline.json'],
      { cwd: dir, encoding: 'utf8' },
    );
    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.stderr).toContain('[2/2] shell: node -e');
    expect(existsSync(marker)).toBe(true);
    const payload = JSON.parse(ran.stdout) as { results: unknown[] };
    expect(payload.results).toHaveLength(2);
  });
});
