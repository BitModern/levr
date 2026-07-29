import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LocalContext } from '../context.js';
import {
  completionHandler,
  completionScript,
  detectShell,
  isCompletionShell,
  COMPLETION_SHELLS,
} from './completionHandler.js';

/**
 * Sources the generated bash script in a real bash process, drives
 * `__levr_complete`, and returns the argv the stubbed `levr` actually received
 * — one argument per line. Asserting on that argv is what makes this a real
 * test of the script's behaviour rather than a substring check on its text.
 *
 * The argv is captured via a log file rather than through `COMPREPLY`, because
 * `COMPREPLY=( $(...) )` word-splits the subshell's OUTPUT — an argument
 * containing a space arrives correctly at the stub but is split on the way
 * back, which would make the assertion measure the wrong side of the boundary.
 *
 * The temp cwd is seeded with decoy files so any return to unquoted
 * word-splitting/globbing surfaces as leaked filenames.
 */
function driveBashCompletion(words: string[], compLine: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'levr-completion-'));
  try {
    const log = join(dir, 'argv.log');
    const stub = join(dir, 'levr');
    writeFileSync(
      stub,
      `#!/bin/bash\nfor a in "$@"; do echo "ARG:$a" >> ${JSON.stringify(log)}; done\n`,
    );
    chmodSync(stub, 0o755);
    writeFileSync(log, '');
    writeFileSync(join(dir, 'decoy-alpha.txt'), '');
    writeFileSync(join(dir, 'decoy-beta.txt'), '');

    const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
    const script = [
      `export PATH=${quote(dir)}:"$PATH"`,
      `cd ${quote(dir)}`,
      completionScript('bash'),
      `COMP_WORDS=(${words.map(quote).join(' ')})`,
      `COMP_CWORD=${words.length - 1}`,
      `COMP_LINE=${quote(compLine)}`,
      '__levr_complete',
    ].join('\n');

    execFileSync('bash', ['-c', script], { encoding: 'utf8' });
    return readFileSync(log, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Returns the context plus direct handles to its stream mocks, so assertions
 * never have to reach back through `ctx.process.stdout.write` (an unbound
 * method reference).
 */
function createMockContext(shellEnv?: string) {
  const stdout = vi.fn<(chunk: string) => boolean>();
  const stderr = vi.fn<(chunk: string) => boolean>();
  const ctx = {
    process: {
      stdout: { write: stdout },
      stderr: { write: stderr },
      env: shellEnv === undefined ? {} : { SHELL: shellEnv },
      exitCode: 0,
    },
    logger: {} as LocalContext['logger'],
  } as unknown as LocalContext;

  const textOf = (mock: typeof stdout) =>
    mock.mock.calls.map(([chunk]) => chunk).join('');

  return {
    ctx,
    out: () => textOf(stdout),
    err: () => textOf(stderr),
    exitCode: () => ctx.process.exitCode,
  };
}

describe('detectShell', () => {
  it.each([
    ['/bin/bash', 'bash'],
    ['/usr/bin/zsh', 'zsh'],
    ['/usr/local/bin/zsh', 'zsh'],
    ['-bash', 'bash'],
  ])('detects %s as %s', (path, expected) => {
    expect(detectShell(path)).toBe(expected);
  });

  it.each([undefined, '', '/bin/fish', '/usr/bin/sh'])(
    'returns undefined for %s',
    (path) => {
      expect(detectShell(path)).toBeUndefined();
    },
  );
});

describe('isCompletionShell', () => {
  it('accepts supported shells and rejects others', () => {
    expect(isCompletionShell('bash')).toBe(true);
    expect(isCompletionShell('zsh')).toBe(true);
    expect(isCompletionShell('fish')).toBe(false);
    expect(isCompletionShell('')).toBe(false);
  });
});

describe('completionScript', () => {
  it('emits a bash script that registers a complete handler', () => {
    const script = completionScript('bash');
    expect(script).toContain('__levr_complete()');
    expect(script).toContain(
      'complete -o default -o nospace -F __levr_complete levr',
    );
    // Delegates to the shell-agnostic hidden entrypoint rather than embedding
    // any command list, so the script never goes stale as commands change.
    expect(script).toContain('levr __complete');
  });

  it('emits a zsh script that registers via compdef', () => {
    const script = completionScript('zsh');
    expect(script).toContain('_levr_complete()');
    expect(script).toContain('compdef _levr_complete levr');
    expect(script).toContain('levr __complete');
    expect(script).toContain('compadd');
  });

  it('keeps the zsh word-splitting shims that mirror bash $COMP_LINE behaviour', () => {
    const script = completionScript('zsh');
    // Joining with a single space is what produces the trailing space that
    // __complete uses to decide "propose the next argument".
    expect(script).toContain('${(j: :)words}');
    // Dropping the trailing empty word prevents __complete seeing it twice.
    expect(script).toContain('args[1,-2]');
  });

  it('produces different scripts per shell', () => {
    expect(completionScript('bash')).not.toBe(completionScript('zsh'));
  });
});

describe('completionHandler', () => {
  it.each(COMPLETION_SHELLS)(
    'writes the %s script to stdout and nothing to stderr',
    (shell) => {
      const t = createMockContext();
      completionHandler.call(t.ctx, {}, shell);

      expect(t.out()).toBe(completionScript(shell));
      expect(t.err()).toBe('');
      expect(t.exitCode()).toBe(0);
    },
  );

  it('falls back to $SHELL when no argument is given', () => {
    const t = createMockContext('/usr/bin/zsh');
    completionHandler.call(t.ctx, {});

    expect(t.out()).toBe(completionScript('zsh'));
    expect(t.exitCode()).toBe(0);
  });

  it('prefers an explicit argument over $SHELL', () => {
    const t = createMockContext('/bin/bash');
    completionHandler.call(t.ctx, {}, 'zsh');

    expect(t.out()).toBe(completionScript('zsh'));
  });

  // The defect this command replaces: `levr install` exited 0 and did nothing
  // on a non-bash shell, so users and CI saw success with no completion
  // installed (internal). Failure must be loud and non-zero.
  it('fails loudly when $SHELL is unsupported', () => {
    const t = createMockContext('/usr/bin/fish');
    completionHandler.call(t.ctx, {});

    expect(t.out()).toBe('');
    expect(t.err()).toContain('Could not detect your shell');
    expect(t.exitCode()).toBe(1);
  });

  it('fails loudly when $SHELL is unset', () => {
    const t = createMockContext();
    completionHandler.call(t.ctx, {});

    expect(t.out()).toBe('');
    expect(t.exitCode()).toBe(1);
  });

  it('rejects an explicitly requested unsupported shell', () => {
    const t = createMockContext('/bin/bash');
    completionHandler.call(t.ctx, {}, 'fish');

    expect(t.out()).toBe('');
    expect(t.err()).toContain('Unsupported shell "fish"');
    expect(t.exitCode()).toBe(1);
  });

  // An explicit empty argument is NOT the same as an omitted one: `??` treats
  // both as "absent", which made `levr completion ""` blame an undetectable
  // $SHELL even when $SHELL was perfectly valid.
  it('reports an explicit empty shell argument as unsupported, not undetectable', () => {
    const t = createMockContext('/bin/zsh');
    completionHandler.call(t.ctx, {}, '');

    expect(t.out()).toBe('');
    expect(t.err()).toContain('Unsupported shell ""');
    expect(t.err()).not.toContain('Could not detect');
    expect(t.exitCode()).toBe(1);
  });

  it('never writes anything but the script to stdout (eval-safety)', () => {
    for (const shell of COMPLETION_SHELLS) {
      const t = createMockContext();
      completionHandler.call(t.ctx, {}, shell);
      // stdout must be pure shell source, or `eval "$(levr completion X)"`
      // would execute status chatter.
      expect(t.out().startsWith('# levr')).toBe(true);
      expect(t.out()).not.toContain('Skipping');
    }
  });
});

// Executes the emitted bash script for real. Without these, the suite would
// stay green even if the script were syntactically broken or passed the wrong
// argv, because every other assertion only inspects the script's TEXT.
describe('bash completion script (executed)', () => {
  it('sources cleanly and forwards the full word array to levr __complete', () => {
    const out = driveBashCompletion(['levr', 'auth'], 'levr auth');

    // proposeCompletionLines drops argv[0] (`__complete`) AND argv[1] (the
    // command name), so the command name must be forwarded, not skipped.
    expect(out).toContain('ARG:__complete');
    expect(out).toContain('ARG:levr');
    expect(out).toContain('ARG:auth');
  });

  // Regression: an unquoted $COMP_LINE was subject to pathname expansion, so a
  // literal glob on the command line expanded against the cwd and injected
  // unrelated filenames into the arguments sent to __complete.
  it('does not glob-expand words against the working directory', () => {
    const out = driveBashCompletion(['levr', 'push', '*'], 'levr push *');

    expect(out).toContain('ARG:*');
    expect(out).not.toContain('decoy-alpha.txt');
    expect(out).not.toContain('decoy-beta.txt');
  });

  // Regression: an unquoted $COMP_LINE also word-split, so a value containing a
  // space arrived as two separate arguments.
  it('keeps a word containing a space as a single argument', () => {
    const out = driveBashCompletion(
      ['levr', 'push', '--source', 'my source'],
      'levr push --source "my source"',
    );

    // One line per received argument, so an exact-line match proves the
    // stub got "my source" as a SINGLE argv entry.
    expect(out.split('\n')).toContain('ARG:my source');
    expect(out.split('\n')).not.toContain('ARG:source');
    expect(out.split('\n')).not.toContain('ARG:my');
  });

  // Regression: bash may put a trailing EMPTY word in COMP_WORDS when the
  // cursor sits on a fresh word. Forwarding it would make __complete see the
  // empty word twice — once positionally, once from COMP_LINE's trailing-space
  // rule — and match nothing at all. Asserted for both conventions so the
  // script stays correct however bash populates COMP_WORDS.
  it('drops a trailing empty word before calling levr __complete', () => {
    const withEmpty = driveBashCompletion(['levr', ''], 'levr ');

    expect(withEmpty.split('\n').filter(Boolean)).toEqual([
      'ARG:__complete',
      'ARG:levr',
    ]);
  });

  it('leaves a non-empty final word intact', () => {
    const out = driveBashCompletion(['levr', 'au'], 'levr au');

    expect(out.split('\n').filter(Boolean)).toEqual([
      'ARG:__complete',
      'ARG:levr',
      'ARG:au',
    ]);
  });
});
