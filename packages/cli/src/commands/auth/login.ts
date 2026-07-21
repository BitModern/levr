import { buildCommand } from '@stricli/core';

export const loginCommand = buildCommand({
  docs: {
    brief: 'Authenticate with Levr',
    fullDescription: `Authenticate with Levr using OAuth.

By default, opens a browser for PKCE-based authentication.
For headless environments (SSH, containers), use --device-code
to authenticate via a code displayed in the terminal.

Examples:
  levr auth login                 # Browser-based PKCE login
  levr auth login --device-code   # Device flow for SSH/headless`,
  },
  parameters: {
    flags: {
      'device-code': {
        kind: 'boolean',
        default: false,
        brief: 'Use device code flow (for SSH/headless environments)',
      },
    },
    aliases: {
      d: 'device-code',
    },
  },
  loader: async () => {
    const { loginHandler } = await import('./loginHandler.js');
    return loginHandler;
  },
});
