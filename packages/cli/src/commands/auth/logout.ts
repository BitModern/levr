import { buildCommand } from '@stricli/core';

export const logoutCommand = buildCommand({
  docs: {
    brief: 'Log out of Levr',
    fullDescription: `Remove stored credentials.

Note: If using LEVR_TOKEN environment variable, it will remain set.

Examples:
  levr auth logout`,
  },
  parameters: {},
  loader: async () => {
    const { logoutHandler } = await import('./logoutHandler.js');
    return logoutHandler;
  },
});
