import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  runLocalCommands,
  toReportResult,
  type GateLocalCommand,
  type RawGateStep,
} from './gate-runner.js';

/**
 * internal review R2-01 — `levr gates run` reports a compound command
 * (`cd <workspace> && yarn test:unit …`, exactly as the resolver hands it
 * out) as ONE step. The SERVER judges it per top-level command, so a run
 * that ran nothing fails. The copy-paste helper that used to share this
 * contract was retired (internal).
 *
 * The verdict comes from the real `deriveGateVerdict` (`@levr/shared`),
 * loaded by path: the CLI must not import `@levr/*` (it would join the
 * published bundle), and the test needs the server's verdict, not a copy.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SHARED_VERDICT = resolve(
  here,
  '../../../../shared/src/runs/gate-verdict.ts',
);

type DeriveGateVerdict = (
  steps: readonly RawGateStep[],
  expected: string,
) => { status: string; actual: string };

let deriveGateVerdict: DeriveGateVerdict;
beforeAll(async () => {
  const mod = (await import(pathToFileURL(SHARED_VERDICT).href)) as {
    deriveGateVerdict: DeriveGateVerdict;
  };
  deriveGateVerdict = mod.deriveGateVerdict;
});

const NO_FILES = 'No test files found, exiting with code 0\n';

const COMPOUND: GateLocalCommand = {
  gate_type: 'unit_test_pass',
  command: 'cd apps/x && yarn test:unit --passWithNoTests missing.spec.ts',
  link_id: '01a0d935-19fe-7b9d-9bde-20b20f8bfc10',
  step_id: 's1',
};

describe('R2-01 — a compound command reported by the CLI is judged per command', () => {
  it('"No test files found" at exit 0 behind `cd x &&` FAILS on the server verdict', () => {
    const result = toReportResult(COMPOUND, {
      exitCode: 0,
      stdout: NO_FILES,
      stderr: '',
    });
    // The CLI reports the command whole, as one step, exactly as given.
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.command).toBe(COMPOUND.command);
    expect(result.status).toBe('pass'); // only the exit code's opinion
    for (const expected of ['exit 0', '']) {
      const v = deriveGateVerdict(result.steps, expected);
      expect(v.status, `expected=${expected}`).toBe('fail');
      expect(v.actual).toMatch(/no matching test files/);
    }
  });

  it.each([
    ['all skipped', 'Tests:       3 skipped, 3 total\n'],
    ['silent', ''],
    [
      '`1 failed` at exit 0',
      ' Test Files  1 failed (1)\n Tests  1 failed (1)\n',
    ],
  ])('%s behind `cd x &&` fails', (_n, stdout) => {
    const result = toReportResult(COMPOUND, {
      exitCode: 0,
      stdout,
      stderr: '',
    });
    expect(deriveGateVerdict(result.steps, 'exit 0').status).toBe('fail');
  });

  describe('real run: the CLI reports the compound command as one step', () => {
    let dir = '';
    let binDir = '';
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'eng5967-r2-01-'));
      mkdirSync(join(dir, 'apps', 'x'), { recursive: true });
      binDir = join(dir, 'bin');
      mkdirSync(binDir);
      // A stand-in `yarn` that behaves like vitest finding no test files.
      const yarn = join(binDir, 'yarn');
      writeFileSync(
        yarn,
        `#!/bin/sh\nprintf '%s' '${NO_FILES.trim()}'\necho\nexit 0\n`,
      );
      chmodSync(yarn, 0o755);
    });
    afterAll(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('reports the raw step, and the server verdict FAILS it', () => {
      const PATH = `${binDir}${delimiter}${process.env['PATH'] ?? ''}`;
      const cwd = process.cwd();
      const savedPath = process.env['PATH'];
      process.chdir(dir);
      process.env['PATH'] = PATH;
      let fromCli;
      try {
        fromCli = runLocalCommands([COMPOUND]);
      } finally {
        process.chdir(cwd);
        process.env['PATH'] = savedPath;
      }
      expect(fromCli[0]!.steps).toHaveLength(1);
      expect(fromCli[0]!.steps[0]!.command).toBe(COMPOUND.command);
      expect(fromCli[0]!.steps[0]!.exit_code).toBe(0);
      expect(fromCli[0]!.steps[0]!.stdout_tail).toContain(
        'No test files found',
      );
      expect(deriveGateVerdict(fromCli[0]!.steps, 'exit 0').status).toBe(
        'fail',
      );
    });
  });
});
