import { describe, expect, it } from 'vitest';

import {
  chooseShell,
  NoPosixShellError,
  GATE_STEP_TAIL_LIMIT,
  runInShell,
  runLocalCommands,
  tail,
  toReportResult,
  type GateLocalCommand,
} from './gate-runner.js';

const cmd = (over: Partial<GateLocalCommand>): GateLocalCommand => ({
  gate_type: 'shell',
  command: 'true',
  link_id: '01a0d935-19fe-7b9d-9bde-20b20f8bfc00',
  ...over,
});

describe('internal F — the gate runner reports RAW facts', () => {
  it('echoes link_id, step_id and rule_hash, and carries one raw step', () => {
    const r = toReportResult(
      cmd({
        command: 'npx playwright test',
        expected: 'exit 0',
        step_id: 'step-3',
        rule_hash: 'e3.e49370553490',
      }),
      { exitCode: 0, stdout: '  8 passed (2.0s)\n', stderr: '' },
    );
    expect(r).toEqual({
      gate_type: 'shell',
      link_id: '01a0d935-19fe-7b9d-9bde-20b20f8bfc00',
      status: 'pass',
      output: '  8 passed (2.0s)\n',
      expected: 'exit 0',
      step_id: 'step-3',
      rule_hash: 'e3.e49370553490',
      steps: [
        {
          command: 'npx playwright test',
          exit_code: 0,
          stdout_tail: '  8 passed (2.0s)\n',
          stderr_tail: '',
          step_id: 'step-3',
        },
      ],
    });
  });

  it('keeps the END of a long stream — where summaries and verdicts are', () => {
    const long = `${'x'.repeat(10_000)}\n  8 passed (2.0s)\n`;
    expect(tail(long)).toHaveLength(GATE_STEP_TAIL_LIMIT);
    expect(tail(long).endsWith('8 passed (2.0s)\n')).toBe(true);
    // The server's limit, kept in step with @levr/shared by value.
    expect(GATE_STEP_TAIL_LIMIT).toBe(4000);
  });

  it('runs each command EXACTLY as given through sh -c — pipes, &&, quoting and all', () => {
    const [r] = runLocalCommands([
      cmd({ command: `printf 'a b\\n' | tr ' ' '-' && echo "done" >&2` }),
    ]);
    expect(r!.steps[0]).toMatchObject({
      exit_code: 0,
      stdout_tail: 'a-b\n',
      stderr_tail: 'done\n',
    });
  });

  it('reports the real non-zero exit code, and a silent success as exit 0 with no output', () => {
    const results = runLocalCommands([
      cmd({ command: 'exit 3' }),
      cmd({ command: 'true' }),
    ]);
    expect(results.map((r) => r.steps[0]!.exit_code)).toEqual([3, 0]);
    expect(results.map((r) => r.status)).toEqual(['fail', 'pass']);
    expect(results[1]!.output).toBe('');
  });

  it('a command killed by a signal is never exit 0', () => {
    const out = runInShell('kill -9 $$');
    expect(out.exitCode).not.toBe(0);
    expect(out.stderr).toMatch(/killed by SIGKILL/);
  });

  it('…and never exit 1, which the server reads as "grep matched nothing" (internal L1 round 4 F-010)', () => {
    expect(runInShell('kill -9 $$').exitCode).toBe(137);
    expect(runInShell('kill -TERM $$').exitCode).toBe(143);
    // The cause is the LAST line, where the reported tail keeps it.
    expect(runInShell('echo x >&2; kill -9 $$').stderr).toMatch(
      /killed by SIGKILL$/,
    );
  });

  it('an output overflow (a spawn error, not a signal of its own) is never 0 or 1 (round 5 F-005)', () => {
    // More than the 64 MiB buffer: Node reports ENOBUFS as `r.error` AND
    // kills the child (SIGTERM), so the signal alone already catches it here.
    // `r.error` without a signal is a shell that failed to spawn at all,
    // which this runner cannot be made to hit; the branch stays, defensive.
    const out = runInShell('head -c 70000000 /dev/zero');
    expect([0, 1]).not.toContain(out.exitCode);
    expect(out.stderr).toMatch(/\[runner\] .*ENOBUFS/);
  });
});

describe('internal F-020 — gate commands run in bash, like the MCP executor', () => {
  const only =
    (...present: string[]) =>
    (shell: string) =>
      present.includes(shell);

  it('uses /bin/bash -c on POSIX when it exists', () => {
    const s = chooseShell('linux', only('/bin/bash'));
    expect([s.file, ...s.args('echo hi')]).toEqual([
      '/bin/bash',
      '-c',
      'echo hi',
    ]);
    expect(chooseShell('darwin', only('/bin/bash')).file).toBe('/bin/bash');
  });

  it('falls back to /bin/sh -c on POSIX without bash', () => {
    const s = chooseShell('linux', only('/bin/sh'));
    expect([s.file, ...s.args('echo hi')]).toEqual([
      '/bin/sh',
      '-c',
      'echo hi',
    ]);
  });

  it('on Windows uses bash from PATH, else sh from PATH', () => {
    expect(chooseShell('win32', only('bash')).file).toBe('bash');
    const sh = chooseShell('win32', only('sh'));
    expect([sh.file, ...sh.args('echo hi')]).toEqual(['sh', '-c', 'echo hi']);
  });

  // F-020 — never cmd.exe: it has no POSIX semantics, so every gate would
  // "fail" for reasons that say nothing about the code.
  it('on Windows with neither bash nor sh, REFUSES and names Git Bash and WSL', () => {
    expect(() => chooseShell('win32', only('/bin/bash', 'cmd.exe'))).toThrow(
      NoPosixShellError,
    );
    expect(() => chooseShell('win32', only())).toThrow(/Git Bash.*WSL/s);
  });

  it('on POSIX with neither /bin/bash nor /bin/sh, REFUSES', () => {
    expect(() => chooseShell('linux', only())).toThrow(NoPosixShellError);
  });

  it('runs bash-only syntax for real on this machine', () => {
    // `${#v}` and arrays are bash; dash (Ubuntu's sh) rejects the array.
    const r = runInShell('a=(x yz); v=abcd; echo "${#v} ${a[1]}"');
    expect(r).toMatchObject({ exitCode: 0, stdout: '4 yz\n' });
  });
});
