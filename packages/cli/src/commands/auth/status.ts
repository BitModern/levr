import { buildCommand } from '@stricli/core';

export const statusCommand = buildCommand({
  docs: {
    brief: 'Check authentication status',
    fullDescription: `Check the current authentication status.

Shows whether you are authenticated, the auth method (PAT or JWT),
and tests API reachability.

Examples:
  levr auth status`,
  },
  parameters: {},
  loader: async () => {
    const { statusHandler } = await import('./statusHandler.js');
    return statusHandler;
  },
});
