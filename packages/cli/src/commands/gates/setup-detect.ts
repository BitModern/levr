/**
 * [issue:internal] The command slots `levr gates setup` proposes (plan
 * internal D7), read from the repository's manifests: `package.json`
 * scripts, `Cargo.toml`, `go.mod`, `pyproject.toml` and `composer.json`.
 *
 * Detection only PROPOSES. Every slot is offered unselected and written only
 * after the person confirms it (setupHandler). Each proposal names the gate
 * type it binds and the nested config path its command goes under
 * (`cmd.test.unit` is `{ cmd: { test: { unit } } }`), never a dotted key.
 *
 * Pure apart from the injected `readFile`.
 */

/** The four slots read from the repository's manifests, in the order asked. */
export type ManifestSlotId = 'typecheck' | 'test.unit' | 'test.e2e' | 'lint';

/** Every slot setup offers: the manifest slots, then AST Pattern. */
export type CommandSlotId = ManifestSlotId | 'ast_pattern';

export const COMMAND_SLOT_IDS: readonly ManifestSlotId[] = [
  'typecheck',
  'test.unit',
  'test.e2e',
  'lint',
];

/** The gate type each slot configures. */
export const SLOT_GATE_KEYS: Readonly<Record<CommandSlotId, string>> = {
  typecheck: 'typecheck',
  'test.unit': 'unit_test_pass',
  'test.e2e': 'e2e_test_pass',
  lint: 'lint',
  ast_pattern: 'ast_pattern',
};

export interface SlotProposal {
  slot: CommandSlotId;
  gateKey: string;
  command: string;
  /** Where it came from, for the prompt: `package.json "typecheck"`. */
  source: string;
  /** More config written beside the command (AST Pattern's `params`). */
  extraConfig?: Record<string, unknown>;
}

/** Reads a file under the repository root; null when it does not exist. */
export type ReadRepoFile = (absolutePath: string) => string | null;

function join(root: string, file: string): string {
  return root.endsWith('/') ? `${root}${file}` : `${root}/${file}`;
}

/** The first script name present, in preference order. */
function firstScript(
  scripts: Record<string, unknown>,
  names: readonly string[],
): string | null {
  for (const name of names) {
    if (typeof scripts[name] === 'string' && scripts[name] !== '') return name;
  }
  return null;
}

const SCRIPT_NAMES: Readonly<Record<ManifestSlotId, readonly string[]>> = {
  typecheck: ['typecheck', 'type-check', 'check-types', 'tsc'],
  'test.unit': ['test:unit', 'unit', 'test'],
  'test.e2e': ['test:e2e', 'e2e'],
  lint: ['lint'],
};

function packageRunner(root: string, read: ReadRepoFile): string {
  if (read(join(root, 'pnpm-lock.yaml')) != null) return 'pnpm run';
  if (read(join(root, 'yarn.lock')) != null) return 'yarn run';
  if (
    read(join(root, 'bun.lockb')) != null ||
    read(join(root, 'bun.lock')) != null
  ) {
    return 'bun run';
  }
  return 'npm run';
}

function fromPackageJson(root: string, read: ReadRepoFile): SlotProposal[] {
  const text = read(join(root, 'package.json'));
  if (text == null) return [];
  let scripts: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text) as { scripts?: unknown };
    if (
      !parsed.scripts ||
      typeof parsed.scripts !== 'object' ||
      Array.isArray(parsed.scripts)
    ) {
      return [];
    }
    scripts = parsed.scripts as Record<string, unknown>;
  } catch {
    return [];
  }
  const runner = packageRunner(root, read);
  const out: SlotProposal[] = [];
  for (const slot of COMMAND_SLOT_IDS) {
    const name = firstScript(scripts, SCRIPT_NAMES[slot]);
    if (!name) continue;
    out.push({
      slot,
      gateKey: SLOT_GATE_KEYS[slot],
      command: `${runner} ${name}`,
      source: `package.json "${name}"`,
    });
  }
  return out;
}

function fromComposerJson(root: string, read: ReadRepoFile): SlotProposal[] {
  const text = read(join(root, 'composer.json'));
  if (text == null) return [];
  let scripts: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text) as { scripts?: unknown };
    if (!parsed.scripts || typeof parsed.scripts !== 'object') return [];
    scripts = parsed.scripts as Record<string, unknown>;
  } catch {
    return [];
  }
  const out: SlotProposal[] = [];
  const names: Readonly<Record<ManifestSlotId, readonly string[]>> = {
    typecheck: ['phpstan', 'analyse', 'psalm', 'typecheck'],
    'test.unit': ['test:unit', 'test'],
    'test.e2e': ['test:e2e', 'e2e'],
    lint: ['lint', 'cs'],
  };
  for (const slot of COMMAND_SLOT_IDS) {
    // composer scripts may be a string or an array of commands.
    const name = names[slot].find((n) => scripts[n] != null);
    if (!name) continue;
    out.push({
      slot,
      gateKey: SLOT_GATE_KEYS[slot],
      command: `composer run-script ${name}`,
      source: `composer.json "${name}"`,
    });
  }
  return out;
}

function fromCargoToml(root: string, read: ReadRepoFile): SlotProposal[] {
  if (read(join(root, 'Cargo.toml')) == null) return [];
  const locked = read(join(root, 'Cargo.lock')) != null ? ' --locked' : '';
  const source = 'Cargo.toml';
  return [
    {
      slot: 'typecheck',
      gateKey: SLOT_GATE_KEYS.typecheck,
      command: `cargo check --workspace${locked}`,
      source,
    },
    {
      slot: 'test.unit',
      gateKey: SLOT_GATE_KEYS['test.unit'],
      command: `cargo test --workspace${locked}`,
      source,
    },
    {
      slot: 'lint',
      gateKey: SLOT_GATE_KEYS.lint,
      command: `cargo clippy --workspace --all-targets${locked} -- -D warnings`,
      source,
    },
  ];
}

function fromGoMod(root: string, read: ReadRepoFile): SlotProposal[] {
  if (read(join(root, 'go.mod')) == null) return [];
  const source = 'go.mod';
  return [
    {
      slot: 'typecheck',
      gateKey: SLOT_GATE_KEYS.typecheck,
      command: 'go build ./...',
      source,
    },
    {
      slot: 'test.unit',
      gateKey: SLOT_GATE_KEYS['test.unit'],
      command: 'go test ./...',
      source,
    },
    {
      slot: 'lint',
      gateKey: SLOT_GATE_KEYS.lint,
      command: 'go vet ./...',
      source,
    },
  ];
}

function fromPyproject(root: string, read: ReadRepoFile): SlotProposal[] {
  const text = read(join(root, 'pyproject.toml'));
  if (text == null) return [];
  const runner =
    read(join(root, 'uv.lock')) != null
      ? 'uv run'
      : read(join(root, 'poetry.lock')) != null
        ? 'poetry run'
        : 'python -m';
  const mentions = (tool: string) =>
    new RegExp(`\\b${tool}\\b`, 'i').test(text);
  const source = 'pyproject.toml';
  const out: SlotProposal[] = [];
  if (mentions('mypy')) {
    out.push({
      slot: 'typecheck',
      gateKey: SLOT_GATE_KEYS.typecheck,
      command: `${runner} mypy .`,
      source,
    });
  }
  if (mentions('pytest')) {
    out.push({
      slot: 'test.unit',
      gateKey: SLOT_GATE_KEYS['test.unit'],
      command: `${runner} pytest`,
      source,
    });
  }
  if (mentions('ruff')) {
    out.push({
      slot: 'lint',
      gateKey: SLOT_GATE_KEYS.lint,
      command: `${runner} ruff check .`,
      source,
    });
  }
  return out;
}

/**
 * The command slots the repository's manifests suggest, one proposal per slot
 * at most (the first manifest that has one wins, in the order package.json,
 * Cargo.toml, go.mod, pyproject.toml, composer.json), in slot order.
 */
export function detectCommandSlots(
  root: string,
  readFile: ReadRepoFile,
): SlotProposal[] {
  const all = [
    ...fromPackageJson(root, readFile),
    ...fromCargoToml(root, readFile),
    ...fromGoMod(root, readFile),
    ...fromPyproject(root, readFile),
    ...fromComposerJson(root, readFile),
  ];
  const out: SlotProposal[] = [];
  for (const slot of COMMAND_SLOT_IDS) {
    const first = all.find((p) => p.slot === slot);
    if (first) out.push(first);
  }
  return out;
}

/**
 * The NESTED config a slot's command goes under: `test.unit` is
 * `{ cmd: { test: { unit: command } } }`. A dotted key is refused by the
 * binding validator and never read, so it is never written.
 */
export function slotConfig(
  slot: CommandSlotId,
  command: string,
): Record<string, unknown> {
  const path = slot.split('.');
  let node: Record<string, unknown> = { [path[path.length - 1]!]: command };
  for (let i = path.length - 2; i >= 0; i--) node = { [path[i]!]: node };
  return { cmd: node };
}

/**
 * [issue:internal] The ast-grep language a repository's manifest names, for
 * AST Pattern's default (`params.ast_pattern.language`). None for a
 * `package.json` repository: the gate type already defaults to TypeScript
 * and Tsx. None when manifests disagree, rather than a guess.
 */
export function detectAstGrepLanguage(
  root: string,
  read: ReadRepoFile,
): string | null {
  const has = (f: string) => read(join(root, f)) != null;
  if (has('package.json')) return null;
  const found = [
    has('Cargo.toml') ? 'Rust' : null,
    has('go.mod') ? 'Go' : null,
    has('pyproject.toml') || has('setup.py') || has('requirements.txt')
      ? 'Python'
      : null,
    has('pom.xml') || has('build.gradle') || has('build.gradle.kts')
      ? 'Java'
      : null,
  ].filter((l): l is string => l !== null);
  return found.length === 1 ? found[0]! : null;
}

/** Counts ast-grep's JSON matches and fails below `{min_matches}`. */
const MATCH_COUNTERS: ReadonlyArray<[bin: string, command: string]> = [
  [
    'node',
    `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const n=JSON.parse(s).length;if(n<{min_matches})process.exit(1);console.log('PASS '+n)})"`,
  ],
  [
    'python3',
    `python3 -c "import json,sys;n=len(json.load(sys.stdin));print('PASS',n);sys.exit(0 if n>={min_matches} else 1)"`,
  ],
  ['jq', `jq -e 'length >= {min_matches}'`],
];

/** Why AST Pattern was not offered, for one line of guidance. */
export type AstPatternMissing = 'no-ast-grep' | 'no-counter';

/**
 * [issue:internal] The AST Pattern slot (`cmd.ast_pattern`), proposed when
 * ast-grep is installed: from the repository's `node_modules` (run with
 * `npx --no-install`, so a checkout without it fails rather than fetching a
 * package of the same name) or on the PATH (Homebrew, cargo, pip). Its
 * matches are counted with the first of node, python3 or jq on the PATH.
 * Offered unselected, like every slot.
 */
export function detectAstPatternSlot(
  root: string,
  read: ReadRepoFile,
  which: (bin: string) => boolean,
): SlotProposal | AstPatternMissing {
  const local =
    read(join(root, 'node_modules/@ast-grep/cli/package.json')) != null;
  const runner = local
    ? 'npx --no-install ast-grep'
    : which('ast-grep')
      ? 'ast-grep'
      : null;
  if (runner === null) return 'no-ast-grep';
  const counter = MATCH_COUNTERS.find(([bin]) => which(bin));
  if (!counter) return 'no-counter';
  const language = detectAstGrepLanguage(root, read);
  return {
    slot: 'ast_pattern',
    gateKey: SLOT_GATE_KEYS.ast_pattern,
    command: `${runner} scan --inline-rules {rule} --json {path} | ${counter[1]}`,
    source: local
      ? 'node_modules/@ast-grep/cli'
      : `ast-grep on the PATH${language ? `, ${language}` : ''}`,
    ...(language
      ? { extraConfig: { params: { ast_pattern: { language } } } }
      : {}),
  };
}
