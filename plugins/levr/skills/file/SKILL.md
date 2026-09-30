---
name: file
description: File a new issue in Levr. Use when the user wants to record a bug, task, feature or follow-up, for example "file an issue for this", "log a bug" or "track this in Levr". Picks the team, project and type from the workspace, checks for an existing issue, and creates it only after the user confirms.
argument-hint: "[what to file]"
---

# File an issue

What to file: $ARGUMENTS

If it is not clear what should be filed, ask. One issue per problem: if the user describes several, propose one issue for each.

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

Show the draft in one block: team, project, type, title, description, priority and parent. Ask the user to confirm or change it.

After they confirm, call `manage_issues` with one entry in `create`:

- `title`, `description`, `team_id`, `priority`;
- `project_id` and `parent_id` when chosen;
- `type_label_id` from step 1.

Do not create the issue before the user confirms.

## 5. Report

Give the identifier exactly as the tool returned it, with the web link if there is one. If the call failed, show the error as returned and do not retry with changed values unless the user asks.
