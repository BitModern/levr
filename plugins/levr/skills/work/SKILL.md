---
name: work
description: Start work on a Levr issue. Use when the user names an issue and wants to understand it before changing anything, for example "work on ACME-42", "pick up ACME-42" or "what does ACME-42 need?". Reads the issue, its comments and its related issues, summarises them, and proposes a plan.
argument-hint: "<ISSUE-ID>"
---

# Start work on an issue

Issue: $ARGUMENTS

If no issue identifier was given, ask for one. Do not pick a likely match and start on it.

## 0. Confirm the workspace

Before any other Levr call, call `list_workspaces` on every Levr connection your client lists. Each one marks the workspace that connection reads and writes `[PINNED]` or `[SELECTED]`; a connection with none marked has no workspace selected.

- The user named a workspace: use the connection marked with it. If none is, tell the user that workspace is not connected yet and give them its command from step 4 of "If no workspace is selected". Never run this command against another workspace.
- The user named none and the marked connections all name the same workspace: use it.
- The user named none and the marked connections name more than one workspace: ask which one. Never choose for them.
- No connection has a marked workspace: follow "If no workspace is selected" at the end of this command. If `list_workspaces` says the account has no workspace yet, tell the user that and stop.

Make every call of this command on that one connection, and name its workspace when you report back.

## 1. Gather

Read everything before you summarise. Run the reads that do not depend on each other together.

1. `get_issue` with `identifier` set to the issue id. Keep `id` (the UUID), `parent_id` and `relations` from the result.
2. `get_issue_comments` with `issue_id` set to that UUID. Read every comment. Decisions and constraints are usually recorded there, not in the description.
3. The parent, when `parent_id` is set: `get_issue` with `id` set to it.
4. The children: `get_issues` with `parent_id` set to the UUID and `status: "all"`.
5. `relations` already gives each related issue's identifier, title and status. Read one in full, with `get_issue` and its `identifier`, only when you need more than that, such as why a blocker is still open.
6. Linked pull requests: `manage_pr_issue_links` with `query: { "issue_id": "<uuid>" }`.

If a read fails, say which one failed and carry on with the rest. Never fill the gap with a guess.

If a read reports that no workspace is selected, stop and follow "If no workspace is selected" at the end of this command.

## 2. Present the grounding

Give one compact block, in this order. Leave out a line that has nothing to say.

- **Issue:** identifier, title, workspace, and the web link if the result has one.
- **State:** workflow state, assignee, priority.
- **Acceptance criteria:** as a checklist, in the issue's own words. If the issue states none, say so plainly; do not invent any.
- **Decisions from comments:** one line each, with who decided and when.
- **Parent:** identifier and title.
- **Children:** identifier, title and state of each.
- **Blockers:** each blocking issue and its state. Say clearly if one is still open.
- **Linked pull requests:** number, title and status.
- **Open questions:** anything the issue leaves unclear or that the comments contradict.

Copy identifiers exactly as the tools return them. Keep the block short: it is a briefing, not a copy of the issue.

## 3. Propose a plan

Propose the steps you would take, in order, and tie each step to the acceptance criterion it satisfies. Name the files or areas you expect to touch. If a blocker is still open, say what can start now and what has to wait.

## 4. Ask before any write

Stop and ask the user to confirm or change the plan. Until they answer:

- do not edit files;
- do not change the issue: no state change, no assignment, no comment, no new sub-issues.

This command only reads. How the user moves the issue through its states is their decision.

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
