import { buildCommand } from '@stricli/core';

export const selectCommand = buildCommand({
  docs: {
    brief: 'Select the CLI workspace (MCP client configs are unchanged)',
    fullDescription: `Select a workspace by ID.

The selected workspace is used for all subsequent levr commands.
Use 'levr workspace list' to see available workspaces.

It does not change MCP client configs: each AI client keeps using the
workspace its MCP URL names. To point a client at a workspace, run
'levr mcp add --workspace <url_key>' (add --replace to switch an existing
entry).

Requires JWT authentication (levr auth login).

Examples:
  levr workspace select <workspace-id>`,
  },
  parameters: {
    positional: {
      kind: 'tuple',
      parameters: [
        {
          parse: String,
          brief: 'Workspace ID',
          placeholder: 'workspace-id',
          optional: false,
        },
      ] as const,
    },
    flags: {},
  },
  loader: async () => {
    const { selectHandler } = await import('./selectHandler.js');
    return selectHandler;
  },
});
