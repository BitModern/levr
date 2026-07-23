import { buildCommand } from '@stricli/core';

export const mcpAddCommand = buildCommand({
  docs: {
    brief: 'Add the Levr MCP server to installed AI clients',
    fullDescription: `Detect MCP-capable clients on this machine (Claude Desktop,
Claude Code, Cursor, Windsurf, Zed) and write the Levr MCP server into each
one's config. The entry is credential-free — the client opens a browser to
authorize with Levr the first time it connects.

Interactive by default; non-interactive when --all/--client/--yes is passed
or when not running in a terminal (CI). Config edits preserve existing
servers and comments, and re-running is a no-op.

Examples:
  npx @levr-one/cli mcp add        # detect clients and pick interactively
  levr mcp add --all               # set up every detected client
  levr mcp add --client cursor --yes
  levr mcp add --dry-run           # preview without writing
  levr mcp add --url <mcp-url>     # target a non-default MCP server`,
  },
  parameters: {
    flags: {
      client: {
        kind: 'parsed',
        parse: String,
        brief: 'Set up these client ids (comma-separated or repeated)',
        placeholder: 'id[,id]',
        variadic: true,
        optional: true,
      },
      all: {
        kind: 'boolean',
        default: false,
        brief: 'Set up every detected, installable client',
      },
      yes: {
        kind: 'boolean',
        default: false,
        brief: 'Non-interactive; auto-select detected clients',
      },
      'dry-run': {
        kind: 'boolean',
        default: false,
        brief: 'Show changes without writing',
      },
      url: {
        kind: 'parsed',
        parse: String,
        brief: 'MCP server URL (default derived from the API server)',
        placeholder: 'url',
        optional: true,
      },
    },
    aliases: {
      y: 'yes',
    },
  },
  loader: async () => {
    const { mcpAddHandler } = await import('./addHandler.js');
    return mcpAddHandler;
  },
});
