import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  client,
  gateBindingTransferExportConfigV1,
  gateBindingTransferImportConfigV1,
} from '@levr-one/sdk';
import type { GateConfigFileDto } from '@levr-one/sdk';
import {
  missingFiles,
  namedFiles,
  parsePayload,
  PayloadError,
  validatePayload,
  type BindingPayload,
} from '@levr/shared';

import type { LocalContext } from '../../context.js';
import { resolveToken } from '../../auth/resolve-token.js';
import { configureClient } from '../../utils/sdk-client.js';
import { resolveWorkspaceFor } from '../../workspace/resolve-workspace.js';

/**
 * `levr gates bindings export|import` (internal D8.3, supersedes internal):
 * a workspace's gate configuration as one JSON file, through
 * `GET /v1/gate/bindings/export` and `POST /v1/gate/bindings/import`.
 *
 * Import parses and checks the file locally first with the shared parser
 * (`@levr/shared` `parsePayload` / `validatePayload`), so a malformed file
 * exits 2 before any request. It then APPLIES unless `--dry-run` is given,
 * which sends `dry_run=true` and writes nothing. The server re-plans and
 * re-checks every row; a stored row that differs is reported `differs` and
 * never overwritten, and a binding is deleted only when its entry says
 * `"delete": true`.
 *
 * Exit codes: 0 success; 1 refused by the server (403, 400), a lane file
 * missing under --repo-root, a `differs` row, or a failed request; 2 a usage
 * error or a file that does not parse.
 */
export interface BindingsExportFlags {
  'workspace-id'?: string;
  out?: string;
}

export interface BindingsImportFlags {
  'workspace-id'?: string;
  'repo-root'?: string;
  'dry-run': boolean;
}

export interface BindingsOutcome {
  exitCode: 0 | 1 | 2;
  stdout: string;
  stderr: string;
}

/** A server reply: the HTTP status and the parsed body. */
export interface BindingsReply {
  status: number;
  body: unknown;
}

export interface BindingsDeps {
  exportConfig: () => Promise<BindingsReply>;
  /** POST the file as chosen; `dryRun` sends `dry_run=true`. */
  importConfig: (file: unknown, dryRun: boolean) => Promise<BindingsReply>;
  readFile: (file: string) => string;
  writeFile: (file: string, content: string) => void;
  /** `relativePath` exists under `root`. */
  exists: (root: string, relativePath: string) => boolean;
}

interface ImportRow {
  action: string;
  applied: boolean;
  note?: string;
}

interface ImportResult {
  dry_run: boolean;
  definitions: Array<ImportRow & { key: string }>;
  bindings: Array<
    ImportRow & {
      gate_key: string;
      repo_key: string | null;
      path_prefix: string | null;
    }
  >;
}

function fail(code: 1 | 2, cmd: string, message: string): BindingsOutcome {
  return {
    exitCode: code,
    stdout: '',
    stderr: `gates bindings ${cmd}: ${message}\n`,
  };
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

function tierLabel(b: {
  repo_key: string | null;
  path_prefix: string | null;
}): string {
  if (b.repo_key == null) return 'workspace-wide';
  return b.path_prefix ? `${b.repo_key}:${b.path_prefix}` : b.repo_key;
}

/** `export`: the file on stdout, or written to `--out`. */
export async function executeBindingsExport(
  flags: BindingsExportFlags,
  deps: BindingsDeps,
): Promise<BindingsOutcome> {
  let reply: BindingsReply;
  try {
    reply = await deps.exportConfig();
  } catch (err) {
    return fail(
      1,
      'export',
      `request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (reply.status !== 200) {
    return fail(1, 'export', serverMessage(reply.body, reply.status));
  }
  const text = `${JSON.stringify(reply.body, null, 2)}\n`;
  if (!flags.out) return { exitCode: 0, stdout: text, stderr: '' };
  try {
    deps.writeFile(flags.out, text);
  } catch (err) {
    return fail(
      2,
      'export',
      `cannot write ${flags.out}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const body = reply.body as { bindings?: unknown[]; definitions?: unknown[] };
  return {
    exitCode: 0,
    stdout: '',
    stderr: `Wrote ${flags.out}: ${body.bindings?.length ?? 0} binding(s), ${body.definitions?.length ?? 0} definition(s).\n`,
  };
}

/** `import <file>`: check locally, then apply (or preview with --dry-run). */
export async function executeBindingsImport(
  flags: BindingsImportFlags,
  file: string,
  deps: BindingsDeps,
): Promise<BindingsOutcome> {
  let raw: unknown;
  try {
    raw = JSON.parse(deps.readFile(file));
  } catch (err) {
    return fail(
      2,
      'import',
      `cannot read ${file} as JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let payload: BindingPayload;
  try {
    payload = parsePayload(raw);
    validatePayload(payload);
  } catch (err) {
    if (err instanceof PayloadError) {
      return fail(2, 'import', `${file} refused, nothing sent: ${err.message}`);
    }
    throw err;
  }

  const out: string[] = [];
  if (flags['repo-root']) {
    const root = flags['repo-root'];
    const missing = missingFiles(payload, (rel) => deps.exists(root, rel));
    for (const f of namedFiles(payload)) {
      out.push(`${missing.includes(f) ? 'MISSING' : 'present'}  ${f}`);
    }
    if (missing.length > 0) {
      return {
        exitCode: 1,
        stdout: `${out.join('\n')}\n`,
        stderr: `gates bindings import: ${missing.length} file(s) the lanes name are missing under ${root}; nothing sent\n`,
      };
    }
  }

  let reply: BindingsReply;
  try {
    // The file exactly as chosen: the server parses it with the same rules.
    reply = await deps.importConfig(raw, flags['dry-run']);
  } catch (err) {
    return fail(
      1,
      'import',
      `request failed: ${err instanceof Error ? err.message : String(err)}` +
        (flags['dry-run']
          ? ''
          : ' (the import may or may not have been applied; run it with --dry-run to see)'),
    );
  }
  if (reply.status !== 200) {
    return fail(1, 'import', serverMessage(reply.body, reply.status));
  }

  const result = reply.body as ImportResult;
  for (const d of result.definitions ?? []) {
    out.push(`${d.action.padEnd(8)} definition ${d.key}`);
  }
  for (const b of result.bindings ?? []) {
    const differs =
      b.action === 'differs' ? '  (NOT applied: the stored row differs)' : '';
    const note = b.note ? `  # ${b.note}` : '';
    out.push(
      `${b.action.padEnd(8)} ${b.gate_key} [${tierLabel(b)}]${differs}${note}`,
    );
  }
  const rows = [...(result.definitions ?? []), ...(result.bindings ?? [])];
  const written = rows.filter((r) => r.applied).length;
  out.push(
    result.dry_run
      ? '# Dry run: nothing written. Run again without --dry-run to apply.'
      : `# Applied: ${written} row(s) written.`,
  );
  const differs = rows.filter((r) => r.action === 'differs').length;
  return {
    exitCode: differs > 0 ? 1 : 0,
    stdout: `${out.join('\n')}\n`,
    stderr:
      differs > 0
        ? `gates bindings import: ${differs} row(s) differ from what the workspace stores and were not applied; change them in the workspace on purpose, or delete them and import again.\n`
        : '',
  };
}

/** The real dependencies: the logged-in backend (the public SDK), the disk. */
async function liveDeps(
  workspaceFlag: string | undefined,
): Promise<BindingsDeps | BindingsOutcome> {
  let auth;
  try {
    auth = await resolveToken();
  } catch (err) {
    return fail(
      1,
      'auth',
      err instanceof Error ? err.message : 'Authentication failed.',
    );
  }
  configureClient(auth);
  // As `levr gates run`: a JWT looks the workspace up; a PAT sends an
  // explicit one as given, else its own applies (internal).
  try {
    const ws = await resolveWorkspaceFor(auth, workspaceFlag);
    if (ws)
      client.setConfig({ ...client.getConfig(), workspaceId: ws.workspaceId });
  } catch (err) {
    return fail(
      1,
      'workspace',
      err instanceof Error ? err.message : 'Workspace resolution failed.',
    );
  }
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
    exportConfig: async () => reply(await gateBindingTransferExportConfigV1()),
    importConfig: async (file, dryRun) =>
      reply(
        await gateBindingTransferImportConfigV1({
          body: file as GateConfigFileDto,
          ...(dryRun ? { query: { dry_run: 'true' as const } } : {}),
        }),
      ),
    readFile: (file) => fs.readFileSync(file, 'utf8'),
    writeFile: (file, content) => fs.writeFileSync(file, content),
    exists: (root, rel) => fs.existsSync(path.join(root, rel)),
  };
}

function emit(ctx: LocalContext, outcome: BindingsOutcome): void {
  if (outcome.stdout) ctx.process.stdout.write(outcome.stdout);
  if (outcome.stderr) ctx.process.stderr.write(outcome.stderr);
  ctx.process.exitCode = outcome.exitCode;
}

export async function gatesBindingsExportHandler(
  this: LocalContext,
  flags: BindingsExportFlags,
): Promise<void> {
  const deps = await liveDeps(flags['workspace-id']);
  if ('exitCode' in deps) return emit(this, deps);
  emit(this, await executeBindingsExport(flags, deps));
}

export async function gatesBindingsImportHandler(
  this: LocalContext,
  flags: BindingsImportFlags,
  file: string,
): Promise<void> {
  // A file that does not parse is refused before logging in or calling out.
  let preflight: BindingsOutcome | null = null;
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    validatePayload(parsePayload(raw));
  } catch (err) {
    preflight = fail(
      2,
      'import',
      err instanceof PayloadError
        ? `${file} refused, nothing sent: ${err.message}`
        : `cannot read ${file} as JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (preflight) return emit(this, preflight);
  const deps = await liveDeps(flags['workspace-id']);
  if ('exitCode' in deps) return emit(this, deps);
  emit(this, await executeBindingsImport(flags, file, deps));
}
