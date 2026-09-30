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
- **A `using-levr` skill** that Claude loads by itself when it is about to change an issue. It covers two habits: send the `epoch` you read when you rewrite a description or title, and prefer a comment to rewriting a long description.

The plugin contains no agents, hooks or background processes. It does not change how you run your workflow.

## Requirements

- A Levr account.
- Claude Code. This plugin is tested with version 2.1.284.

## Staging and local servers

This plugin always connects to the production Levr server at `https://ai.levr.one/api/v1/mcp`.

To connect a staging or local server, use the command line installer and give it the address:

```bash
npx @levr-one/cli mcp add --url <mcp-url>
```

## If you already installed Levr another way

You may have connected Levr earlier with `npx @levr-one/cli mcp add` or `claude mcp add`.

- **Same address as this plugin:** nothing to do. Claude Code connects once, the tools appear once, and you still get the commands above.
- **A different address, such as staging:** Claude Code connects to both, and every Levr tool appears twice. Check which server a tool belongs to before you let Claude write. To keep only one, remove the other with `claude mcp remove levr` or uninstall this plugin.

## Other clients

This plugin is for Claude Code. For Cursor, VS Code, Codex and other MCP clients, run:

```bash
npx @levr-one/cli mcp add
```

## License

MIT. See [LICENSE](LICENSE).
