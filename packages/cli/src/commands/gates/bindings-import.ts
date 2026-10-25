import { buildCommand } from '@stricli/core';

export const gatesBindingsImportCommand = buildCommand({
  docs: {
    brief: 'Import a gate configuration file into the workspace',
    fullDescription: `Apply a gate configuration file (the format \`levr gates bindings export\`
writes) to the workspace. The file is parsed and checked here first, so a
malformed file is refused before anything is sent.

The import APPLIES unless --dry-run is given; --dry-run previews the plan and
writes nothing. One line per entry:
  create   not stored yet; created
  exists   stored exactly as the file says; nothing to do
  differs  stored differently; reported and NOT overwritten
  update   the disabled placeholder a workspace starts with; filled in
  delete   the entry says "delete": true; the stored binding is removed
  absent   the entry says "delete": true; nothing was stored
A binding the file does not mention is never touched: deletes are explicit.
Running the same import twice writes nothing the second time.

Owner or Admin only.

--repo-root checks that every file the lanes name (scripts, tests/<name>.rs
for --test <name>) exists in that checkout before sending.

Exit code 0 on success; 1 when the server refuses (403, 400), a lane file is
missing, a row differs, or the request fails; 2 for a usage error or a file
that does not parse.

Examples:
  levr gates bindings import gates.json --dry-run
  levr gates bindings import gates.json
  levr gates bindings import scripts/gates/bindings/lansweeper-agv.json --repo-root ~/src/agv`,
  },
  parameters: {
    positional: {
      kind: 'tuple',
      parameters: [
        {
          parse: String,
          brief: 'The gate configuration JSON file',
          placeholder: 'file',
          optional: false,
        },
      ] as const,
    },
    flags: {
      'workspace-id': {
        kind: 'parsed',
        parse: String,
        brief:
          'Workspace ID: needed with a login token and several workspaces; a personal access token is bound to its own',
        placeholder: 'uuid',
        optional: true,
      },
      'repo-root': {
        kind: 'parsed',
        parse: String,
        brief: 'Check every file the lanes name exists under this checkout',
        placeholder: 'path',
        optional: true,
      },
      'dry-run': {
        kind: 'boolean',
        default: false,
        brief: 'Preview the plan; write nothing',
      },
    },
    aliases: { w: 'workspace-id' },
  },
  loader: async () => {
    const { gatesBindingsImportHandler } = await import('./bindingsHandler.js');
    return gatesBindingsImportHandler;
  },
});
