import { buildCommand } from '@stricli/core';

export const selectCommand = buildCommand({
  docs: {
    brief: 'Select a workspace',
    fullDescription: `Select a workspace by ID.

The selected workspace is used for all subsequent commands.
Use 'levr workspace list' to see available workspaces.

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
