import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';

import {
  client,
  gateBindingTransferExportConfigV1,
  gateBindingTransferImportConfigV1,
  repositoryRefCatalogCreateV1,
  repositoryRefCatalogResolveByRemoteV1,
} from '@levr-one/sdk';
import type { GateConfigFileDto } from '@levr-one/sdk';
import { defaultEnv, whichSync } from '@levr/mcp-harnesses/node';
import {
  buildJudgeSetupPrompt,
  isJudgePresetId,
  JUDGE_GATE_KEYS,
  JUDGE_PRESET_IDS,
  JUDGE_PRESETS,
  jsonEqual,
  parsePayload,
  PayloadError,
  validatePayload,
} from '@levr/shared';

import type { LocalContext } from '../../context.js';
import { resolveToken } from '../../auth/resolve-token.js';
import {
  resolveRepoContext,
  type RunCommand,
} from '../../repo/repo-context.js';
import { configureClient } from '../../utils/sdk-client.js';
import { resolveWorkspaceFor } from '../../workspace/resolve-workspace.js';
import {
  detectAstPatternSlot,
  detectCommandSlots,
  slotConfig,
  type CommandSlotId,
  type ReadRepoFile,
  type SlotProposal,
} from './setup-detect.js';

/**
 * [issue:internal] `levr gates setup` (plan internal D7).
 *
 * Detect, propose, confirm, write, read back:
 *
 * 1. **Repo.** `resolveRepoContext` (git root, origin remote, an ssh alias
 *    resolved with `ssh -G`). Outside a repository: exit 2.
 * 2. **Repository in Levr.** The remote is resolved by the server
 *    (`RepositoryRefCatalog_resolveByRemote_v1`); an unknown one may be
 *    added (`RepositoryRefCatalog_create_v1`), asking the provider first on
 *    a host that is no provider's default. A repo-scoped binding uses the
 *    `repo_key` the server returned, never one built here (Review R3 C1).
 * 3. **Scope.** Repository tier when the workspace already has bindings for
 *    that repository, or when the person opts in; otherwise workspace tier.
 *    The choice is printed.
 * 4. **Judge.** `JUDGE_PRESETS` binaries on PATH: one is used, several are
 *    offered in a select with NO default, none prints
 *    `buildJudgeSetupPrompt` and writes no judge binding.
 * 5. **Command slots** (`detectCommandSlots`), each offered UNSELECTED: a
 *    slot is in the payload only after the person chose it.
 * 6. **Write.** A NESTED payload (`{ cmd: { test: { unit } } }`), a dry-run
 *    preview (`dryRun`), a confirmation, then
 *    `gateBindingTransferImportConfigV1`. A differing judge binding is
 *    replaced only after the person confirmed it (`replace_judge`,
 *    Review R1 C12).
 * 7. **Read back** with `gateBindingTransferExportConfigV1` (exportConfig):
 *    every written binding must be present and EQUAL; a mismatch exits 1
 *    naming the slot. A repo-scoped write must also reach a repository an
 *    issue can link (Review R4 C13).
 *
 * Exit codes: 0 success; 1 a refusal (403: only Owners/Admins), a failed
 * request, a differing row or a read-back mismatch; 2 outside a git
 * repository or a usage error; 130 a cancelled prompt.
 *
 * Output is streamed as it is produced (`SetupDeps.write`), so the scope,
 * the judge and the dry-run plan are on screen before the question that
 * writes them.
 */

export interface SetupFlags {
  'dry-run': boolean;
  /** Ask nothing; accept only what was explicitly passed. */
  yes: boolean;
  judge?: string;
  'workspace-id'?: string;
}

/** The exit codes setup ends with; 130 is a cancelled prompt. */
export type SetupExitCode = 0 | 1 | 2 | 130;

/** Exit code for a prompt cancelled with Ctrl+C (shared with D9's wizard). */
export const EXIT_CANCELLED = 130;

export interface SetupOutcome {
  /** 130: cancelled at a prompt (the convention the bare `levr` wizard reads). */
  exitCode: SetupExitCode;
  stdout: string;
  stderr: string;
}

/** A server reply: the HTTP status and the parsed body. */
export interface SetupReply {
  status: number;
  body: unknown;
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/** The questions setup asks. `null` is a cancelled prompt. */
export interface SetupPrompts {
  select<T extends string>(o: {
    message: string;
    options: SelectOption<T>[];
  }): Promise<T | null>;
  /**
   * A checkbox list. `initialValues: []` and `required: false`: nothing is
   * checked until the person toggles it, and Enter with nothing checked is
   * an answer (none), not an error.
   */
  multiselect<T extends string>(o: {
    message: string;
    options: SelectOption<T>[];
    initialValues: [];
    required: false;
  }): Promise<T[] | null>;
  confirm(o: {
    message: string;
    initialValue: boolean;
  }): Promise<boolean | null>;
  text(o: { message: string; initialValue: string }): Promise<string | null>;
}

export type RepositoryProvider = 'github' | 'gitlab' | 'bitbucket' | 'other';

export interface SetupDeps {
  cwd: string;
  git: RunCommand;
  ssh: RunCommand;
  /** Is this program on PATH? */
  which: (bin: string) => boolean;
  readFile: ReadRepoFile;
  prompts: SetupPrompts;
  /** Log in and pick the workspace; called once the repository is known. */
  connect?: () => Promise<{ ok: true } | { ok: false; message: string }>;
  resolveRemote: (remote: string) => Promise<SetupReply>;
  createRepository: (
    remote: string,
    provider?: RepositoryProvider,
  ) => Promise<SetupReply>;
  exportConfig: () => Promise<SetupReply>;
  importConfig: (
    payload: unknown,
    opts: { dryRun: boolean; replaceJudge: boolean },
  ) => Promise<SetupReply>;
  /**
   * Stream each stdout line as it is produced, so the person sees the scope,
   * the judge and the dry-run plan BEFORE the question that acts on them.
   * The outcome's `stdout` still carries everything.
   */
  write?: (text: string) => void;
  /** As `write`, for stderr. */
  writeErr?: (text: string) => void;
}

export const OWNER_ADMIN_MESSAGE =
  'Only workspace Owners/Admins can configure gates. Ask an Owner or Admin to run `levr gates setup`, or to give you the Admin role.';

/** One binding as the export returns it. */
interface ExportedBinding {
  gate_key: string;
  repo_key?: string | null;
  path_prefix?: string | null;
  enabled: boolean;
  config: Record<string, unknown>;
}

/** One binding setup writes. `repo_key` is present only at repository tier. */
interface SetupEntry {
  gate_key: string;
  repo_key?: string;
  enabled: true;
  config: Record<string, unknown>;
}

interface PlannedRow {
  gate_key: string;
  repo_key: string | null;
  path_prefix: string | null;
  action: string;
  applied: boolean;
  /** [issue:internal] The gate type's technique, from the server. */
  technique?: string;
}

interface ResolvedRepository {
  repository_ref_id: string | null;
  github_repository_id: string | null;
  repo_key: string;
}

const PROVIDERS: SelectOption<RepositoryProvider>[] = [
  { value: 'github', label: 'GitHub (Enterprise Server)' },
  { value: 'gitlab', label: 'GitLab (self-managed)' },
  { value: 'bitbucket', label: 'Bitbucket (Data Center)' },
  { value: 'other', label: 'Other' },
];

/** Raised to stop the flow with an exit code; the message is already written. */
class Stop extends Error {
  constructor(readonly exitCode: SetupExitCode) {
    super(`stop ${exitCode}`);
  }
}

/** The server's own message for a refusal (Nest puts it in `message`). */
function serverMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const m = (body as { message?: unknown }).message;
    if (typeof m === 'string') return m;
    if (Array.isArray(m)) return m.map(String).join('; ');
  }
  if (typeof body === 'string' && body.trim()) return body.trim();
  return `HTTP ${status}`;
}

const sameKey = (a: string | null | undefined, b: string | null | undefined) =>
  a != null && b != null && a.toLowerCase() === b.toLowerCase();

function tierLabel(repoKey: string | null | undefined): string {
  return repoKey ? repoKey : 'workspace-wide';
}

/** What a binding holds, for a person: `judge: codex`, `cmd.typecheck: tsc`. */
function describeConfig(
  gateKey: string,
  config: Record<string, unknown>,
): string {
  if ((JUDGE_GATE_KEYS as readonly string[]).includes(gateKey)) {
    const judge = config['judge'];
    if (typeof judge === 'string') return `judge: ${judge}`;
    if (judge && typeof judge === 'object') {
      const name = (judge as { name?: unknown }).name;
      return `judge: ${typeof name === 'string' ? name : 'custom'}`;
    }
    return 'no judge';
  }
  const parts: string[] = [];
  const walk = (node: unknown, at: string) => {
    if (typeof node === 'string') {
      parts.push(`${at}: ${node}`);
      return;
    }
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [k, v] of Object.entries(node)) walk(v, at ? `${at}.${k}` : k);
    }
  };
  walk(config, '');
  return parts.join(', ') || '{}';
}

/** What a stored judge binding is, for the replace question. */
function storedJudgeLabel(row: ExportedBinding): string {
  if (row.enabled === false) return 'disabled';
  const judge = row.config?.['judge'];
  if (typeof judge === 'string') return judge;
  if (judge && typeof judge === 'object') {
    const name = (judge as { name?: unknown }).name;
    return typeof name === 'string' ? name : 'custom';
  }
  return 'no judge';
}

/** The slot a written binding configures, for messages: `cmd.typecheck (typecheck)`. */
function slotName(entry: SetupEntry): string {
  if ((JUDGE_GATE_KEYS as readonly string[]).includes(entry.gate_key)) {
    return `${entry.gate_key} judge`;
  }
  const cmd = entry.config['cmd'];
  const path: string[] = ['cmd'];
  let node: unknown = cmd;
  while (node && typeof node === 'object' && !Array.isArray(node)) {
    const keys = Object.keys(node);
    if (keys.length !== 1) break;
    path.push(keys[0]!);
    node = (node as Record<string, unknown>)[keys[0]!];
  }
  return `${path.join('.')} (${entry.gate_key})`;
}

const SLOT_LABELS: Readonly<Record<string, string>> = {
  typecheck: 'Typecheck',
  'test.unit': 'Unit tests',
  'test.e2e': 'E2E tests',
  lint: 'Lint',
  ast_pattern: 'AST pattern',
};

/**
 * The setup flow, with every effect injected. Returns what to print and the
 * exit code; nothing here touches the process.
 */
export async function executeGatesSetup(
  flags: SetupFlags,
  deps: SetupDeps,
): Promise<SetupOutcome> {
  const out = new OutputLines(deps.write);
  const err = new OutputLines(deps.writeErr);
  const finish = (exitCode: SetupExitCode): SetupOutcome => ({
    exitCode,
    stdout: out.text(),
    stderr: err.text(),
  });
  try {
    await runSetup(flags, deps, out, err);
    return finish(0);
  } catch (e) {
    if (e instanceof Stop) return finish(e.exitCode);
    throw e;
  }
}

/**
 * Lines of output: kept for the outcome, and streamed through `sink` (when
 * given) the moment each is pushed, so nothing waits for the exit.
 */
class OutputLines {
  private readonly lines: string[] = [];

  constructor(private readonly sink?: (text: string) => void) {}

  push(...lines: string[]): void {
    this.lines.push(...lines);
    if (this.sink) for (const line of lines) this.sink(`${line}\n`);
  }

  get length(): number {
    return this.lines.length;
  }

  text(): string {
    return this.lines.length ? `${this.lines.join('\n')}\n` : '';
  }
}

async function runSetup(
  flags: SetupFlags,
  deps: SetupDeps,
  out: OutputLines,
  err: OutputLines,
): Promise<void> {
  const interactive = !flags.yes;
  const fail = (code: 1 | 2, message: string): never => {
    err.push(`gates setup: ${message}`);
    throw new Stop(code);
  };
  // A cancelled prompt exits 130, which the bare `levr` wizard reads as
  // "cancelled", not "failed". Only the bindings are unwritten: a repository
  // entry added earlier in this run stays.
  const cancelled = (): never => {
    out.push('Cancelled. Gate settings not written.');
    throw new Stop(EXIT_CANCELLED);
  };
  const answered = <T>(value: T | null): T =>
    value === null ? cancelled() : value;

  /** A request; a 403 is the Owner/Admin message, anything else its own. */
  const request = async (
    what: string,
    run: () => Promise<SetupReply>,
    opts: { forbiddenContinues?: boolean } = {},
  ): Promise<SetupReply | null> => {
    let reply: SetupReply;
    try {
      reply = await run();
    } catch (e) {
      return fail(
        1,
        `${what} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (reply.status === 403) {
      err.push(OWNER_ADMIN_MESSAGE);
      if (opts.forbiddenContinues) return null;
      throw new Stop(1);
    }
    if (reply.status < 200 || reply.status >= 300) {
      return fail(
        1,
        `${what} refused: ${serverMessage(reply.body, reply.status)}`,
      );
    }
    return reply;
  };

  if (flags.judge !== undefined && !isJudgePresetId(flags.judge)) {
    fail(
      2,
      `--judge "${flags.judge}" is not a judge preset (${JUDGE_PRESET_IDS.join(', ')}). A custom judge is set up over MCP: run without --judge to print the prompt.`,
    );
  }

  // 1. The repository: git root and origin, an ssh alias resolved.
  const repo = await resolveRepoContext({
    cwd: deps.cwd,
    git: deps.git,
    ssh: deps.ssh,
    askIsSshAlias: async (host) =>
      interactive
        ? (await deps.prompts.confirm({
            message: `The remote's host "${host}" is no provider's default host. Is it an ssh alias from your ~/.ssh/config?`,
            initialValue: false,
          })) === true
        : false,
    note: (line) => out.push(line),
  });
  if (!repo.ok) {
    err.push(repo.message);
    throw new Stop(repo.exitCode);
  }
  const ctx = repo.context;
  out.push(
    `Repository: ${ctx.root}${ctx.remote ? ` (origin ${ctx.remote})` : ' (no origin remote)'}`,
  );

  if (deps.connect) {
    const connected = await deps.connect();
    if (!connected.ok) fail(1, connected.message);
  }

  // What the workspace stores now: the scope and the judge replace read it.
  // A Member is refused here, before any question about what to write.
  const before = await request('reading the workspace gate configuration', () =>
    deps.exportConfig(),
  );
  const stored =
    (before?.body as { bindings?: ExportedBinding[] } | undefined)?.bindings ??
    [];

  // 2. The repository in Levr: the server's repo_key, never one built here.
  let repoKey: string | null = null;
  if (ctx.remote) {
    const remote = ctx.remote;
    const resolved = await request('resolving the remote', () =>
      deps.resolveRemote(remote),
    );
    const found = (resolved?.body as { repository?: ResolvedRepository | null })
      ?.repository;
    if (found) {
      repoKey = found.repo_key;
      out.push(`Repository in Levr: ${repoKey}`);
    } else if (!interactive) {
      out.push(
        `${remote} is not in the workspace's repository catalog; --yes does not add it. Run without --yes to add it.`,
      );
    } else {
      let provider: RepositoryProvider | undefined;
      if (!ctx.isDefaultProviderHost) {
        provider = answered(
          await deps.prompts.select<RepositoryProvider>({
            message: `Which provider serves ${ctx.host ?? remote}?`,
            options: PROVIDERS,
          }),
        );
      }
      const create = answered(
        await deps.prompts.confirm({
          message: `${remote} is not in the workspace's repository catalog. Add it, so gate settings can be scoped to it?`,
          initialValue: true,
        }),
      );
      if (create) {
        const created = await request(
          'adding the repository',
          () => deps.createRepository(remote, provider),
          { forbiddenContinues: true },
        );
        if (created) {
          repoKey = (created.body as { repo_key?: string }).repo_key ?? null;
          if (repoKey) out.push(`Added the repository: ${repoKey}`);
        } else {
          err.push('Continuing at workspace tier.');
        }
      }
    }
  }

  // 3. Scope: repository tier when the workspace already scopes bindings to
  // it, or when the person opts in; otherwise the workspace.
  let scopeKey: string | null = null;
  if (repoKey) {
    const key = repoKey;
    if (stored.some((b) => sameKey(b.repo_key, key))) {
      scopeKey = key;
      out.push(
        `Scope: repository ${key} (the workspace already has gate settings for it)`,
      );
    } else if (
      interactive &&
      answered(
        await deps.prompts.confirm({
          message: `Write these gate settings for ${key} only? No writes them for the whole workspace.`,
          initialValue: false,
        }),
      )
    ) {
      scopeKey = key;
      out.push(`Scope: repository ${key} (chosen)`);
    }
  }
  if (!scopeKey) out.push('Scope: workspace (every repository)');
  const atTier = (
    gate_key: string,
    config: Record<string, unknown>,
  ): SetupEntry => ({
    gate_key,
    ...(scopeKey ? { repo_key: scopeKey } : {}),
    enabled: true,
    config,
  });
  const storedAtTier = (gateKey: string) =>
    stored.find(
      (b) =>
        b.gate_key === gateKey &&
        (b.repo_key ?? null) === scopeKey &&
        (b.path_prefix ?? null) === null,
    );

  // 4. The judge: the preset binaries on PATH.
  const detected = JUDGE_PRESET_IDS.filter((id) =>
    deps.which(JUDGE_PRESETS[id].bin),
  );
  let judge: string | null = null;
  if (flags.judge !== undefined) {
    judge = flags.judge;
    out.push(`Judge: ${judge} (--judge)`);
  } else if (interactive && detected.length === 1) {
    judge = detected[0]!;
    out.push(`Judge: ${judge} (the one judge CLI on PATH)`);
  } else if (interactive && detected.length > 1) {
    // Setup never picks for the person, and offers no default: a select
    // always highlights an option that Enter takes, so the judges are a
    // multiselect instead, with NOTHING pre-selected (initialValues: [], so
    // no initial values; required: false). A judge is chosen only by toggling it; Enter with
    // nothing checked is "choose later": no judge binding, and the setup
    // prompt is printed. More than one checked is refused and asked again.
    for (;;) {
      const checked = answered(
        await deps.prompts.multiselect<string>({
          message:
            'Several judge CLIs are on PATH. Toggle the one the judge gates should run (Space), then Enter. Enter with none checked chooses later.',
          options: detected.map((id) => ({ value: id, label: id })),
          initialValues: [], // nothing is pre-selected
          required: false, // Enter with nothing checked means "choose later"
        }),
      );
      if (checked.length > 1) {
        out.push(
          `Choose one judge, not ${checked.length} (${checked.join(', ')}). Asking again.`,
        );
        continue;
      }
      if (checked.length === 1) {
        judge = checked[0]!;
        out.push(`Judge: ${judge} (chosen)`);
      } else {
        out.push('Judge: none chosen (the judge gates stay unconfigured)');
      }
      break;
    }
  }
  if (judge === null) {
    out.push('', buildJudgeSetupPrompt({ detected }), '');
  }

  const entries: SetupEntry[] = [];
  let replaceJudge = false;
  if (judge !== null) {
    const wanted = { judge };
    const differing = JUDGE_GATE_KEYS.map((k) => storedAtTier(k)).filter(
      (row): row is ExportedBinding =>
        row !== undefined &&
        !(row.enabled !== false && jsonEqual(row.config ?? {}, wanted)),
    );
    let keep = true;
    if (differing.length > 0) {
      const labels = [...new Set(differing.map(storedJudgeLabel))].join(', ');
      if (interactive) {
        replaceJudge = answered(
          await deps.prompts.confirm({
            message: `Replace the existing judge setting (${labels}) with ${judge}?`,
            initialValue: false,
          }),
        );
      }
      if (!replaceJudge) {
        keep = false;
        out.push(
          `Kept the existing judge setting (${labels}).${interactive ? '' : ' --yes never replaces one; run without --yes, or use `levr gates bindings import --replace-judge`.'}`,
        );
      }
    }
    if (keep) {
      for (const key of JUDGE_GATE_KEYS) entries.push(atTier(key, { judge }));
    }
  }

  // 5. Command slots: proposed unselected, written only once chosen.
  const proposals: SlotProposal[] = detectCommandSlots(ctx.root, deps.readFile);
  // [issue:internal] AST Pattern, when ast-grep is installed.
  const ast = detectAstPatternSlot(ctx.root, deps.readFile, deps.which);
  if (typeof ast === 'string') {
    out.push(
      ast === 'no-ast-grep'
        ? 'AST pattern: not offered, ast-grep is not installed (npm i -D @ast-grep/cli, brew install ast-grep, cargo install ast-grep, or pip install ast-grep-cli).'
        : 'AST pattern: not offered, counting its matches needs node, python3 or jq on the PATH.',
    );
  } else {
    proposals.push(ast);
  }
  if (!interactive && proposals.length > 0) {
    out.push(
      'Detected commands (not written: --yes takes only what was passed):',
    );
    for (const p of proposals)
      out.push(`  ${p.slot}: ${p.command}  (${p.source})`);
  }
  if (interactive && proposals.length > 0) {
    // A multiselect with NOTHING pre-selected (initialValues: [], so no
    // initial values; required: false): a slot is written only once the
    // person checks it, and Enter with nothing checked writes no slot.
    const checked = answered(
      await deps.prompts.multiselect<CommandSlotId>({
        message:
          'Detected commands. Check the ones to write (Space), then Enter. Enter with none checked writes none.',
        options: proposals.map((p) => ({
          value: p.slot,
          label: `${SLOT_LABELS[p.slot] ?? p.slot} (${p.gateKey}): ${p.command}`,
          hint: `from ${p.source}`,
        })),
        initialValues: [], // nothing is pre-selected
        required: false, // Enter with nothing checked writes no slot
      }),
    );
    const chosen = proposals.filter((p) => checked.includes(p.slot));
    // Editing is its own explicit choice, again with nothing pre-selected:
    // a checked command is written as shown unless the person picks it here.
    const toEdit: CommandSlotId[] =
      chosen.length === 0
        ? []
        : answered(
            await deps.prompts.multiselect<CommandSlotId>({
              message:
                'Edit any of these commands before writing? Check the ones to edit, then Enter. Enter with none checked writes them as shown.',
              options: chosen.map((p) => ({
                value: p.slot,
                label: `${SLOT_LABELS[p.slot] ?? p.slot}: ${p.command}`,
              })),
              initialValues: [], // nothing is pre-selected
              required: false, // Enter with nothing checked edits none
            }),
          );
    for (const p of chosen) {
      let command = p.command;
      if (toEdit.includes(p.slot)) {
        command = answered(
          await deps.prompts.text({
            message: `Command for ${p.slot} (empty skips the slot)`,
            initialValue: p.command,
          }),
        ).trim();
        if (command === '') continue;
      }
      entries.push(
        atTier(p.gateKey, {
          ...slotConfig(p.slot, command),
          ...(p.extraConfig ?? {}),
        }),
      );
    }
  }

  if (entries.length === 0) {
    out.push('Nothing to write.');
    return;
  }

  // 6. Write: check locally, preview, confirm, apply.
  const payload = {
    description: 'Written by levr gates setup',
    bindings: entries,
  };
  try {
    validatePayload(parsePayload(payload));
  } catch (e) {
    if (e instanceof PayloadError)
      fail(2, `refused, nothing sent: ${e.message}`);
    throw e;
  }

  const printPlan = (rows: PlannedRow[]) => {
    for (const r of rows) {
      const note =
        r.action === 'differs'
          ? '  (NOT applied: the stored row differs)'
          : r.action === 'replace'
            ? '  (the stored judge setting is replaced)'
            : '';
      // [issue:internal] Say what KIND of check each row configures, and
      // what it sets (`judge: claude`, `cmd.typecheck: yarn typecheck`).
      const technique = r.technique ? ` (${r.technique})` : '';
      const entry = entries.find(
        (e) =>
          e.gate_key === r.gate_key &&
          (e.repo_key ?? null) === (r.repo_key ?? null),
      );
      const sets = entry
        ? `  ${describeConfig(entry.gate_key, entry.config)}`
        : '';
      out.push(
        `${r.action.padEnd(8)} ${r.gate_key}${technique} [${tierLabel(r.repo_key)}]${sets}${note}`,
      );
    }
  };
  const preview = await request('previewing the import', () =>
    deps.importConfig(payload, { dryRun: true, replaceJudge }),
  );
  const previewRows =
    (preview?.body as { bindings?: PlannedRow[] })?.bindings ?? [];
  out.push('Dry run:');
  printPlan(previewRows);
  const differsIn = (rows: PlannedRow[]) =>
    rows.filter((r) => r.action === 'differs').length;
  const reportDiffers = (rows: PlannedRow[]) => {
    const n = differsIn(rows);
    if (n > 0) {
      err.push(
        `gates setup: ${n} row(s) differ from what the workspace stores and are not written; change them in the workspace on purpose, or delete them and run setup again.`,
      );
      throw new Stop(1);
    }
  };
  if (flags['dry-run']) {
    out.push(
      '# Dry run: nothing written. Run again without --dry-run to apply.',
    );
    reportDiffers(previewRows);
    return;
  }
  if (
    interactive &&
    !answered(
      await deps.prompts.confirm({
        message: 'Write these gate settings?',
        initialValue: true,
      }),
    )
  ) {
    out.push('Gate settings not written.');
    return;
  }

  const applied = await request('writing the bindings', () =>
    deps.importConfig(payload, { dryRun: false, replaceJudge }),
  );
  const appliedRows =
    (applied?.body as { bindings?: PlannedRow[] })?.bindings ?? [];
  printPlan(appliedRows);
  out.push(
    `# Applied: ${appliedRows.filter((r) => r.applied).length} row(s) written.`,
  );

  // 7. Read back: every written binding present, nested and equal.
  const after = await request('reading the bindings back', () =>
    deps.exportConfig(),
  );
  const now =
    (after?.body as { bindings?: ExportedBinding[] } | undefined)?.bindings ??
    [];
  const mismatches: string[] = [];
  entries.forEach((entry, i) => {
    if (appliedRows[i]?.action === 'differs') return;
    const tier = entry.repo_key ?? null;
    const row = now.find(
      (b) =>
        b.gate_key === entry.gate_key &&
        (b.repo_key ?? null) === tier &&
        (b.path_prefix ?? null) === null,
    );
    if (!row) {
      mismatches.push(
        `read-back mismatch: ${slotName(entry)} [${tierLabel(tier)}] is not in the workspace`,
      );
    } else if (
      row.enabled !== true ||
      !jsonEqual(row.config ?? {}, entry.config)
    ) {
      mismatches.push(
        `read-back mismatch: ${slotName(entry)} [${tierLabel(tier)}]: wrote ${describeConfig(entry.gate_key, entry.config)}, the workspace has ${row.enabled === false ? 'it disabled' : describeConfig(row.gate_key, row.config ?? {})}`,
      );
    } else {
      out.push(
        `Read back: ${entry.gate_key} [${tierLabel(tier)}] ${describeConfig(entry.gate_key, row.config)}`,
      );
    }
  });
  if (mismatches.length > 0) {
    for (const m of mismatches) err.push(`gates setup: ${m}`);
    throw new Stop(1);
  }

  // The written key must reach an issue: a repository an issue can link
  // (a catalogued ref or a GitHub App repository) carries it.
  if (scopeKey && ctx.remote) {
    const remote = ctx.remote;
    const key = scopeKey;
    const again = await request('checking the repository key', () =>
      deps.resolveRemote(remote),
    );
    const reach = (again?.body as { repository?: ResolvedRepository | null })
      ?.repository;
    const linkable =
      reach != null &&
      (reach.repository_ref_id != null || reach.github_repository_id != null) &&
      sameKey(reach.repo_key, key);
    if (!linkable) {
      fail(
        1,
        `the gate settings were written for repository key "${key}", but no repository an issue can link carries that key, so no issue will read them. If ${ctx.host ?? 'the remote host'} is an ssh alias, run setup again and answer yes to the ssh alias question; otherwise add the repository in Levr.`,
      );
    }
  }

  reportDiffers(appliedRows);
}

/** git, ssh: spawned with an argv, never a shell string. */
function runner(program: string, timeoutMs?: number): RunCommand {
  return (args, cwd) => {
    const r = spawnSync(program, [...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(timeoutMs ? { timeout: timeoutMs } : {}),
    });
    if (r.error) return { code: -1, stdout: '' };
    return { code: r.status ?? -1, stdout: r.stdout ?? '' };
  };
}

async function clackPrompts(): Promise<SetupPrompts> {
  const p = await import('@clack/prompts');
  return {
    async select<T extends string>(o: {
      message: string;
      options: SelectOption<T>[];
    }): Promise<T | null> {
      const v = await p.select<T>({
        message: o.message,
        options: o.options.map((x) =>
          x.hint === undefined
            ? { value: x.value, label: x.label }
            : { value: x.value, label: x.label, hint: x.hint },
        ) as never,
      });
      return p.isCancel(v) ? null : v;
    },
    async multiselect<T extends string>(o: {
      message: string;
      options: SelectOption<T>[];
      initialValues: [];
      required: false;
    }): Promise<T[] | null> {
      const v = await p.multiselect<T>({
        message: o.message,
        options: o.options.map((x) =>
          x.hint === undefined
            ? { value: x.value, label: x.label }
            : { value: x.value, label: x.label, hint: x.hint },
        ) as never,
        initialValues: o.initialValues, // nothing is pre-selected
        required: o.required,
      });
      return p.isCancel(v) ? null : v;
    },
    async confirm(o) {
      const v = await p.confirm(o);
      return p.isCancel(v) ? null : v;
    },
    async text(o) {
      const v = await p.text({
        message: o.message,
        initialValue: o.initialValue,
      });
      return p.isCancel(v) ? null : v;
    },
  };
}

function liveDeps(
  ctx: LocalContext,
  flags: SetupFlags,
  prompts: SetupPrompts,
): SetupDeps {
  const reply = (r: {
    ok: boolean;
    data?: unknown;
    error?: unknown;
    response: Response;
  }) => ({
    status: r.response.status,
    body: r.ok ? r.data : r.error,
  });
  return {
    cwd: ctx.process.cwd(),
    git: runner('git'),
    // `ssh -G` prints the resolved config and opens no connection.
    ssh: runner('ssh', 10_000),
    // The `which:` signal mcp-harnesses detects clients with: a PATH scan
    // that spawns nothing.
    which: (bin) => whichSync(bin, defaultEnv()),
    readFile: (p) => {
      try {
        return fs.readFileSync(p, 'utf8');
      } catch {
        return null;
      }
    },
    prompts,
    connect: async () => {
      try {
        const auth = await resolveToken();
        configureClient(auth);
        const ws = await resolveWorkspaceFor(auth, flags['workspace-id']);
        if (ws) {
          client.setConfig({
            ...client.getConfig(),
            workspaceId: ws.workspaceId,
          });
        }
        return { ok: true };
      } catch (e) {
        return {
          ok: false,
          message: e instanceof Error ? e.message : 'Authentication failed.',
        };
      }
    },
    resolveRemote: async (remote) =>
      reply(await repositoryRefCatalogResolveByRemoteV1({ query: { remote } })),
    createRepository: async (remote, provider) =>
      reply(
        await repositoryRefCatalogCreateV1({
          body: { remote, ...(provider ? { provider } : {}) },
        }),
      ),
    exportConfig: async () => reply(await gateBindingTransferExportConfigV1()),
    importConfig: async (payload, opts) => {
      const query = {
        ...(opts.dryRun ? { dry_run: 'true' as const } : {}),
        ...(opts.replaceJudge ? { replace_judge: 'true' as const } : {}),
      };
      return reply(
        await gateBindingTransferImportConfigV1({
          body: payload as GateConfigFileDto,
          ...(Object.keys(query).length > 0 ? { query } : {}),
        }),
      );
    },
  };
}

export async function gatesSetupHandler(
  this: LocalContext,
  flags: SetupFlags,
): Promise<void> {
  if (!flags.yes && this.process.stdin.isTTY !== true) {
    this.process.stderr.write(
      'gates setup: asks questions, and stdin is not a terminal. Run it in a terminal, or pass --yes (with --judge) to accept only what you pass.\n',
    );
    this.process.exitCode = 2;
    return;
  }
  const prompts = await clackPrompts();
  const deps = liveDeps(this, flags, prompts);
  // Streamed as produced: the plan is on screen before "Write these
  // bindings?". The outcome's buffered text is therefore not printed again.
  deps.write = (text) => this.process.stdout.write(text);
  deps.writeErr = (text) => this.process.stderr.write(text);
  const outcome = await executeGatesSetup(flags, deps);
  this.process.exitCode = outcome.exitCode;
}

/** What `levr gates setup` would still offer in this repository. */
export interface GatesSetupStatus {
  /** Labels of what is not configured yet: `judge`, `Lint`, `AST pattern`. */
  missing: string[];
  /** Whether any gate setting already applies here. */
  anyConfigured: boolean;
}

/**
 * [issue:internal] Read-only: what setup would still offer here, so the
 * wizard does not ask again in a repository already set up (user report
 * 2026-11-11: bare `levr` asked every run). A setting applies when it is
 * enabled at the workspace tier or at THIS repository's tier. Missing: the
 * judge when no judge gate type has a setting, and each slot setup detects
 * (the manifest commands, AST pattern) whose gate type has none. Never
 * prompts and never writes. Null when it cannot tell (not a repository, not
 * signed in, the read refused): the caller then asks as before.
 */
export async function gatesSetupStatus(
  deps: SetupDeps,
): Promise<GatesSetupStatus | null> {
  const repo = await resolveRepoContext({
    cwd: deps.cwd,
    git: deps.git,
    ssh: deps.ssh,
    askIsSshAlias: () => Promise.resolve(false),
    note: () => {},
  });
  if (!repo.ok) return null;
  if (deps.connect && !(await deps.connect()).ok) return null;
  const exported = await deps.exportConfig();
  if (exported.status >= 400) return null;
  const stored =
    (exported.body as { bindings?: ExportedBinding[] } | undefined)?.bindings ??
    [];
  let repoKey: string | null = null;
  if (repo.context.remote) {
    const resolved = await deps.resolveRemote(repo.context.remote);
    if (resolved.status < 400) {
      repoKey =
        (resolved.body as { repository?: ResolvedRepository | null })
          ?.repository?.repo_key ?? null;
    }
  }
  const here = stored.filter(
    (b) =>
      b.enabled !== false &&
      (b.path_prefix ?? null) === null &&
      ((b.repo_key ?? null) === null || b.repo_key === repoKey),
  );
  const applies = (gateKey: string) => here.some((b) => b.gate_key === gateKey);
  const missing: string[] = [];
  if (!(JUDGE_GATE_KEYS as readonly string[]).some(applies)) {
    missing.push('judge');
  }
  const proposals: SlotProposal[] = detectCommandSlots(
    repo.context.root,
    deps.readFile,
  );
  const ast = detectAstPatternSlot(
    repo.context.root,
    deps.readFile,
    deps.which,
  );
  if (typeof ast !== 'string') proposals.push(ast);
  for (const p of proposals) {
    if (!applies(p.gateKey)) missing.push(SLOT_LABELS[p.slot] ?? p.slot);
  }
  return { missing, anyConfigured: here.length > 0 };
}

/** {@link gatesSetupStatus} with the live repository, session and API. */
export async function liveGatesSetupStatus(
  ctx: LocalContext,
): Promise<GatesSetupStatus | null> {
  // The status check never asks: every prompt answers "no answer".
  const silent: SetupPrompts = {
    select: () => Promise.resolve(null),
    multiselect: () => Promise.resolve(null),
    confirm: () => Promise.resolve(null),
    text: () => Promise.resolve(null),
  };
  const deps = liveDeps(ctx, { 'dry-run': true, yes: true }, silent);
  try {
    return await gatesSetupStatus(deps);
  } catch {
    return null;
  }
}
