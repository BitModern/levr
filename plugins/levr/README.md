# Levr for Claude Code

Work your [Levr](https://levr.one) issues from Claude Code. The plugin connects Claude Code to the Levr MCP server and adds three commands for the moves you make most often.

## Install

```bash
claude plugin marketplace add BitModern/levr
claude plugin install levr@levr
```

Inside a Claude Code session the same two steps are `/plugin marketplace add BitModern/levr` and `/plugin install levr@levr`.

Then sign in. Run `/mcp`, choose `levr`, and follow the browser prompt. Levr uses OAuth, so the plugin's own files hold no token or password.

## What you get

| Command | What it does |
| --- | --- |
| `/levr:work <ISSUE-ID>` | Reads the issue, its comments and its related issues, gives you a short briefing, and proposes a plan. It changes nothing until you agree. |
| `/levr:file` | Files a new issue. It picks the team, project and type from your workspace, checks for an existing issue, and creates one only after you confirm. |
| `/levr:done <ISSUE-ID>` | Records what changed in a comment, links the pull request, and moves the issue to its done state. If Levr refuses the move, it tells you why and stops. |

The plugin also includes:

- **The Levr MCP server connection**, so every Levr tool is available to Claude.
- **A `using-levr` skill** that Claude loads by itself when it is about to change an issue. It covers a few habits: send the `epoch` you read when you rewrite a description or title, prefer a comment to rewriting a long description, and when no workspace is selected, ask you which one to use instead of choosing for you.

The plugin contains no agents, hooks or background processes. It does not change how you run your workflow.

## Requirements

- A Levr account.
- Claude Code. This plugin is tested with version 2.1.284.

## More than one workspace

If your account has one workspace, the plugin uses it and there is nothing to set up.

If you belong to several, the plugin's connection does not know which one you mean. Its tools then reply that no workspace is selected, and nothing is read or written. Claude lists your workspaces and asks which one to use; it never picks one for you.

Connect each workspace you work in by its own address. Every workspace has one, ending in `/v1/mcp/w/<url_key>`. Ask Claude to list your workspaces to see them, or copy it from **Settings › MCP Setup** in the Levr app.

1. Add the workspace, naming the entry after it. Keep the name to 30 characters or fewer: it becomes part of every Levr tool's name, and Claude Code refuses every request once a tool name passes 128 characters.

   ```bash
   claude mcp add --transport http --scope user levr-acme https://ai.levr.one/api/v1/mcp/w/acme
   ```

   The command line installer does the same once you are signed in to it: `npx @levr-one/cli@latest auth login`, then `npx @levr-one/cli@latest mcp add --client claude-code --workspace acme --name levr-acme`.

   Run `/mcp`, choose the new entry and sign in. If it is not listed, restart Claude Code. Repeat for each workspace you use.

2. Hide the plugin's own connection, so each Levr tool is listed once per workspace instead of once more for a connection that cannot write. Add the `deniedMcpServers` key to `~/.claude/settings.json`, keeping the keys already in the file. If the key is already there, add the entry to its list:

   ```json
   {
     "deniedMcpServers": [{ "serverName": "plugin:levr:levr" }]
   }
   ```

   This applies in every project. The `/levr:` commands keep working; they use the workspace connections. To hide it in one project only, use `/mcp` and disable `plugin:levr:levr` there instead.

A workspace's address is a different address from the plugin's, so Claude Code keeps both connections until you hide one; that is why the second step is needed. With several workspaces connected, say which one you mean, and Claude asks when you have not.

## Staging and local servers

This plugin always connects to the production Levr server at `https://ai.levr.one/api/v1/mcp`.

To connect a staging or local server, use the command line installer and give it the address:

```bash
npx @levr-one/cli@latest mcp add --url <mcp-url>
```

## If you already installed Levr another way

You may have connected Levr earlier with `npx @levr-one/cli@latest mcp add` or `claude mcp add`.

- **Same address as this plugin:** nothing to do. Claude Code connects once, the tools appear once, and you still get the commands above.
- **A different address, such as staging:** Claude Code connects to both, and every Levr tool appears twice. Check which server a tool belongs to before you let Claude write. To keep only one, remove the other with `claude mcp remove levr` or uninstall this plugin.
- **A workspace address:** keep it, and hide the plugin's own connection as in step 2 of [More than one workspace](#more-than-one-workspace). Removing the workspace entry instead leaves only a connection that cannot read or write when your account has several workspaces.

## Other clients

This plugin is for Claude Code. For Cursor, VS Code, Codex and other MCP clients, run:

```bash
npx @levr-one/cli@latest mcp add
```

## License

MIT. See [LICENSE](LICENSE).
