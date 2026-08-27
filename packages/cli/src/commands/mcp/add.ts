import { buildCommand } from '@stricli/core';

// `import type` FORM only — it is erased at compile time, so this file (which
// app.ts loads eagerly) does not pull the harness catalog into `levr push` in
// CI. The handler chunk stays lazy.
import type { HarnessScope } from '@levr/mcp-harnesses';

const SCOPES: readonly HarnessScope[] = ['user', 'project', 'local'];

/** Validate `--scope` at parse time so a typo fails before anything is read. */
function parseScope(raw: string): HarnessScope {
  const value = raw.trim().toLowerCase();
  const match = SCOPES.find((s) => s === value);
  if (!match) {
    throw new Error(
      `invalid --scope "${raw}" (expected one of: ${SCOPES.join(', ')})`,
    );
  }
  return match;
}

export const mcpAddCommand = buildCommand({
  docs: {
    brief: 'Add the Levr MCP server to installed AI clients',
    fullDescription: `Detect MCP-capable clients on this machine (Claude Desktop,
Claude Code, Cursor, Windsurf, Zed) and write the Levr MCP server into each
one's config. The entry is credential-free — the client opens a browser to
authorize with Levr the first time it connects.

--scope decides where the entry lands:
  user     every project you open (the default)
  project  this repository, shared with everyone who checks it out
  local    this repository, only you (Claude Code only)

Not every client supports every scope — Claude Desktop and Windsurf are
user-only. A client you name with --client fails if it cannot honor the
scope you asked for; one picked up by --all or interactively falls back to
the scope it does support, and the report says so.

Interactive by default; non-interactive when --all/--client/--yes is passed
or when not running in a terminal (CI). Config edits preserve existing
servers and comments, and re-running is a no-op.

Examples:
  npx @levr-one/cli mcp add            # detect clients and pick interactively
  levr mcp add --all                   # set up every detected client
  levr mcp add --client cursor --yes
  levr mcp add --scope project         # commit the config to this repo
  levr mcp add --dry-run               # preview without writing
  levr mcp add --url <mcp-url>         # target a non-default MCP server`,
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
      scope: {
        kind: 'parsed',
        parse: parseScope,
        brief: 'Where to install: user (default), project, or local',
        placeholder: 'user|project|local',
        optional: true,
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
