---
name: done
description: Close out a Levr issue after the work is finished. Use when the user says an issue is finished, for example "mark ACME-42 done", "close out ACME-42" or "wrap up this issue". Records what changed in a comment, links the pull request, and moves the issue to its done state.
argument-hint: "<ISSUE-ID>"
---

# Close out an issue

Issue: $ARGUMENTS

If no issue identifier was given, ask for one. If the user did not ask to close the issue in their own words, confirm once before writing anything.

## 0. Confirm the workspace

Before any other Levr call, call `list_workspaces` on every Levr connection your client lists. Each one marks the workspace that connection reads and writes `[PINNED]` or `[SELECTED]`; a connection with none marked has no workspace selected.

- The user named a workspace: use the connection marked with it. If none is, tell the user that workspace is not connected yet and give them its command from step 4 of "If no workspace is selected". Never run this command against another workspace.
- The user named none and the marked connections all name the same workspace: use it.
- The user named none and the marked connections name more than one workspace: ask which one. Never choose for them.
- No connection has a marked workspace: follow "If no workspace is selected" at the end of this command. If `list_workspaces` says the account has no workspace yet, tell the user that and stop.

Make every call of this command on that one connection, and name its workspace when you report back.

## 1. Read

1. `get_issue` with `identifier` set to the issue id. Keep `id` (the UUID) and `epoch`.
   If it reports that no workspace is selected, stop and follow "If no workspace is selected" at the end of this command.
2. Find what changed from the working directory: the current branch, the commits on it, and the pull request if one exists (`gh pr view` when the GitHub CLI is available).
3. If the user did not name the workspace and `list_workspaces` lists more than one workspace for the account, tell them the identifier, the issue's title and the workspace, and ask before you write anything, even when they asked to close the issue. The same identifier can exist in more than one workspace.

## 2. Comment

`add_issue_comment` with a short summary: what changed, how it was checked, and the branch, commit or pull request URL. State only what was done. If something was left out or not tested, say so.

Put the summary in a comment. Leave the description as it is unless the user asks you to change it.

## 3. Description or title change, only if asked

Call `manage_issues` with one entry in `update`, and pass the `epoch` you read in step 1.

If that item comes back with status 412, the issue changed after you read it and nothing was written:

1. `get_issue` again;
2. apply the user's change to the new text;
3. send the update with the new `epoch`.

Never drop `epoch` to make the write go through. That would overwrite whatever changed after you read the issue.

## 4. Link the pull request

1. `get_pull_requests` with `number` set to the pull request number. Keep its `id`. The same number can exist in more than one repository: when several come back, take the one whose repository matches this working directory's remote, and ask the user if you cannot tell.
2. `manage_pr_issue_links` with `create: [{ "pull_request_id": "<id>", "issue_id": "<uuid>" }]`.

If there is no pull request yet, skip this step and say so in your report. The branch or commit is already in the comment. If the pull request is not found in Levr, say that and carry on; do not stop the close-out for it.

## 5. Transition

`transition_issue` with `id` set to the issue and `state_type: "done"`. Use the state type, not a state name: teams name their states differently.

Pass nothing else. In particular, do not pass `child_completion`, `run_completion` or `verification_override` unless the user asked for that option by name.

## 6. If the transition is refused

Report the refusal exactly as returned, then stop. Do not retry with an option that gets around it.

- **Open sub-issues:** list the ones the refusal names. Whether to finish them, leave them or close them with the parent is the user's choice.
- **A required gate or linked test is failing:** list what the refusal names. Fixing it, re-running it or waiving it is the user's choice.
- **Any other refusal:** show it and ask what to do.

The comment and the link from steps 2 and 4 stay in place. Tell the user the issue is still open.

## 7. Report

One short block: the workspace, the comment was added, the pull request was linked or skipped, and the state the issue is in now. Copy the identifier exactly as the tools return it.

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
