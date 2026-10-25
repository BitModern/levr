import { buildCommand } from '@stricli/core';

export const gatesBindingsExportCommand = buildCommand({
  docs: {
    brief: "Export the workspace's gate configuration as JSON",
    fullDescription: `Write the workspace's own gate bindings (every tier) and the gate
definitions people in the workspace authored, as one JSON file: the format
\`levr gates bindings import\` reads. Sorted, so exporting an unchanged
workspace twice gives the same bytes.

Owner or Admin only: the file holds every command the workspace's gates run.

Writes to stdout unless --out is given.

Exit code 0 on success, 1 when the server refuses (a Member gets 403) or the
request fails, 2 for a usage error.

Examples:
  levr gates bindings export > gates.json
  levr gates bindings export --out gates.json --workspace-id <uuid>`,
  },
  parameters: {
    flags: {
      'workspace-id': {
        kind: 'parsed',
        parse: String,
        brief:
          'Workspace ID: needed with a login token and several workspaces; a personal access token is bound to its own',
        placeholder: 'uuid',
        optional: true,
      },
      out: {
        kind: 'parsed',
        parse: String,
        brief: 'Write the file here instead of stdout',
        placeholder: 'file',
        optional: true,
      },
    },
    aliases: { w: 'workspace-id', o: 'out' },
  },
  loader: async () => {
    const { gatesBindingsExportHandler } = await import('./bindingsHandler.js');
    return gatesBindingsExportHandler;
  },
});
