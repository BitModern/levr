/**
 * [issue:internal] Manifest detection for `levr gates setup` (plan internal
 * D7): which command slots each manifest suggests, and the nested config a
 * slot is written under.
 */
import { parsePayload, validatePayload } from '@levr/shared';
import { describe, expect, it } from 'vitest';

import { validateGateCommand } from '@levr/shared';
import {
  detectAstPatternSlot,
  detectCommandSlots,
  slotConfig,
  type SlotProposal,
} from './setup-detect.js';

const ROOT = '/r';

const reader =
  (files: Record<string, string>) =>
  (p: string): string | null =>
    files[p] ?? null;

const slots = (ps: SlotProposal[]) =>
  ps.map((p) => [p.slot, p.gateKey, p.command]);

describe('detectCommandSlots', () => {
  it('package.json scripts typecheck and test propose exactly those two', () => {
    const found = detectCommandSlots(
      ROOT,
      reader({
        '/r/package.json': JSON.stringify({
          scripts: {
            typecheck: 'tsc --noEmit',
            test: 'vitest run',
            dev: 'vite',
          },
        }),
      }),
    );
    expect(slots(found)).toEqual([
      ['typecheck', 'typecheck', 'npm run typecheck'],
      ['test.unit', 'unit_test_pass', 'npm run test'],
    ]);
    expect(found[0]!.source).toBe('package.json "typecheck"');
  });

  it('prefers test:unit over test, and finds test:e2e and lint; the lockfile picks the runner', () => {
    const found = detectCommandSlots(
      ROOT,
      reader({
        '/r/package.json': JSON.stringify({
          scripts: {
            test: 'vitest',
            'test:unit': 'vitest run',
            'test:e2e': 'playwright test',
            lint: 'eslint .',
          },
        }),
        '/r/yarn.lock': '',
      }),
    );
    expect(slots(found)).toEqual([
      ['test.unit', 'unit_test_pass', 'yarn run test:unit'],
      ['test.e2e', 'e2e_test_pass', 'yarn run test:e2e'],
      ['lint', 'lint', 'yarn run lint'],
    ]);
  });

  it('pnpm and bun lockfiles pick their runner', () => {
    for (const [lock, runner] of [
      ['pnpm-lock.yaml', 'pnpm run'],
      ['bun.lock', 'bun run'],
    ] as const) {
      const found = detectCommandSlots(
        ROOT,
        reader({
          '/r/package.json': JSON.stringify({ scripts: { lint: 'x' } }),
          [`/r/${lock}`]: '',
        }),
      );
      expect(found[0]!.command).toBe(`${runner} lint`);
    }
  });

  it('Cargo.toml proposes check, test and clippy, locked when Cargo.lock exists', () => {
    const found = detectCommandSlots(
      ROOT,
      reader({ '/r/Cargo.toml': '[package]', '/r/Cargo.lock': '' }),
    );
    expect(slots(found)).toEqual([
      ['typecheck', 'typecheck', 'cargo check --workspace --locked'],
      ['test.unit', 'unit_test_pass', 'cargo test --workspace --locked'],
      [
        'lint',
        'lint',
        'cargo clippy --workspace --all-targets --locked -- -D warnings',
      ],
    ]);
  });

  it('go.mod proposes build, test and vet', () => {
    expect(
      slots(detectCommandSlots(ROOT, reader({ '/r/go.mod': 'module x' }))),
    ).toEqual([
      ['typecheck', 'typecheck', 'go build ./...'],
      ['test.unit', 'unit_test_pass', 'go test ./...'],
      ['lint', 'lint', 'go vet ./...'],
    ]);
  });

  it('pyproject.toml proposes only the tools it mentions, through uv when uv.lock exists', () => {
    const found = detectCommandSlots(
      ROOT,
      reader({
        '/r/pyproject.toml': '[tool.pytest.ini_options]\n[tool.ruff]\n',
        '/r/uv.lock': '',
      }),
    );
    expect(slots(found)).toEqual([
      ['test.unit', 'unit_test_pass', 'uv run pytest'],
      ['lint', 'lint', 'uv run ruff check .'],
    ]);
  });

  it('composer.json scripts', () => {
    const found = detectCommandSlots(
      ROOT,
      reader({
        '/r/composer.json': JSON.stringify({
          scripts: { test: 'phpunit', phpstan: 'phpstan analyse' },
        }),
      }),
    );
    expect(slots(found)).toEqual([
      ['typecheck', 'typecheck', 'composer run-script phpstan'],
      ['test.unit', 'unit_test_pass', 'composer run-script test'],
    ]);
  });

  it('one proposal per slot: the first manifest wins', () => {
    const found = detectCommandSlots(
      ROOT,
      reader({
        '/r/package.json': JSON.stringify({ scripts: { test: 'vitest' } }),
        '/r/go.mod': 'module x',
      }),
    );
    expect(found.filter((p) => p.slot === 'test.unit')).toHaveLength(1);
    expect(found.find((p) => p.slot === 'test.unit')!.command).toBe(
      'npm run test',
    );
  });

  it('no manifest, or a package.json that does not parse, proposes nothing', () => {
    expect(detectCommandSlots(ROOT, reader({}))).toEqual([]);
    expect(
      detectCommandSlots(ROOT, reader({ '/r/package.json': '{ nope' })),
    ).toEqual([]);
  });

  it('every proposal passes the gate command validator as a nested binding', () => {
    const found = detectCommandSlots(
      ROOT,
      reader({
        '/r/package.json': JSON.stringify({
          scripts: { typecheck: 'a', test: 'b', 'test:e2e': 'c', lint: 'd' },
        }),
        '/r/Cargo.toml': '',
        '/r/pyproject.toml': 'mypy pytest ruff',
        '/r/composer.json': JSON.stringify({ scripts: { test: 'x' } }),
      }),
    );
    const others = [
      ...detectCommandSlots(ROOT, reader({ '/r/Cargo.toml': '' })),
      ...detectCommandSlots(ROOT, reader({ '/r/go.mod': '' })),
      ...detectCommandSlots(
        ROOT,
        reader({ '/r/pyproject.toml': 'mypy pytest ruff' }),
      ),
      ...detectCommandSlots(
        ROOT,
        reader({
          '/r/composer.json': JSON.stringify({
            scripts: { test: 'x', phpstan: 'y', lint: 'z' },
          }),
        }),
      ),
    ];
    for (const p of [...found, ...others]) {
      const payload = parsePayload({
        bindings: [
          { gate_key: p.gateKey, config: slotConfig(p.slot, p.command) },
        ],
      });
      expect(() => validatePayload(payload), p.command).not.toThrow();
    }
  });
});

describe('slotConfig', () => {
  it('nests a dotted slot and never writes a dotted key', () => {
    expect(slotConfig('test.unit', 'go test ./...')).toEqual({
      cmd: { test: { unit: 'go test ./...' } },
    });
    expect(slotConfig('typecheck', 'tsc')).toEqual({
      cmd: { typecheck: 'tsc' },
    });
  });
});

describe('detectAstPatternSlot (internal)', () => {
  const onPath =
    (...bins: string[]) =>
    (b: string) =>
      bins.includes(b);

  it('ast-grep in node_modules: npx --no-install, counted with node, no language for a package.json repo', () => {
    const p = detectAstPatternSlot(
      ROOT,
      reader({
        '/r/package.json': '{}',
        '/r/node_modules/@ast-grep/cli/package.json': '{}',
      }),
      onPath('node'),
    );
    if (typeof p === 'string') throw new Error(p);
    expect(p.slot).toBe('ast_pattern');
    expect(p.gateKey).toBe('ast_pattern');
    expect(p.command).toMatch(
      /^npx --no-install ast-grep scan --inline-rules \{rule\} --json \{path\} \| node -e /,
    );
    expect(p.extraConfig).toBeUndefined();
  });

  it.each([
    ['Cargo.toml', 'Rust'],
    ['go.mod', 'Go'],
    ['pyproject.toml', 'Python'],
    ['pom.xml', 'Java'],
  ])('ast-grep on the PATH in a %s repo sets language %s', (file, language) => {
    const p = detectAstPatternSlot(
      ROOT,
      reader({ [`/r/${file}`]: '' }),
      onPath('ast-grep', 'python3'),
    );
    if (typeof p === 'string') throw new Error(p);
    expect(p.command).toMatch(/^ast-grep scan .*\| python3 -c /);
    expect(p.extraConfig).toEqual({
      params: { ast_pattern: { language } },
    });
  });

  it('two manifests that disagree set no language rather than guess', () => {
    const p = detectAstPatternSlot(
      ROOT,
      reader({ '/r/Cargo.toml': '', '/r/go.mod': '' }),
      onPath('ast-grep', 'jq'),
    );
    if (typeof p === 'string') throw new Error(p);
    expect(p.command).toMatch(/\| jq -e 'length >= \{min_matches\}'$/);
    expect(p.extraConfig).toBeUndefined();
  });

  it('says why it is not offered', () => {
    expect(detectAstPatternSlot(ROOT, reader({}), onPath('node'))).toBe(
      'no-ast-grep',
    );
    expect(detectAstPatternSlot(ROOT, reader({}), onPath('ast-grep'))).toBe(
      'no-counter',
    );
  });

  it('every proposed command passes the server gate-command allowlist', () => {
    const cases: Array<[Record<string, string>, string[]]> = [
      [{ '/r/node_modules/@ast-grep/cli/package.json': '{}' }, ['node']],
      [{}, ['ast-grep', 'node']],
      [{}, ['ast-grep', 'python3']],
      [{}, ['ast-grep', 'jq']],
    ];
    for (const [files, bins] of cases) {
      const p = detectAstPatternSlot(ROOT, reader(files), onPath(...bins));
      if (typeof p === 'string') throw new Error(p);
      // As the resolver renders it: the rule quoted, the rest filled in.
      const rendered = p.command
        .replace('{rule}', "'id: x'")
        .replace('{path}', 'src')
        .replace('{min_matches}', '1');
      expect(validateGateCommand(rendered, 'structure'), rendered).toBeNull();
    }
  });

  it('its config passes the binding payload validator', () => {
    const p = detectAstPatternSlot(
      ROOT,
      reader({ '/r/go.mod': '' }),
      onPath('ast-grep', 'node'),
    );
    if (typeof p === 'string') throw new Error(p);
    const config = { ...slotConfig(p.slot, p.command), ...p.extraConfig };
    expect(() =>
      validatePayload(
        parsePayload({ bindings: [{ gate_key: p.gateKey, config }] }),
      ),
    ).not.toThrow();
  });
});
