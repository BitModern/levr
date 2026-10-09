---
name: file
description: File a new issue in Levr. Use when the user wants to record a bug, task, feature or follow-up, for example "file an issue for this", "log a bug" or "track this in Levr". Picks the team, project and type from the workspace, checks for an existing issue, and creates it only after the user confirms.
argument-hint: "[what to file]"
---

# File an issue

What to file: $ARGUMENTS

If it is not clear what should be filed, ask. One issue per problem: if the user describes several, propose one issue for each.

## 0. Confirm the workspace

Before any other Levr call, call `list_workspaces` on every Levr connection your client lists. Each one marks the workspace that connection reads and writes `[PINNED]` or `[SELECTED]`; a connection with none marked has no workspace selected.

- The user named a workspace: use the connection marked with it. If none is, tell the user that workspace is not connected yet and give them its command from step 4 of "If no workspace is selected". Never run this command against another workspace.
- The user named none and the marked connections all name the same workspace: use it.
- The user named none and the marked connections name more than one workspace: ask which one. Never choose for them.
- No connection has a marked workspace: follow "If no workspace is selected" at the end of this command. If `list_workspaces` says the account has no workspace yet, tell the user that and stop.

Make every call of this command on that one connection, and name its workspace when you report back. The workspace you confirm here is where the issue will be filed.

## 1. Find where it belongs

1. `get_context`. It returns your user id and the workspace's teams and projects.
2. Read the `description` of each team and project and choose the ones that match. If a description says not to file there, do not. If nothing matches, leave the project out and tell the user; do not pick the closest name.
3. `get_labels` with `groups: ["Type"]`. Choose the type that matches the work and keep its id.

## 2. Look for an existing issue

`search_issues` with a short description of the problem in plain words, not code symbols. Run it again with different wording if the first result is empty.

Show the closest matches with identifier, title and state. If one covers the same problem, ask whether to add a comment there instead of filing a new issue.

## 3. Draft

- **Title:** 60 characters or fewer, written as an action. "Fix login timeout on slow connections", not "Login problem".
- **Description:** one to three sentences: what is wrong or wanted, and why it matters. Add steps to reproduce for a bug, and acceptance criteria when the user gave them.
- **Priority:** 1 urgent, 2 high, 3 medium, 4 low. Use 3 unless the user said otherwise.
- **Parent:** set `parent_id` when this is part of a larger issue the user named.

Write only what the user told you or what you observed. Do not add requirements they did not state.

## 4. Confirm, then create

Show the draft in one block: workspace, team, project, type, title, description, priority and parent. Name the workspace first, so the user can see where the issue will be filed before they confirm. Ask the user to confirm or change it.

After they confirm, call `manage_issues` with one entry in `create`:

- `title`, `description`, `team_id`, `priority`;
- `project_id` and `parent_id` when chosen;
- `type_label_id` from section 1.

Do not create the issue before the user confirms.

## 5. Report

Give the identifier exactly as the tool returned it, with the web link if there is one. If the call failed, show the error as returned and do not retry with changed values unless the user asks.

## If no workspace is selected

A Levr call can report that no workspace is selected: the account has more than one workspace and this connection names none. Then:

1. Stop the task: do not retry the call, do not try another Levr tool to get around it, and write nothing. The one Levr call still to make is `list_workspaces`, if you have not made it yet.
2. Show each workspace's name with the MCP URL `list_workspaces` lists for it. If it lists no URL, say so and tell the user to open that workspace in the Levr app and copy the URL from **Settings › MCP Setup**. Never build a URL yourself.
3. Ask which workspace they mean. Never choose one for them.
4. For the one they pick, give them this command with its URL. Name the entry `levr-` plus its `url_key`, shortened so the whole name has 30 characters at most:

   ```bash
   claude mcp add --transport http --scope user levr-<url_key> <workspace MCP URL>
   ```

   They sign in with `/mcp` (restart Claude Code if the entry is not listed) and run this command again. To keep this plugin's own connection from listing every tool a second time, they can add `"deniedMcpServers": [{ "serverName": "plugin:levr:levr" }]` to `~/.claude/settings.json`, keeping the keys already in it.

The workspace's URL works in every client. Do not send the user to edit a `Workspace-Id` header instead.
