---
name: using-levr
description: Habits for writing to Levr safely. Use before changing an issue's description or title, before rewriting a long issue body, and when Levr tools appear twice or a Levr tool name does not resolve.
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

## Tool names

Levr can be connected by this plugin or by `npx @levr-one/cli mcp add`. The skills in this plugin name each tool by the server's own name, such as `get_issue`, `manage_issues` or `transition_issue`.

Your client may list the same tool with a prefix in front of that name, and the prefix depends on which of the two connected Levr. Use the tool your client lists whose name ends with the name given here. Do not build a prefixed name yourself.

When both are installed and point at the same address, Claude Code connects once and the tools appear once.

## Staging and local servers

This plugin always connects to the production Levr server. For a staging or local server, add it with the command line instead:

```bash
npx @levr-one/cli mcp add --url <mcp-url>
```

With two environments connected at once, every Levr tool appears twice, once for each server. Before you write, check which server a tool belongs to. If you cannot tell, ask the user which environment they mean.
