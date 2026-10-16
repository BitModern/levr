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
Claude Code, Codex CLI, Grok Build, Antigravity, Gemini CLI, Cursor, Windsurf,
Zed, VS Code) and write the Levr MCP server into each one's config. The entry is credential-free — the client opens a browser to
authorize with Levr the first time it connects.

--scope decides where the entry lands:
  user     every project you open (the default)
  project  this repository, shared with everyone who checks it out
  local    this repository, only you (Claude Code only)

Not every client supports every scope — Claude Desktop and Windsurf are user-only.
A client you name with --client fails if it cannot honor the
scope you asked for; one picked up by --all or interactively falls back to
the scope it does support, and the report says so.

--workspace pins the entry to one workspace (its MCP URL ends in
/w/<url_key>). Pass the workspace's url_key or its name. Without it, an
interactive run with several workspaces asks which one; a non-interactive run
writes the unpinned URL and lists the --workspace choices.

The entry is called "levr" unless you pass --name. When an entry of that name
already points somewhere else, the interactive picker asks whether to switch
it, add a second one beside it, or leave it. A non-interactive run leaves it
alone and exits 1: re-run with --replace to switch it to the new URL, or pick
another --name to keep both side by side. Two entries
means every Levr tool appears twice in that client, once per workspace.

Interactive by default; non-interactive when --all/--client/--yes is passed
or when not running in a terminal (CI). Config edits preserve existing
servers and comments, and re-running is a no-op.

Tool pre-approval (opt-in): for a client whose permission file has a
documented per-tool allow key (Claude Code, Cursor, Zed), the installer can
add entries that let your agent call Levr's non-destructive tools without
asking each time. It prints the exact file and every entry first, and asks
(default No). Non-interactively it writes them only with --preapprove-tools.
With --dry-run it prints what it would add and writes nothing. If a write
asked for with --preapprove-tools fails, the command exits 1.

Examples:
  npx @levr-one/cli@latest mcp add     # detect clients and pick interactively
  levr mcp add --all                   # set up every detected client
  levr mcp add --client cursor --yes
  levr mcp add --scope project         # commit the config to this repo
  levr mcp add --dry-run               # preview without writing
  levr mcp add --client claude-code --yes --preapprove-tools
  levr mcp add --workspace acme        # pin the entry to one workspace
  levr mcp add --workspace beta --replace          # switch it to another
  levr mcp add --workspace beta --name levr-beta   # add a second, side by side
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
      workspace: {
        kind: 'parsed',
        parse: String,
        brief: 'Pin the entry to this workspace (url_key or name)',
        placeholder: 'url_key|name',
        optional: true,
      },
      name: {
        kind: 'parsed',
        parse: String,
        brief: 'Name of the client entry (default: levr)',
        placeholder: 'entry',
        optional: true,
      },
      replace: {
        kind: 'boolean',
        optional: true,
        brief: 'Switch an existing entry of this name to the new URL',
      },
      'preapprove-tools': {
        kind: 'boolean',
        optional: true,
        brief:
          "Non-interactive: also pre-approve Levr's non-destructive tools in the client's permission file",
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
