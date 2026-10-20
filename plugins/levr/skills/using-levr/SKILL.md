---
name: using-levr
description: Habits for writing to Levr safely. Use before changing an issue's description or title, before rewriting a long issue body, when a Levr tool reports that no workspace is selected, and when Levr tools appear twice or a Levr tool name does not resolve.
---

# Using Levr well

The Levr server already explains its tools in its own instructions and in each tool's description. Follow those. This skill adds only what they do not say.

## Pass `epoch` on a write that came from a read

`manage_issues` updates are last-write-wins. If you read an issue, compose a new description or title from it, and write it back, anything edited in between is overwritten with no error.

To prevent that, send the `epoch` from your `get_issue` result with the update:

```json
{ "update": [{ "id": "<uuid>", "epoch": 7, "description": "..." }] }
```

If the issue changed since you read it, that item comes back with status 412 and nothing is written for it. The other items in the same call are still applied. Read the issue again, apply your change to the new text, and send it with the new `epoch`.

A 412 does not always mean a person edited the issue. Levr changes an issue too, for example when one of its sub-issues is completed. Either way the answer is the same: read again, then write.

Update an issue once in a call. A second update to the same issue in that call carries an `epoch` the first one has already moved.

Do not leave `epoch` out to get past a 412.

Leave `epoch` out when you mean to overwrite, such as setting a priority or an assignee.

## Prefer a comment to rewriting a long description

A description can only be replaced whole. There is no append and no partial edit. Rewriting a long one takes time, and the longer it takes, the more likely someone else edits it meanwhile.

- To record progress, a decision or a result, use `add_issue_comment`.
- Rewrite the description only when the description itself is wrong, and pass `epoch` when you do.

## Moving an issue through its workflow

Passing gates or runs never move an issue. You move it, and the server instructions say when. This adds how:

- **Find the states first.** `get_labels(groups:["Type"], include_workflow_states:true)` lists each type's states in order. A type with no states of its own uses its team's states, which that call does not list; `transition_issue` with a `state_name` it cannot match lists the states it accepts. State names differ between workspaces and types, so prefer `state_type` (`in_progress`, `done`) in `transition_issue`. It takes the first state of that type in the issue's workflow.
- **Use a review state when the workflow has one.** Some workflows have more than one `in_progress` state, such as Gates Pending or In Review. `state_type:"in_progress"` always lands on the first, so name a later one with `state_name`.
- **Read the `next_step` line.** The gate tools end with `Next step (<issue>, <action>): …` when there is something to do about the issue's state: start it, finish reporting its gates, redeploy untyped gates, clear what would refuse Done, or close it. `close` still means: ask before closing unless the user asked for it.
- **Check blockers before closing.** `get_issue` returns the issue's `relations`; look for `blocks` and `blocked_by`. An open blocker does not stop the transition, but tell the user about it.
- **A merged PR can close the issue for you.** When a PR names the issue as one it closes, merging it moves the issue to done. For ongoing work, reference it on an `Issue: <identifier>` line in the PR body instead, so the merge leaves it open.

## When no workspace is selected

An account in more than one Levr workspace needs a connection that names one. When a Levr tool reports that no workspace is selected:

1. If another Levr connection's `list_workspaces` marks the workspace the user named `[PINNED]` or `[SELECTED]`, use that connection instead. Otherwise stop the task: do not retry the call, and do not try another Levr tool to get around it. The one Levr call still to make is `list_workspaces`.
2. Call `list_workspaces` and show the user each workspace's name with the MCP URL it lists.
3. Ask which workspace they mean. Never choose a workspace for the user, even when one looks likely.
4. For the one they pick, give them this command with its URL. Name the entry `levr-` plus its `url_key`, shortened so the whole name has 30 characters at most: Claude Code refuses every request once a tool name passes 128 characters, and the entry name is part of each tool's name.

   ```bash
   claude mcp add --transport http --scope user levr-<url_key> <workspace MCP URL>
   ```

   They sign in with `/mcp`; if the new entry is not listed there, they restart Claude Code. Without a workspace, this plugin's own connection lists `list_workspaces` (and, on newer servers, `get_whats_new`) but no workspace tools such as `get_issues`; to hide it entirely, they can add the key `"deniedMcpServers": [{ "serverName": "plugin:levr:levr" }]` to their `~/.claude/settings.json`, keeping the keys already in it.

If `list_workspaces` gives no URL for a workspace, say so and tell the user to open that workspace in the Levr app and copy the URL from **Settings › MCP Setup**. Never build a URL yourself.

The workspace's URL works in every client. Do not send the user to edit a header instead.

## One connection per workspace

With a connection for each workspace, every Levr tool is listed once for each of them. Before the first Levr call of a task, read or write, call `list_workspaces` on each Levr connection. It marks the connection's workspace `[PINNED]` (a workspace URL) or `[SELECTED]`. Use the connection marked with the workspace the user named. If they have not named one and the marked connections name more than one workspace, ask; if they all name the same one, use it. Before a write to an issue the user did not place in a workspace, when `list_workspaces` lists more than one workspace for the account, tell them the identifier, the issue's title and the workspace, and ask first: the same identifier can exist in more than one workspace.

Make every call of that task on the same connection. An id read from one workspace means nothing in another.

A connection that lists `list_workspaces` but no workspace tools such as `get_issues` (newer servers also list `get_whats_new` there), or whose tools report that no workspace is selected, names no workspace and cannot read or write anything; use the connection for the workspace the user named, or ask which one.

## Tool names

Levr can be connected by this plugin or by `npx @levr-one/cli@latest mcp add`. The skills in this plugin name each tool by the server's own name, such as `get_issue`, `manage_issues` or `transition_issue`.

Your client may list the same tool with a prefix in front of that name, and the prefix depends on which of the two connected Levr. Use the tool your client lists whose name ends with the name given here. Do not build a prefixed name yourself. When several Levr connections list it, choose by workspace, as above.

When both are installed and point at the same address, Claude Code connects once and the tools appear once.

## Staging and local servers

This plugin always connects to the production Levr server. For a staging or local server, add it with the command line instead:

```bash
npx @levr-one/cli@latest mcp add --url <mcp-url>
```

With two environments connected at once, every Levr tool appears twice, once for each server. Before you write, check which server a tool belongs to. If you cannot tell, ask the user which environment they mean.
