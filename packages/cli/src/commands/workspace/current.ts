import { buildCommand } from '@stricli/core';

export const currentCommand = buildCommand({
  docs: {
    brief: 'Show current workspace',
    fullDescription: `Show the currently selected workspace.

Examples:
  levr workspace current`,
  },
  parameters: {},
  loader: async () => {
    const { currentHandler } = await import('./currentHandler.js');
    return currentHandler;
  },
});
