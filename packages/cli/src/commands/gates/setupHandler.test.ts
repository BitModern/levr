/**
 * [issue:internal] `levr gates setup` (plan internal D7), driven through
 * injected dependencies: git and ssh are stubs, PATH is a predicate, the
 * prompts are scripted, and every assertion is on what would reach the
 * server: which call, with which payload, with or without dry_run and
 * replace_judge.
 */
import { buildJudgeSetupPrompt, JUDGE_GATE_KEYS } from '@levr/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  executeGatesSetup,
  gatesSetupStatus,
  OWNER_ADMIN_MESSAGE,
  type SetupDeps,
  type SetupFlags,
  type SetupPrompts,
  type SetupReply,
} from './setupHandler.js';

const ROOT = '/work/api';

interface Stored {
  gate_key: string;
  repo_key?: string;
  path_prefix?: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

interface PayloadEntry {
  gate_key: string;
  repo_key?: string | null;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

interface Payload {
  bindings: PayloadEntry[];
}

interface ImportCall {
  payload: Payload;
  dryRun: boolean;
  replaceJudge: boolean;
}

type Answer = string | string[] | boolean | null;

/**
 * Scripted prompts: each call takes the next answer for its kind. A prompt
 * with no scripted answer fails the test, so an unexpected question is seen.
 */
function scripted(answers: {
  select?: Answer[];
  multiselect?: Answer[];
  confirm?: Answer[];
  text?: Answer[];
}) {
  const queue = {
    select: [...(answers.select ?? [])],
    multiselect: [...(answers.multiselect ?? [])],
    confirm: [...(answers.confirm ?? [])],
    text: [...(answers.text ?? [])],
  };
  const take = (kind: keyof typeof queue, message: string) => {
    if (queue[kind].length === 0) {
      throw new Error(`unexpected ${kind} prompt: ${message}`);
    }
    return queue[kind].shift();
  };
  const prompts = {
    select: vi.fn((o: { message: string }) =>
      Promise.resolve(take('select', o.message) as string | null),
    ),
    multiselect: vi.fn((o: { message: string }) =>
      Promise.resolve(take('multiselect', o.message) as string[] | null),
    ),
    confirm: vi.fn((o: { message: string }) =>
      Promise.resolve(take('confirm', o.message) as boolean | null),
    ),
    text: vi.fn((o: { message: string }) =>
      Promise.resolve(take('text', o.message) as string | null),
    ),
  };
  return prompts as unknown as SetupPrompts & typeof prompts;
}

/** What the planner would say for each row, as the server does. */
function plan(
  payload: Payload,
  stored: Stored[],
  dryRun: boolean,
  replaceJudge: boolean,
) {
  return {
    dry_run: dryRun,
    definitions: [],
    bindings: payload.bindings.map((b) => {
      const row = stored.find(
        (s) =>
          s.gate_key === b.gate_key &&
          (s.repo_key ?? null) === (b.repo_key ?? null),
      );
      let action = 'create';
      if (row) {
        const same =
          JSON.stringify(row.config) === JSON.stringify(b.config ?? {}) &&
          row.enabled === (b.enabled !== false);
        action = same
          ? 'exists'
          : replaceJudge &&
              (JUDGE_GATE_KEYS as readonly string[]).includes(b.gate_key)
            ? 'replace'
            : 'differs';
      }
      return {
        gate_key: b.gate_key,
        repo_key: b.repo_key ?? null,
        path_prefix: null,
        action,
        applied: !dryRun && ['create', 'replace'].includes(action),
        // [issue:internal] the server names each gate type's technique.
        ...((JUDGE_GATE_KEYS as readonly string[]).includes(b.gate_key)
          ? { technique: 'semantic' }
          : {}),
      };
    }),
  };
}

interface Fixture {
  remote?: string | null;
  inRepo?: boolean;
  onPath?: string[];
  files?: Record<string, string>;
  stored?: Stored[];
  /** The resolve reply; the second call (the read-back) reuses it unless set. */
  resolve?: SetupReply;
  resolveAgain?: SetupReply;
  create?: SetupReply;
  importReply?: (call: ImportCall) => SetupReply | undefined;
  /** What export returns AFTER the write; defaults to stored + written. */
  readBack?: (written: Payload) => Stored[];
  exportStatus?: number;
  prompts?: SetupPrompts;
  ssh?: (args: readonly string[]) => { code: number; stdout: string };
}

function fixture(f: Fixture = {}) {
  const stored = f.stored ?? [];
  const imports: ImportCall[] = [];
  let written: Payload | null = null;
  let resolveCalls = 0;
  const remote =
    f.remote === undefined ? 'git@github.com:acme/api.git' : f.remote;
  const git = vi.fn((args: readonly string[]) => {
    if (f.inRepo === false) {
      return { code: 128, stdout: '' };
    }
    if (args.join(' ') === 'rev-parse --show-toplevel') {
      return { code: 0, stdout: `${ROOT}\n` };
    }
    if (args.join(' ') === 'remote get-url origin') {
      return remote
        ? { code: 0, stdout: `${remote}\n` }
        : { code: 2, stdout: '' };
    }
    return { code: 1, stdout: '' };
  });
  const onPath = new Set(f.onPath ?? []);
  const files = f.files ?? {};
  const deps: SetupDeps = {
    cwd: ROOT,
    git,
    ssh: vi.fn(f.ssh ?? (() => ({ code: 255, stdout: '' }))),
    which: (bin) => onPath.has(bin),
    readFile: (p) => files[p] ?? null,
    prompts: f.prompts ?? scripted({}),
    resolveRemote: vi.fn(() => {
      resolveCalls += 1;
      const first = f.resolve ?? { status: 200, body: { repository: null } };
      return Promise.resolve(
        resolveCalls > 1 && f.resolveAgain ? f.resolveAgain : first,
      );
    }),
    createRepository: vi.fn(() =>
      Promise.resolve(f.create ?? { status: 201, body: {} }),
    ),
    exportConfig: vi.fn(() => {
      if (f.exportStatus && f.exportStatus !== 200) {
        return Promise.resolve({
          status: f.exportStatus,
          body: { message: 'Forbidden' },
        });
      }
      const bindings = written
        ? (f.readBack?.(written) ?? [
            ...stored.filter(
              (s) =>
                !written!.bindings.some(
                  (w) =>
                    w.gate_key === s.gate_key &&
                    (w.repo_key ?? null) === (s.repo_key ?? null),
                ),
            ),
            ...written.bindings.map((w) => ({
              gate_key: w.gate_key,
              ...(w.repo_key ? { repo_key: w.repo_key } : {}),
              enabled: w.enabled !== false,
              config: w.config ?? {},
            })),
          ])
        : stored;
      return Promise.resolve({
        status: 200,
        body: { definitions: [], bindings },
      });
    }),
    importConfig: vi.fn(
      (payload: unknown, opts: { dryRun: boolean; replaceJudge: boolean }) => {
        const call: ImportCall = {
          payload: payload as Payload,
          dryRun: opts.dryRun,
          replaceJudge: opts.replaceJudge,
        };
        imports.push(call);
        const custom = f.importReply?.(call);
        if (custom) return Promise.resolve(custom);
        if (!opts.dryRun) written = call.payload;
        return Promise.resolve({
          status: 200,
          body: plan(call.payload, stored, opts.dryRun, opts.replaceJudge),
        });
      },
    ),
  };
  return { deps, imports, git };
}

const flags = (over: Partial<SetupFlags> = {}): SetupFlags => ({
  'dry-run': false,
  yes: false,
  ...over,
});

const judgeEntries = (p: Payload) =>
  p.bindings.filter((b) =>
    (JUDGE_GATE_KEYS as readonly string[]).includes(b.gate_key),
  );

describe('levr gates setup', () => {
  it('outside a git repo exits 2 with the cd message and calls nothing', async () => {
    const { deps } = fixture({ inRepo: false });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain('cd into one of your repos');
    expect(deps.exportConfig).not.toHaveBeenCalled();
    expect(deps.importConfig).not.toHaveBeenCalled();
  });

  it('offers AST pattern when ast-grep is on the PATH, unchecked, and writes its command with the repo language', async () => {
    const prompts = scripted({
      // Check AST pattern only; edit none. Create: no; apply: yes.
      multiselect: [['ast_pattern'], []],
      confirm: [false, true],
    });
    const { deps, imports } = fixture({
      files: { [`${ROOT}/go.mod`]: 'module x' },
      onPath: ['ast-grep', 'node'],
      prompts,
    });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode, out.stderr).toBe(0);
    const [ask] = prompts.multiselect.mock.calls[0]! as unknown as [
      {
        options: Array<{ value: string; label: string }>;
        initialValues?: unknown;
      },
    ];
    const ast = ask.options.find((o) => o.value === 'ast_pattern');
    expect(ast?.label).toContain('AST pattern (ast_pattern): ast-grep scan');
    expect(ask.initialValues).toEqual([]);
    const applied = imports.find((c) => !c.dryRun)!;
    const row = applied.payload.bindings.find(
      (b) => b.gate_key === 'ast_pattern',
    );
    const config = row?.config as
      | { cmd?: { ast_pattern?: string }; params?: unknown }
      | undefined;
    expect(config?.cmd?.ast_pattern).toMatch(
      /^ast-grep scan --inline-rules \{rule\}/,
    );
    expect(config?.params).toEqual({ ast_pattern: { language: 'Go' } });
  });

  it('without ast-grep, says AST pattern is not offered and how to install it', async () => {
    const prompts = scripted({ confirm: [false] });
    const { deps } = fixture({ onPath: ['node'], prompts });
    const out = await executeGatesSetup(flags({ 'dry-run': true }), deps);
    expect(out.stdout).toContain(
      'AST pattern: not offered, ast-grep is not installed',
    );
  });

  it('proposes the package.json scripts in a multiselect with nothing checked, and writes only the checked slot, nested', async () => {
    const prompts = scripted({
      // Check typecheck only; edit none. Create: no; apply: yes.
      multiselect: [['typecheck'], []],
      confirm: [false, true],
    });
    const { deps, imports } = fixture({
      files: {
        [`${ROOT}/package.json`]: JSON.stringify({
          scripts: { typecheck: 'tsc --noEmit', test: 'vitest run' },
        }),
      },
      prompts,
    });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode, out.stderr).toBe(0);
    expect(prompts.select).not.toHaveBeenCalled();

    // Exactly the two scripts are offered, and nothing is pre-selected.
    const [ask] = prompts.multiselect.mock.calls[0]! as unknown as [
      {
        options: Array<{ value: string; label: string }>;
        initialValues?: unknown;
        initialValue?: unknown;
        required?: unknown;
      },
    ];
    expect(ask.options.map((o) => o.value)).toEqual(['typecheck', 'test.unit']);
    expect(ask.options[0]!.label).toContain('npm run typecheck');
    expect(ask.options[1]!.label).toContain('npm run test');
    expect(ask.initialValues).toEqual([]);
    expect(ask).not.toHaveProperty('initialValue');
    expect(ask.required).toBe(false);

    const applied = imports.find((c) => !c.dryRun)!;
    expect(applied.payload.bindings).toEqual([
      {
        gate_key: 'typecheck',
        enabled: true,
        config: { cmd: { typecheck: 'npm run typecheck' } },
      },
    ]);
    // Never the flat dotted form.
    expect(JSON.stringify(applied.payload)).not.toContain('"cmd.typecheck"');
    // The unchecked slot is not in the payload at all.
    expect(JSON.stringify(applied.payload)).not.toContain('unit_test_pass');
  });

  it('detected slots: an immediate Enter (nothing checked) writes no slot', async () => {
    // Nothing checked; no edit question follows. Create: no.
    const prompts = scripted({ multiselect: [[]], confirm: [false] });
    const { deps } = fixture({
      onPath: [],
      files: {
        [`${ROOT}/package.json`]: JSON.stringify({
          scripts: { typecheck: 'tsc --noEmit', lint: 'eslint .' },
        }),
      },
      prompts,
    });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode, out.stderr).toBe(0);
    expect(prompts.multiselect).toHaveBeenCalledOnce();
    expect(out.stdout).toContain('Nothing to write');
    expect(deps.importConfig).not.toHaveBeenCalled();
  });

  it('detected slots: one checked slot is written, with a judge alongside', async () => {
    const prompts = scripted({
      multiselect: [['lint'], []],
      confirm: [false, true],
    });
    const { deps, imports } = fixture({
      onPath: ['codex'],
      files: {
        [`${ROOT}/package.json`]: JSON.stringify({
          scripts: { typecheck: 'tsc --noEmit', lint: 'eslint .' },
        }),
      },
      prompts,
    });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode, out.stderr).toBe(0);
    const written = imports.find((c) => !c.dryRun)!.payload.bindings;
    expect(written.map((b) => b.gate_key)).toEqual([
      ...JUDGE_GATE_KEYS,
      'lint',
    ]);
    expect(written.at(-1)!.config).toEqual({ cmd: { lint: 'npm run lint' } });
  });

  it('a cancelled slot choice exits 130 with no bindings written', async () => {
    const prompts = scripted({ multiselect: [null], confirm: [false] });
    const { deps } = fixture({
      files: {
        [`${ROOT}/package.json`]: JSON.stringify({
          scripts: { lint: 'eslint .' },
        }),
      },
      prompts,
    });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode).toBe(130);
    expect(deps.importConfig).not.toHaveBeenCalled();
  });

  it('an edited slot writes the edited command', async () => {
    // Check typecheck; then explicitly choose to edit it, nothing pre-checked.
    const prompts = scripted({
      multiselect: [['typecheck'], ['typecheck']],
      text: ['npm run typecheck -- --pretty false'],
      confirm: [false, true],
    });
    const { deps, imports } = fixture({
      files: {
        [`${ROOT}/package.json`]: JSON.stringify({
          scripts: { typecheck: 'tsc --noEmit' },
        }),
      },
      prompts,
    });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode, out.stderr).toBe(0);
    const [, editAsk] = prompts.multiselect.mock.calls.map(
      ([o]) => o as unknown as { initialValues?: unknown; required?: unknown },
    );
    expect(editAsk!.initialValues).toEqual([]);
    expect(editAsk!.required).toBe(false);
    expect(imports.find((c) => !c.dryRun)!.payload.bindings[0]!.config).toEqual(
      { cmd: { typecheck: 'npm run typecheck -- --pretty false' } },
    );
  });

  it('one judge on PATH is used, and setup says so', async () => {
    const prompts = scripted({ confirm: [false, true] });
    const { deps, imports } = fixture({ onPath: ['claude'], prompts });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode, out.stderr).toBe(0);
    expect(out.stdout).toContain('Judge: claude');
    expect(prompts.select).not.toHaveBeenCalled();
    const judges = judgeEntries(imports.find((c) => !c.dryRun)!.payload);
    expect(judges.map((b) => b.gate_key)).toEqual([...JUDGE_GATE_KEYS]);
    for (const b of judges) expect(b.config).toEqual({ judge: 'claude' });
  });

  it('two judges on PATH prompt with no default: a multiselect with nothing pre-selected', async () => {
    // Toggle codex, then Enter. Create: no; apply: yes.
    const prompts = scripted({
      multiselect: [['codex']],
      confirm: [false, true],
    });
    const { deps, imports } = fixture({ onPath: ['codex', 'claude'], prompts });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode, out.stderr).toBe(0);
    expect(prompts.select).not.toHaveBeenCalled();
    const [ask] = prompts.multiselect.mock.calls[0]! as unknown as [
      {
        options: Array<{ value: string }>;
        initialValues?: unknown;
        initialValue?: unknown;
        required?: unknown;
      },
    ];
    // Every judge is listed, in the order found, and none is checked.
    expect(ask.options.map((o) => o.value)).toEqual(['codex', 'claude']);
    expect(ask.initialValues).toEqual([]);
    expect(ask).not.toHaveProperty('initialValue');
    expect(ask.required).toBe(false);
    const judges = judgeEntries(imports.find((c) => !c.dryRun)!.payload);
    expect(judges.map((b) => b.gate_key)).toEqual([...JUDGE_GATE_KEYS]);
    for (const b of judges) expect(b.config).toEqual({ judge: 'codex' });
  });

  it('several judges: an immediate Enter (nothing checked) writes no judge binding', async () => {
    // Enter with nothing toggled. Then the lint slot: use, so a payload is
    // sent. Create: no; apply: yes.
    const prompts = scripted({
      multiselect: [[], ['lint'], []],
      confirm: [false, true],
    });
    const { deps, imports } = fixture({
      onPath: ['codex', 'claude'],
      files: {
        [`${ROOT}/package.json`]: JSON.stringify({
          scripts: { lint: 'eslint .' },
        }),
      },
      prompts,
    });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode, out.stderr).toBe(0);
    expect(out.stdout).toContain(
      buildJudgeSetupPrompt({ detected: ['codex', 'claude'] }),
    );
    expect(imports.length).toBeGreaterThan(0);
    for (const call of imports) {
      expect(judgeEntries(call.payload)).toEqual([]);
      expect(call.replaceJudge).toBe(false);
    }
  });

  it('several judges: toggling one judge writes it', async () => {
    const prompts = scripted({
      multiselect: [['claude']],
      confirm: [false, true],
    });
    const { deps, imports } = fixture({
      onPath: ['codex', 'claude', 'grok'],
      prompts,
    });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode, out.stderr).toBe(0);
    expect(out.stdout).toContain('Judge: claude (chosen)');
    for (const b of judgeEntries(imports.find((c) => !c.dryRun)!.payload)) {
      expect(b.config).toEqual({ judge: 'claude' });
    }
  });

  it('several judges: toggling two is refused and asked again', async () => {
    // Two checked: refused with a message, asked again; then one.
    const prompts = scripted({
      multiselect: [['codex', 'claude'], ['claude']],
      confirm: [false, true],
    });
    const { deps, imports } = fixture({ onPath: ['codex', 'claude'], prompts });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode, out.stderr).toBe(0);
    expect(prompts.multiselect).toHaveBeenCalledTimes(2);
    expect(out.stdout).toContain('Choose one judge');
    for (const b of judgeEntries(imports.find((c) => !c.dryRun)!.payload)) {
      expect(b.config).toEqual({ judge: 'claude' });
    }
  });

  it('several judges: a cancelled choice exits 130 with no bindings written', async () => {
    const prompts = scripted({ multiselect: [null], confirm: [false] });
    const { deps } = fixture({ onPath: ['codex', 'claude'], prompts });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode).toBe(130);
    expect(out.stdout).toContain('Gate settings not written');
    expect(deps.importConfig).not.toHaveBeenCalled();
  });

  it('a cancel at the write question exits 130, the D9 wizard convention', async () => {
    // Create: no; then cancel "Write these gate settings?".
    const prompts = scripted({ confirm: [false, null] });
    const { deps, imports } = fixture({ onPath: ['codex'], prompts });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode).toBe(130);
    expect(imports.every((c) => c.dryRun)).toBe(true);
    expect(out.stdout).toContain('Cancelled. Gate settings not written.');
  });

  it('a cancel after adding the repository says only the bindings were not written', async () => {
    // Create the catalogue entry: yes; then cancel the scope question.
    const prompts = scripted({ confirm: [true, null] });
    const { deps } = fixture({
      onPath: ['codex'],
      create: { status: 201, body: { id: 'ref-9', repo_key: 'acme/api' } },
      prompts,
    });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode).toBe(130);
    expect(deps.createRepository).toHaveBeenCalledOnce();
    expect(out.stdout).toContain('Added the repository: acme/api');
    expect(out.stdout).toContain('Gate settings not written');
    expect(out.stdout).not.toContain('Nothing written');
    expect(deps.importConfig).not.toHaveBeenCalled();
  });

  it('streams the scope and the dry run before asking to write', async () => {
    const written: string[] = [];
    let seenAtWrite: string | null = null;
    const confirms = [false, true]; // create: no; write: yes
    const prompts: SetupPrompts = {
      select: () => Promise.reject(new Error('no select expected')),
      multiselect: () => Promise.reject(new Error('no multiselect expected')),
      text: () => Promise.reject(new Error('no text expected')),
      confirm: (o) => {
        if (o.message.startsWith('Write these gate settings')) {
          seenAtWrite = written.join('');
        }
        return Promise.resolve(confirms.shift() ?? null);
      },
    };
    const { deps } = fixture({ onPath: ['codex'], prompts });
    deps.write = (text) => written.push(text);
    deps.writeErr = (text) => written.push(text);
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode, out.stderr).toBe(0);
    expect(seenAtWrite).not.toBeNull();
    expect(seenAtWrite).toContain('Scope: workspace');
    expect(seenAtWrite).toContain('Judge: codex');
    expect(seenAtWrite).toContain('Dry run:');
    expect(seenAtWrite).toMatch(/create\s+spec_conformance/);
    // Streamed text is the whole output, in order, and nothing is lost.
    expect(written.join('')).toContain('Read back');
  });

  it('zero judges writes no judge binding', async () => {
    const prompts = scripted({
      multiselect: [['lint'], []],
      confirm: [false, true],
    });
    const { deps, imports } = fixture({
      onPath: [],
      files: {
        [`${ROOT}/package.json`]: JSON.stringify({
          scripts: { lint: 'eslint .' },
        }),
      },
      prompts,
    });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode, out.stderr).toBe(0);
    // The harness prompt is printed, exactly as the docs carry it.
    expect(out.stdout).toContain(buildJudgeSetupPrompt({ detected: [] }));
    // Every payload sent carries no judge root for any judge key.
    expect(imports.length).toBeGreaterThan(0);
    for (const call of imports) {
      expect(judgeEntries(call.payload)).toEqual([]);
      for (const b of call.payload.bindings) {
        expect(b.config ?? {}).not.toHaveProperty('judge');
      }
    }
  });

  it('a 403 from import prints the Owner/Admin message, not a stack trace', async () => {
    const prompts = scripted({ confirm: [false] });
    const { deps } = fixture({
      onPath: ['codex'],
      prompts,
      importReply: () => ({ status: 403, body: { message: 'Forbidden' } }),
    });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain(OWNER_ADMIN_MESSAGE);
    expect(OWNER_ADMIN_MESSAGE).toContain(
      'Only workspace Owners/Admins can configure gates',
    );
    expect(out.stderr).not.toMatch(/\n\s+at /);
  });

  it('a 403 from export (a Member) prints the Owner/Admin message', async () => {
    const { deps } = fixture({ onPath: ['codex'], exportStatus: 403 });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain(OWNER_ADMIN_MESSAGE);
    expect(deps.importConfig).not.toHaveBeenCalled();
  });

  it('any other API failure prints the error and exits 1', async () => {
    const prompts = scripted({ confirm: [false] });
    const { deps } = fixture({
      onPath: ['codex'],
      prompts,
      importReply: () => ({ status: 400, body: { message: 'row refused' } }),
    });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain('row refused');
  });

  it('--dry-run previews and writes nothing', async () => {
    const prompts = scripted({ confirm: [false] });
    const { deps, imports } = fixture({ onPath: ['codex'], prompts });
    const out = await executeGatesSetup(flags({ 'dry-run': true }), deps);
    expect(out.exitCode, out.stderr).toBe(0);
    expect(imports.every((c) => c.dryRun)).toBe(true);
    expect(out.stdout).toContain('create');
    expect(out.stdout).toContain('Dry run');
  });

  it("the preview names each row's technique and what it sets", async () => {
    const prompts = scripted({ confirm: [false] });
    const { deps } = fixture({ onPath: ['codex'], prompts });
    const out = await executeGatesSetup(flags({ 'dry-run': true }), deps);
    expect(out.exitCode, out.stderr).toBe(0);
    expect(out.stdout).toMatch(
      /create\s+spec_conformance \(semantic\) \[workspace-wide\]\s+judge: codex/,
    );
  });

  it('confirmed judge replace: the dry run shows replace, the write replaces, the read-back shows judge: codex', async () => {
    const stored: Stored[] = JUDGE_GATE_KEYS.map((k) => ({
      gate_key: k,
      enabled: true,
      config: { judge: 'agy' },
    }));
    // Repo scope: no. Replace agy with codex: yes. Apply: yes.
    const prompts = scripted({ confirm: [false, true, true] });
    const { deps, imports } = fixture({ onPath: ['codex'], stored, prompts });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode, out.stderr).toBe(0);
    const replaceAsk = prompts.confirm.mock.calls[1]![0] as { message: string };
    expect(replaceAsk.message).toContain(
      'Replace the existing judge setting (agy) with codex?',
    );
    const preview = imports.find((c) => c.dryRun)!;
    expect(preview.replaceJudge).toBe(true);
    expect(out.stdout).toMatch(/replace\s+spec_conformance/);
    const applied = imports.find((c) => !c.dryRun)!;
    expect(applied.replaceJudge).toBe(true);
    expect(out.stdout).toContain('Read back');
    expect(out.stdout).toContain('judge: codex');
  });

  it('a declined judge replace sends no judge row and no replace_judge', async () => {
    const stored: Stored[] = JUDGE_GATE_KEYS.map((k) => ({
      gate_key: k,
      enabled: false,
      config: {},
    }));
    const prompts = scripted({ confirm: [false, false, true] });
    const { deps, imports } = fixture({ onPath: ['codex'], stored, prompts });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode, out.stderr).toBe(0);
    for (const call of imports) {
      expect(call.replaceJudge).toBe(false);
      expect(judgeEntries(call.payload)).toEqual([]);
    }
  });

  it('read-back mismatch exits 1 naming the slot', async () => {
    const prompts = scripted({
      multiselect: [['typecheck'], []],
      confirm: [false, true],
    });
    const { deps } = fixture({
      files: {
        [`${ROOT}/package.json`]: JSON.stringify({
          scripts: { typecheck: 'tsc --noEmit' },
        }),
      },
      prompts,
      readBack: () => [
        {
          gate_key: 'typecheck',
          enabled: true,
          config: { cmd: { typecheck: 'npm run something-else' } },
        },
      ],
    });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain('read-back mismatch');
    expect(out.stderr).toContain('typecheck');
  });

  it('repo-scoped writes use the repo_key the server returns', async () => {
    const prompts = scripted({ confirm: [true] });
    const { deps, imports } = fixture({
      remote: 'git@github.com:Acme/API.git',
      onPath: ['codex'],
      resolve: {
        status: 200,
        body: {
          repository: {
            repository_ref_id: null,
            github_repository_id: 'gh-1',
            provider: 'github',
            host: null,
            name: 'acme/api',
            repo_key: 'acme/api',
          },
        },
      },
      // The workspace already has a repo-scoped binding for this repo.
      stored: [
        {
          gate_key: 'lint',
          repo_key: 'acme/api',
          enabled: false,
          config: {},
        },
      ],
      prompts,
    });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode, out.stderr).toBe(0);
    expect(out.stdout).toContain('Scope: repository acme/api');
    for (const b of imports.find((c) => !c.dryRun)!.payload.bindings) {
      expect(b.repo_key).toBe('acme/api');
    }
  });

  it('read-back fails when the key reaches no repository', async () => {
    const repository = {
      repository_ref_id: 'ref-1',
      github_repository_id: null,
      provider: 'other',
      host: 'github-work',
      name: 'acme/api',
      repo_key: 'github-work/acme/api',
    };
    // Repo scope: yes (opt in). Apply: yes.
    const prompts = scripted({ confirm: [true, true] });
    const { deps } = fixture({
      remote: 'https://github-work/acme/api.git',
      onPath: ['codex'],
      resolve: { status: 200, body: { repository } },
      resolveAgain: { status: 200, body: { repository: null } },
      prompts,
    });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain('github-work/acme/api');
    expect(out.stderr).toContain('ssh alias');
  });

  it('an unknown remote offers to create a repository entry, asking the provider first', async () => {
    // Not an ssh remote, so no alias question. Provider: gitlab. Create: yes.
    // Repo scope: yes. Apply: yes.
    const prompts = scripted({
      select: ['gitlab'],
      confirm: [true, true, true],
    });
    const { deps, imports } = fixture({
      remote: 'https://git.acme.dev/team/api.git',
      onPath: ['codex'],
      create: {
        status: 201,
        body: { id: 'ref-2', repo_key: 'git.acme.dev/team/api' },
      },
      resolveAgain: {
        status: 200,
        body: {
          repository: {
            repository_ref_id: 'ref-2',
            github_repository_id: null,
            provider: 'gitlab',
            host: 'git.acme.dev',
            name: 'team/api',
            repo_key: 'git.acme.dev/team/api',
          },
        },
      },
      prompts,
    });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode, out.stderr).toBe(0);
    expect(deps.createRepository).toHaveBeenCalledWith(
      'https://git.acme.dev/team/api.git',
      'gitlab',
    );
    for (const b of imports.find((c) => !c.dryRun)!.payload.bindings) {
      expect(b.repo_key).toBe('git.acme.dev/team/api');
    }
  });

  it('a 403 creating the repository entry prints the Owner/Admin message and continues at workspace tier', async () => {
    const prompts = scripted({ confirm: [true, true] });
    const { deps, imports } = fixture({
      remote: 'git@github.com:acme/api.git',
      onPath: ['codex'],
      create: { status: 403, body: { message: 'Forbidden' } },
      prompts,
    });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode, out.stderr).toBe(0);
    expect(out.stderr).toContain(OWNER_ADMIN_MESSAGE);
    expect(out.stdout).toContain('Scope: workspace');
    for (const b of imports.find((c) => !c.dryRun)!.payload.bindings) {
      expect(b.repo_key ?? null).toBeNull();
    }
  });

  it('--yes accepts only what was passed: --judge, and no detected slot', async () => {
    const { deps, imports } = fixture({
      onPath: ['codex', 'claude'],
      files: {
        [`${ROOT}/package.json`]: JSON.stringify({
          scripts: { typecheck: 'tsc --noEmit' },
        }),
      },
    });
    const out = await executeGatesSetup(
      flags({ yes: true, judge: 'claude' }),
      deps,
    );
    expect(out.exitCode, out.stderr).toBe(0);
    const applied = imports.find((c) => !c.dryRun)!;
    expect(applied.payload.bindings.map((b) => b.gate_key)).toEqual([
      ...JUDGE_GATE_KEYS,
    ]);
    expect(out.stdout).toContain('npm run typecheck');
  });

  it('refuses a --judge that is not a preset id', async () => {
    const { deps } = fixture({ onPath: ['codex'] });
    const out = await executeGatesSetup(flags({ judge: 'Codex' }), deps);
    expect(out.exitCode).toBe(2);
    expect(deps.importConfig).not.toHaveBeenCalled();
  });

  it('nothing to write exits 0 and sends nothing', async () => {
    const prompts = scripted({ confirm: [false] });
    const { deps } = fixture({ onPath: [], prompts });
    const out = await executeGatesSetup(flags(), deps);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain('Nothing to write');
    expect(deps.importConfig).not.toHaveBeenCalled();
  });
});

describe('gatesSetupStatus (internal: the wizard does not ask again)', () => {
  const pkg = {
    [`${ROOT}/package.json`]: JSON.stringify({
      scripts: { typecheck: 'tsc --noEmit', lint: 'eslint .' },
    }),
  };

  it('nothing missing when the judge and every detected slot have a setting here', async () => {
    const { deps } = fixture({
      files: pkg,
      stored: [
        {
          gate_key: 'spec_conformance',
          enabled: true,
          config: { judge: 'claude' },
        },
        {
          gate_key: 'typecheck',
          enabled: true,
          config: { cmd: { typecheck: 'x' } },
        },
        { gate_key: 'lint', enabled: true, config: { cmd: { lint: 'y' } } },
      ],
    });
    expect(await gatesSetupStatus(deps)).toEqual({
      missing: [],
      anyConfigured: true,
    });
  });

  it('names what is missing: a disabled placeholder and another repository do not count', async () => {
    const { deps } = fixture({
      files: pkg,
      onPath: ['ast-grep', 'node'],
      stored: [
        {
          gate_key: 'typecheck',
          enabled: true,
          config: { cmd: { typecheck: 'x' } },
        },
        { gate_key: 'lint', enabled: false, config: {} },
        {
          gate_key: 'spec_conformance',
          repo_key: 'other/repo',
          enabled: true,
          config: { judge: 'claude' },
        },
      ],
    });
    expect(await gatesSetupStatus(deps)).toEqual({
      missing: ['judge', 'Lint', 'AST pattern'],
      anyConfigured: true,
    });
  });

  it('cannot tell (the read is refused): null, so the wizard asks as before', async () => {
    const { deps } = fixture({ files: pkg, exportStatus: 403 });
    expect(await gatesSetupStatus(deps)).toBeNull();
  });
});
