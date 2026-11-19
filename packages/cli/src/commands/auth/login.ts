import { buildCommand } from '@stricli/core';

export const loginCommand = buildCommand({
  docs: {
    brief: 'Authenticate with Levr',
    fullDescription: `Authenticate with Levr using OAuth.

By default, opens a browser for PKCE-based authentication and prints
the link too. When no browser can be opened (SSH, containers, no
display) it uses a device code instead; while waiting, press d to switch
to a device code. --device-code skips the browser altogether.

With --signup, the browser opens on the signup page; the new account's
token comes back to the CLI the same way (same as 'levr auth signup').

With --workspace, the login selects that workspace for the CLI, and a
url_key also skips the workspace picker in the browser.

With --admin, the login also requests workspace administration
(workspace:admin), which connecting integrations, changing on-demand
sharing and managing members need. It is never granted by default.

Examples:
  levr auth login                   # Browser-based PKCE login
  levr auth login --device-code     # Device flow for SSH/headless
  levr auth login --signup          # Create an account, then log in
  levr auth login --workspace acme  # Skip the picker; select acme
  levr auth login --admin           # Also request workspace administration`,
  },
  parameters: {
    flags: {
      'device-code': {
        kind: 'boolean',
        default: false,
        brief: 'Use device code flow (for SSH/headless environments)',
      },
      signup: {
        kind: 'boolean',
        default: false,
        brief: 'Open the signup page instead of sign-in',
      },
      admin: {
        kind: 'boolean',
        default: false,
        brief:
          'Also request workspace administration (workspace:admin): needed to connect integrations, change on-demand sharing, or manage members',
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

/** `levr auth signup` (internal): the login flow, opened on signup. */
export const signupCommand = buildCommand({
  docs: {
    brief: 'Create a Levr account and log in',
    fullDescription: `Create a Levr account, then log the CLI in to it.

Opens the browser on the signup page and prints the link too. Once the
account exists, the token comes back to the CLI. When no browser can be
opened it uses a device code instead; while waiting, press d to switch to
a device code.

Examples:
  levr auth signup                  # Browser signup, token to the CLI
  levr auth signup --device-code    # Device flow for SSH/headless`,
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
    const { signupHandler } = await import('./loginHandler.js');
    return signupHandler;
  },
});
