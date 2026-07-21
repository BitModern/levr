import { buildCommand } from '@stricli/core';

export const listCommand = buildCommand({
  docs: {
    brief: 'List available workspaces',
    fullDescription: `List all workspaces you have access to.

The current workspace (if selected) is marked with an asterisk (*).

Requires JWT authentication (levr auth login).

Examples:
  levr workspace list`,
  },
  parameters: {},
  loader: async () => {
    const { listHandler } = await import('./listHandler.js');
    return listHandler;
  },
});
