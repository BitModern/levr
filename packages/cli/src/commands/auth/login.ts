import { buildCommand } from '@stricli/core';

export const loginCommand = buildCommand({
  docs: {
    brief: 'Authenticate with Levr',
    fullDescription: `Authenticate with Levr using OAuth.

By default, opens a browser for PKCE-based authentication.
For headless environments (SSH, containers), use --device-code
to authenticate via a code displayed in the terminal.

With --workspace, the login selects that workspace for the CLI, and a
url_key also skips the workspace picker in the browser.

Examples:
  levr auth login                   # Browser-based PKCE login
  levr auth login --device-code     # Device flow for SSH/headless
  levr auth login --workspace acme  # Skip the picker; select acme`,
  },
  parameters: {
    flags: {
      'device-code': {
        kind: 'boolean',
        default: false,
        brief: 'Use device code flow (for SSH/headless environments)',
      },
      url: {
        kind: 'parsed',
        parse: String,
        brief: 'API base URL (default: https://api.levr.one)',
        placeholder: 'url',
        optional: true,
      },
      workspace: {
        kind: 'parsed',
        parse: String,
        brief:
          'Workspace to select, by url_key or name (a url_key also skips the workspace picker)',
        placeholder: 'url_key|name',
        optional: true,
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
