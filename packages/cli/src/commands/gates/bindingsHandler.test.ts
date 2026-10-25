/**
 * [issue:internal D8.3] `levr gates bindings export|import`, driven through
 * injected dependencies so every assertion is on what would reach the
 * server: which call, with which file, with or without dry_run.
 *
 * Carries the CLI half of the deleted apply-gate-bindings.test.ts ("exits 1
 * on a missing lane file", "a dry run writes nothing").
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  executeBindingsExport,
  executeBindingsImport,
  type BindingsDeps,
  type BindingsReply,
} from './bindingsHandler.js';

const AGV = readFileSync(
  fileURLToPath(
    new URL(
      '../../../../../scripts/gates/bindings/lansweeper-agv.json',
      import.meta.url,
    ),
  ),
  'utf8',
);

const row = (
  gate_key: string,
  action: string,
  applied: boolean,
  extra: object = {},
) => ({
  gate_key,
  repo_key: null,
  path_prefix: null,
  action,
  applied,
  ...extra,
});

function deps(
  over: {
    files?: Record<string, string>;
    present?: string[];
    importReply?: (file: unknown, dryRun: boolean) => BindingsReply;
    exportReply?: BindingsReply;
  } = {},
): BindingsDeps & {
  importConfig: ReturnType<typeof vi.fn>;
  exportConfig: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
} {
  const files: Record<string, string> = { 'agv.json': AGV, ...over.files };
  const present = new Set(over.present ?? []);
  return {
    exportConfig: vi.fn(() =>
      Promise.resolve(
        over.exportReply ?? {
          status: 200,
          body: { definitions: [], bindings: [] },
        },
      ),
    ),
    importConfig: vi.fn((file: unknown, dryRun: boolean) =>
      Promise.resolve(
        over.importReply?.(file, dryRun) ?? {
          status: 200,
          body: {
            dry_run: dryRun,
            definitions: [],
            bindings: [
              row('typecheck', 'create', !dryRun),
              row('lint', 'update', !dryRun, { note: 'off until clippy' }),
            ],
          },
        },
      ),
    ),
    readFile: (f: string) => {
      if (!(f in files)) throw new Error(`ENOENT: ${f}`);
      return files[f]!;
    },
    writeFile: vi.fn<(file: string, content: string) => void>(),
    exists: (_root: string, rel: string) => present.has(rel),
  };
}

const IMPORT = { 'dry-run': false } as const;

describe('gates bindings import', () => {
  it('applies by default: sends the file as chosen, without dry_run', async () => {
    const d = deps();
    const out = await executeBindingsImport(IMPORT, 'agv.json', d);
    expect(out.exitCode).toBe(0);
    expect(d.importConfig).toHaveBeenCalledOnce();
    expect(d.importConfig).toHaveBeenCalledWith(JSON.parse(AGV), false);
    expect(out.stdout).toContain('create   typecheck [workspace-wide]');
    expect(out.stdout).toContain(
      'update   lint [workspace-wide]  # off until clippy',
    );
    expect(out.stdout).toContain('# Applied: 2 row(s) written.');
  });

  it('--dry-run sends dry_run=true and says nothing was written', async () => {
    const d = deps();
    const out = await executeBindingsImport({ 'dry-run': true }, 'agv.json', d);
    expect(out.exitCode).toBe(0);
    expect(d.importConfig).toHaveBeenCalledWith(JSON.parse(AGV), true);
    expect(out.stdout).toContain('# Dry run: nothing written.');
  });

  it('a file that is not JSON, or that the shared parser refuses, exits 2 and sends nothing', async () => {
    const d = deps({
      files: {
        'bad.json': '{ not json',
        'refused.json': JSON.stringify({
          bindings: [{ gate_key: 'lint', delete: true, config: {} }],
        }),
        'cmd.json': JSON.stringify({
          bindings: [
            {
              gate_key: 'typecheck',
              config: { cmd: { typecheck: 'rm -rf /' } },
            },
          ],
        }),
      },
    });
    for (const f of ['bad.json', 'refused.json', 'cmd.json', 'missing.json']) {
      const out = await executeBindingsImport(IMPORT, f, d);
      expect(out.exitCode, f).toBe(2);
    }
    expect(
      (await executeBindingsImport(IMPORT, 'refused.json', d)).stderr,
    ).toMatch(/nothing sent: .*remove "config"/);
    expect(d.importConfig).not.toHaveBeenCalled();
  });

  it('a differs row exits 1 and is reported as not applied', async () => {
    const d = deps({
      importReply: () => ({
        status: 200,
        body: {
          dry_run: false,
          definitions: [],
          bindings: [
            row('typecheck', 'differs', false, { stored_id: 'b-1' }),
            row('lint', 'exists', false),
          ],
        },
      }),
    });
    const out = await executeBindingsImport(IMPORT, 'agv.json', d);
    expect(out.exitCode).toBe(1);
    expect(out.stdout).toContain(
      'differs  typecheck [workspace-wide]  (NOT applied: the stored row differs)',
    );
    expect(out.stderr).toContain('1 row(s) differ');
  });

  it('a 403 prints the server message and exits 1', async () => {
    const message =
      'Importing the workspace gate configuration reads or writes the commands every gate in the workspace runs, so it requires the gate-impl capability (Owner or Admin). Ask an admin.';
    const d = deps({
      importReply: () => ({ status: 403, body: { statusCode: 403, message } }),
    });
    const out = await executeBindingsImport(IMPORT, 'agv.json', d);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain(message);
  });

  it('a second run writes nothing: every row exists, delete rows absent, exit 0', async () => {
    const d = deps({
      importReply: (_f, dryRun) => ({
        status: 200,
        body: {
          dry_run: dryRun,
          definitions: [{ key: 'custom', action: 'exists', applied: false }],
          bindings: [
            row('typecheck', 'exists', false),
            row('security', 'absent', false),
          ],
        },
      }),
    });
    const out = await executeBindingsImport(IMPORT, 'agv.json', d);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain('# Applied: 0 row(s) written.');
    expect(out.stdout).toContain('absent   security');
  });

  it('--repo-root: a missing lane file exits 1 before anything is sent', async () => {
    const d = deps({ present: ['scripts/tomdb_preflight.sh'] });
    const out = await executeBindingsImport(
      { ...IMPORT, 'repo-root': '/agv' },
      'agv.json',
      d,
    );
    expect(out.exitCode).toBe(1);
    expect(out.stdout).toContain('present  scripts/tomdb_preflight.sh');
    expect(out.stdout).toContain('MISSING  tests/architecture_guards.rs');
    expect(d.importConfig).not.toHaveBeenCalled();
  });

  it('a request that never answered says an import may have applied', async () => {
    const d = deps();
    d.importConfig.mockRejectedValueOnce(new Error('socket hang up'));
    const out = await executeBindingsImport(IMPORT, 'agv.json', d);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain('may or may not have been applied');
  });
});

describe('gates bindings export', () => {
  const body = {
    definitions: [],
    bindings: [{ gate_key: 'lint', enabled: false, config: {} }],
  };

  it('prints the file on stdout', async () => {
    const out = await executeBindingsExport(
      {},
      deps({ exportReply: { status: 200, body } }),
    );
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual(body);
  });

  it('--out writes the file and reports the counts on stderr', async () => {
    const d = deps({ exportReply: { status: 200, body } });
    const out = await executeBindingsExport({ out: 'gates.json' }, d);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toBe('');
    expect(d.writeFile).toHaveBeenCalledWith(
      'gates.json',
      `${JSON.stringify(body, null, 2)}\n`,
    );
    expect(out.stderr).toContain('1 binding(s), 0 definition(s)');
  });

  it('a 403 prints the server message and exits 1', async () => {
    const out = await executeBindingsExport(
      {},
      deps({
        exportReply: {
          status: 403,
          body: {
            message: 'requires the gate-impl capability (Owner or Admin)',
          },
        },
      }),
    );
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain('Owner or Admin');
  });
});
