---
name: work
description: Start work on a Levr issue. Use when the user names an issue and wants to understand it before changing anything, for example "work on ACME-42", "pick up ACME-42" or "what does ACME-42 need?". Reads the issue, its comments and its related issues, summarises them, and proposes a plan.
argument-hint: "<ISSUE-ID>"
---

# Start work on an issue

Issue: $ARGUMENTS

If no issue identifier was given, ask for one. Do not pick a likely match and start on it.

## 1. Gather

Read everything before you summarise. Run the reads that do not depend on each other together.

1. `get_issue` with `identifier` set to the issue id. Keep `id` (the UUID), `parent_id` and `relations` from the result.
2. `get_issue_comments` with `issue_id` set to that UUID. Read every comment. Decisions and constraints are usually recorded there, not in the description.
3. The parent, when `parent_id` is set: `get_issue` with `id` set to it.
4. The children: `get_issues` with `parent_id` set to the UUID and `status: "all"`.
5. `relations` already gives each related issue's identifier, title and status. Read one in full, with `get_issue` and its `identifier`, only when you need more than that, such as why a blocker is still open.
6. Linked pull requests: `manage_pr_issue_links` with `query: { "issue_id": "<uuid>" }`.

If a read fails, say which one failed and carry on with the rest. Never fill the gap with a guess.

## 2. Present the grounding

Give one compact block, in this order. Leave out a line that has nothing to say.

- **Issue:** identifier, title, and the web link if the result has one.
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
