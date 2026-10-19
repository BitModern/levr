import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveGateVerdict } from '@levr/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { runBuiltin, translatePosixEre } from './builtins.js';

let root: string;

function setup(): string {
  root = mkdtempSync(join(tmpdir(), 'gates-inspect-'));
  return root;
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('gate inspect builtins', () => {
  it('contains is case-insensitive like the server', () => {
    const dir = setup();
    writeFileSync(join(dir, 'note.txt'), 'Hello World\n');
    const hit = runBuiltin(
      { check: 'contains', params: { path: 'note.txt', pattern: 'hello' } },
      dir,
    );
    expect(hit.exitCode).toBe(0);
    expect(hit.stdout.trim()).toBe('1');
    const miss = runBuiltin(
      { check: 'contains', params: { path: 'note.txt', pattern: 'HELLO' } },
      dir,
    );
    expect(miss.exitCode).toBe(0);
    const absent = runBuiltin(
      {
        check: 'not_contains',
        params: { path: 'note.txt', pattern: 'hello' },
      },
      dir,
    );
    expect(absent.exitCode).toBe(0);
    expect(absent.stdout.trim()).toBe('0');
  });

  it('done_criteria names the missing requirement', () => {
    const dir = setup();
    writeFileSync(join(dir, 'note.txt'), 'alpha is here\n');
    const result = runBuiltin(
      {
        check: 'done_criteria',
        params: { path: 'note.txt', requirements: ['alpha', 'beta'] },
      },
      dir,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('MISSING:');
    expect(result.stdout).toContain('beta');
    expect(result.stdout).not.toContain('alpha');
  });

  it('not_contains sums counts across a glob', () => {
    const dir = setup();
    mkdirSync(join(dir, 'bits'));
    writeFileSync(join(dir, 'bits', 'a.txt'), 'TODO one\n');
    writeFileSync(join(dir, 'bits', 'b.txt'), 'clean\nTODO two\n');
    const result = runBuiltin(
      {
        check: 'not_contains',
        params: { path: 'bits/*.txt', pattern: 'TODO' },
      },
      dir,
    );
    expect(result.stdout.trim()).toBe('2');
    expect(result.exitCode).toBe(1);
  });

  it('not_contains walks a directory', () => {
    const dir = setup();
    mkdirSync(join(dir, 'src', 'nested'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), 'keep\n');
    writeFileSync(join(dir, 'src', 'nested', 'b.ts'), 'Symbol\n');
    const hit = runBuiltin(
      { check: 'not_contains', params: { path: 'src', pattern: 'Symbol' } },
      dir,
    );
    expect(hit.exitCode).toBe(1);
    expect(hit.stdout.trim()).toBe('1');
    const miss = runBuiltin(
      { check: 'not_contains', params: { path: 'src', pattern: 'Absent' } },
      dir,
    );
    expect(miss.exitCode).toBe(0);
    expect(miss.stdout.trim()).toBe('0');
  });

  it('rejects a UNC path and a drive-letter path', () => {
    const dir = setup();
    for (const target of [
      '\\\\server\\share',
      '//server/share',
      'C:/Windows',
    ]) {
      const result = runBuiltin(
        { check: 'not_contains', params: { path: target, pattern: 'x' } },
        dir,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toContain('escapes the repo');
    }
  });

  it('json_has_key is an exact table key', () => {
    const dir = setup();
    mkdirSync(join(dir, 'specs/schema'), { recursive: true });
    writeFileSync(
      join(dir, 'specs/schema/index.json'),
      JSON.stringify({
        tables: {
          issue_test_link: { file: 'x.json' },
          issue_label: { file: 'y.json' },
        },
      }),
    );
    const check = (key: string) =>
      runBuiltin(
        {
          check: 'json_has_key',
          params: {
            path: 'specs/schema/index.json',
            key,
            object: 'tables',
          },
        },
        dir,
      );
    const verdict = (key: string) => {
      const result = check(key);
      return deriveGateVerdict(
        [
          {
            command: 'gates inspect',
            exit_code: result.exitCode,
            stdout_tail: result.stdout,
            stderr_tail: result.stderr,
          },
        ],
        'PASS',
      ).status;
    };
    const hit = check('issue_test_link');
    expect(hit.exitCode).toBe(0);
    expect(hit.stdout.trim()).toBe('PASS');
    expect(verdict('issue_test_link')).toBe('pass');
    expect(check('issue_label').exitCode).toBe(0);
    const miss = check('no_such_entity');
    expect(miss.exitCode).toBe(1);
    expect(miss.stdout).toContain('MISSING:');
    expect(verdict('no_such_entity')).toBe('fail');
    // A substring of a real key is not a key.
    expect(check('label').exitCode).toBe(1);
    expect(verdict('label')).toBe('fail');
  });

  it('fails a glob that matches no file', () => {
    const dir = setup();
    const result = runBuiltin(
      {
        check: 'contains',
        params: { path: 'missing/*.nope', pattern: 'x' },
      },
      dir,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('missing/*.nope');
  });
});

describe('internal review H4 — a literal path wins over a glob reading', () => {
  it('reads app/[id]/page.tsx literally, even with a sibling the class would match', () => {
    const dir = setup();
    mkdirSync(join(dir, 'app', '[id]'), { recursive: true });
    mkdirSync(join(dir, 'app', 'i'), { recursive: true });
    writeFileSync(join(dir, 'app', '[id]', 'page.tsx'), 'export Page\n');
    writeFileSync(join(dir, 'app', 'i', 'page.tsx'), 'TODO\n');
    const p = 'app/[id]/page.tsx';
    expect(
      runBuiltin({ check: 'exists', params: { path: p } }, dir).exitCode,
    ).toBe(0);
    expect(
      runBuiltin(
        { check: 'contains', params: { path: p, pattern: 'Page' } },
        dir,
      ).exitCode,
    ).toBe(0);
    const notContains = runBuiltin(
      { check: 'not_contains', params: { path: p, pattern: 'export' } },
      dir,
    );
    expect(notContains.exitCode).toBe(1);
    expect(notContains.stdout.trim()).toBe('1');
  });

  it('still expands the glob when the literal path does not exist, or glob: true', () => {
    const dir = setup();
    mkdirSync(join(dir, 'app', 'i'), { recursive: true });
    writeFileSync(join(dir, 'app', 'i', 'page.tsx'), 'TODO\n');
    expect(
      runBuiltin(
        {
          check: 'contains',
          params: { path: 'app/[id]/page.tsx', pattern: 'TODO' },
        },
        dir,
      ).exitCode,
    ).toBe(0);
  });
});

describe('internal review H5 — exists / not_exists over a glob', () => {
  it('not_exists passes when the glob matches nothing, fails when it matches', () => {
    const dir = setup();
    const absent = runBuiltin(
      { check: 'not_exists', params: { path: 'gone/*.ts' } },
      dir,
    );
    expect(absent.exitCode).toBe(0);
    expect(absent.stdout).toContain('absent');
    mkdirSync(join(dir, 'gone'));
    writeFileSync(join(dir, 'gone', 'a.ts'), '');
    const present = runBuiltin(
      { check: 'not_exists', params: { path: 'gone/*.ts' } },
      dir,
    );
    expect(present.exitCode).toBe(1);
    expect(present.stdout).toContain('gone/a.ts');
  });

  it('exists passes when the glob matches, fails when it matches nothing', () => {
    const dir = setup();
    expect(
      runBuiltin({ check: 'exists', params: { path: 'src/*.ts' } }, dir)
        .exitCode,
    ).toBe(1);
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.ts'), '');
    expect(
      runBuiltin({ check: 'exists', params: { path: 'src/*.ts' } }, dir)
        .exitCode,
    ).toBe(0);
    expect(
      runBuiltin({ check: 'not_exists', params: { path: 'src/a.ts' } }, dir)
        .exitCode,
    ).toBe(1);
    expect(
      runBuiltin({ check: 'not_exists', params: { path: 'src/b.ts' } }, dir)
        .exitCode,
    ).toBe(0);
  });
});

describe('internal review H6 — POSIX ERE is translated or refused', () => {
  it('translates bracket classes', () => {
    expect(translatePosixEre('foo[[:space:]]+bar')).toBe(
      'foo[ \\t\\n\\r\\f\\v]+bar',
    );
    const dir = setup();
    writeFileSync(join(dir, 'a.ts'), 'return  null\n');
    const hit = runBuiltin(
      {
        check: 'not_contains',
        params: { path: 'a.ts', pattern: 'return[[:space:]]+null' },
      },
      dir,
    );
    expect(hit.exitCode).toBe(1);
    expect(hit.stdout.trim()).toBe('1');
    // A leading ] is a literal member, the POSIX way.
    expect(new RegExp(translatePosixEre('[]a]') as string).test(']')).toBe(
      true,
    );
  });

  it.each([
    '\\<foo\\>',
    'a\\`',
    '[[.a.]]',
    '[[=a=]]',
    '[\\.]',
    'x\\1',
    '[[:nope:]]',
  ])('refuses %s with exit 2, never a silent re-read', (pattern) => {
    const dir = setup();
    writeFileSync(join(dir, 'a.ts'), 'foo\n');
    for (const check of ['contains', 'not_contains'] as const) {
      const result = runBuiltin(
        { check, params: { path: 'a.ts', pattern } },
        dir,
      );
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toContain('unsupported pattern');
    }
  });

  it('keeps a back-reference to a real group and plain JS-compatible ERE', () => {
    expect(translatePosixEre('(a)\\1')).toBe('(a)\\1');
    expect(translatePosixEre('a\\.b|c+')).toBe('a\\.b|c+');
  });

  it('applies to done_criteria requirement patterns too', () => {
    const dir = setup();
    writeFileSync(join(dir, 'a.md'), 'done\n');
    const result = runBuiltin(
      {
        check: 'done_criteria',
        params: { path: 'a.md', requirements: [{ pattern: '\\<done\\>' }] },
      },
      dir,
    );
    expect(result.exitCode).toBe(2);
  });
});

describe('internal review M10 — symlinks', () => {
  it('skips a symlink met while walking a directory', () => {
    const dir = setup();
    mkdirSync(join(dir, 'pkg', 'node_modules', '.bin'), { recursive: true });
    writeFileSync(join(dir, 'pkg', 'a.ts'), 'TODO\n');
    symlinkSync('/etc/hosts', join(dir, 'pkg', 'node_modules', '.bin', 'x'));
    const result = runBuiltin(
      { check: 'not_contains', params: { path: 'pkg', pattern: 'TODO' } },
      dir,
    );
    expect(result.stdout.trim()).toBe('1');
    expect(result.exitCode).toBe(1);
  });

  it('refuses a path that leaves the repo through a symlinked directory', () => {
    const dir = setup();
    const outside = mkdtempSync(join(tmpdir(), 'gates-outside-'));
    try {
      writeFileSync(join(outside, 'secret.txt'), 'token\n');
      symlinkSync(outside, join(dir, 'linked'));
      for (const check of ['contains', 'exists'] as const) {
        const result = runBuiltin(
          { check, params: { path: 'linked/secret.txt', pattern: 'token' } },
          dir,
        );
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toContain('escapes the repo');
      }
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('follows a requested symlink that stays inside the repo', () => {
    const dir = setup();
    mkdirSync(join(dir, 'real'));
    writeFileSync(join(dir, 'real', 'a.ts'), 'alpha\n');
    symlinkSync(join(dir, 'real'), join(dir, 'alias'));
    expect(
      runBuiltin(
        { check: 'contains', params: { path: 'alias/a.ts', pattern: 'alpha' } },
        dir,
      ).exitCode,
    ).toBe(0);
  });
});

describe('internal — the seeded no_stubs pattern runs', () => {
  // Kept in step with OP_TEMPLATES.no_stubs in
  // packages/db-core/src/seeds/gate-definition.util.ts; the db-core spec
  // asserts that seed is accepted by translatePosixEre.
  const NO_STUBS = '^[[:space:]]*(//|#|[*]|/[*]) *(TODO|FIXME|stub)';

  it('counts comment markers and ignores identifiers', () => {
    const dir = setup();
    writeFileSync(
      join(dir, 'probe.ts'),
      [
        '// TODO wire this',
        ' * FIXME later',
        '/* stub */',
        'const ISSUE_TODO_ID = 1;',
        'const x = 1; // not at line start',
      ].join('\n') + '\n',
    );
    const result = runBuiltin(
      {
        check: 'not_contains',
        params: { path: 'probe.ts', pattern: NO_STUBS },
      },
      dir,
    );
    expect(result.stdout.trim()).toBe('3');
    expect(result.exitCode).toBe(1);
  });

  it('the pre-internal pattern is refused, which is the bug', () => {
    const dir = setup();
    writeFileSync(join(dir, 'probe.ts'), '// TODO\n');
    const result = runBuiltin(
      {
        check: 'not_contains',
        params: {
          path: 'probe.ts',
          pattern: '^\\s*(//|#|\\*|/[\\*]) *(TODO|FIXME|stub)',
        },
      },
      dir,
    );
    expect(result.exitCode).toBe(2);
  });
});

describe('internal review — parity with the shell templates it replaced', () => {
  const write = (dir: string, rel: string, body: string) => {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body);
  };

  it('a `*` under a bracket-named directory reads the brackets as names first (TR-918 #5)', () => {
    const dir = setup();
    write(dir, 'r/[slug]/x.ts', 'FORBIDDEN\n');
    write(dir, 'r/s/x.ts', 'clean\n');
    write(dir, 'r/[id]/page.bak', 'old\n');
    const named = runBuiltin(
      {
        check: 'not_contains',
        params: { path: 'r/[slug]/*.ts', pattern: 'FORBIDDEN' },
      },
      dir,
    );
    expect(named.exitCode).toBe(1);
    expect(named.stdout.trim()).toBe('1');
    expect(
      runBuiltin({ check: 'not_exists', params: { path: 'r/[id]/*.bak' } }, dir)
        .exitCode,
    ).toBe(1);
    // No directory literally named [s]: the class applies.
    const cls = runBuiltin(
      { check: 'contains', params: { path: 'r/[s]/*.ts', pattern: 'clean' } },
      dir,
    );
    expect(cls.stdout.trim()).toBe('1');
    // glob: true skips the names-first reading.
    const forced = runBuiltin(
      {
        check: 'not_contains',
        params: { path: 'r/[slug]/*.ts', pattern: 'FORBIDDEN', glob: true },
      },
      dir,
    );
    expect(forced.exitCode).toBe(0);
  });

  it('exists needs a FILE: a directory or a symlinked directory is not one (F-021, F-E)', () => {
    const dir = setup();
    mkdirSync(join(dir, 'r/9-dir'), { recursive: true });
    symlinkSync(join(dir, 'r/9-dir'), join(dir, 'r/8-link'));
    write(dir, 'r/i.tsx', 'x\n');
    for (const p of ['r/[0-9]-dir', 'r/[8]-link', 'r/9-dir']) {
      expect(
        runBuiltin({ check: 'exists', params: { path: p } }, dir).exitCode,
        p,
      ).toBe(1);
    }
    expect(
      runBuiltin({ check: 'exists', params: { path: 'r/[i].tsx' } }, dir)
        .exitCode,
    ).toBe(0);
  });

  it('a single-file check refuses a glob matching several files, naming them', () => {
    const dir = setup();
    write(dir, 'm/1-AddFoo.ts', 'ready\n');
    write(dir, 'm/2-AddBar.ts', 'ready\n');
    const several = runBuiltin(
      {
        check: 'done_criteria',
        params: { path: 'm/*Add*.ts', requirements: ['ready'] },
      },
      dir,
    );
    expect(several.exitCode).toBe(1);
    expect(several.stdout).toContain('1-AddFoo.ts');
    expect(several.stdout).toContain('2-AddBar.ts');
    expect(
      runBuiltin(
        {
          check: 'done_criteria',
          params: { path: 'm/*AddFoo*.ts', requirements: ['ready'] },
        },
        dir,
      ).exitCode,
    ).toBe(0);
  });

  it('literal-first holds for done_criteria and not_exists on a bracket name', () => {
    const dir = setup();
    write(dir, 'r/[id].tsx', 'route body\n');
    write(dir, 'r/i.tsx', 'other\n');
    expect(
      runBuiltin(
        {
          check: 'done_criteria',
          params: { path: 'r/[id].tsx', requirements: ['route body'] },
        },
        dir,
      ).exitCode,
    ).toBe(0);
    expect(
      runBuiltin({ check: 'not_exists', params: { path: 'r/[id].tsx' } }, dir)
        .exitCode,
    ).toBe(1);
  });
});
