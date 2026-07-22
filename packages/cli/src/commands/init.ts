import { buildCommand } from '@stricli/core';

export const initCommand = buildCommand({
  docs: {
    brief: 'First-run setup: authenticate and list your workspaces',
    fullDescription: `Set up the Levr CLI: authenticate (if needed) and list your workspaces.

Reuses an existing session when one is stored — running init again never
re-opens the browser unnecessarily. For headless environments (SSH,
containers), use --device-code.

Examples:
  npx @levr-one/cli init          # First-run onboarding
  levr init --device-code         # Headless/SSH onboarding
  levr init --url <api-url>       # Target a non-default API server`,
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
    },
    aliases: {
      d: 'device-code',
    },
  },
  loader: async () => {
    const { initHandler } = await import('./initHandler.js');
    return initHandler;
  },
});
