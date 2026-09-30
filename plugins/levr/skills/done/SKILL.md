---
name: done
description: Close out a Levr issue after the work is finished. Use when the user says an issue is finished, for example "mark ACME-42 done", "close out ACME-42" or "wrap up this issue". Records what changed in a comment, links the pull request, and moves the issue to its done state.
argument-hint: "<ISSUE-ID>"
---

# Close out an issue

Issue: $ARGUMENTS

If no issue identifier was given, ask for one. If the user did not ask to close the issue in their own words, confirm once before writing anything.

## 1. Read

1. `get_issue` with `identifier` set to the issue id. Keep `id` (the UUID) and `epoch`.
2. Find what changed from the working directory: the current branch, the commits on it, and the pull request if one exists (`gh pr view` when the GitHub CLI is available).

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

One short block: the comment was added, the pull request was linked or skipped, and the state the issue is in now. Copy the identifier exactly as the tools return it.
