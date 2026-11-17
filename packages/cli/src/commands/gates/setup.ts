import { buildCommand } from '@stricli/core';

/**
 * [issue:internal] `levr gates setup` (plan internal D7): detect the
 * repository, the judge CLIs and the toolchain, propose, confirm, write
 * through `levr gates bindings import`'s endpoint, and read the result back.
 */
export const gatesSetupCommand = buildCommand({
  docs: {
    brief:
      "Detect this repo's judge CLIs and commands and write its gate bindings",
    fullDescription: `Run inside one of your repositories. Setup:

  1. reads the git root and the origin remote (an ssh alias such as
     git@github-work:acme/api.git is resolved with \`ssh -G\` when you say it
     is one) and finds the repository in Levr, offering to add it;
  2. chooses the scope: this repository when the workspace already has
     bindings for it, or when you opt in; otherwise the whole workspace. The
     choice is always printed;
  3. looks for the judge CLIs (codex, claude, gemini, agy, grok) on PATH: one
     is used, several are offered with no default, none prints a prompt to
     paste into your coding agent to set a judge up over MCP;
  4. proposes typecheck, unit test, e2e test and lint commands from
     package.json, Cargo.toml, go.mod, pyproject.toml and composer.json, each
     unselected until you choose it;
  5. shows the dry run (create / exists / differs / replace), asks before it
     writes, then reads the bindings back and checks each one.

An existing judge binding that differs is replaced only after you confirm it.

Owner or Admin only: a Member is told so.

--yes asks nothing and accepts only what was passed: the judge from --judge,
no detected command, no new repository entry.

Exit code 0 on success; 1 when the server refuses, a row differs, or the
read-back does not match; 2 outside a git repository or for a usage error;
130 when a prompt is cancelled (Ctrl+C).

Examples:
  levr gates setup
  levr gates setup --dry-run
  levr gates setup --yes --judge claude`,
  },
  parameters: {
    flags: {
      'dry-run': {
        kind: 'boolean',
        default: false,
        brief: 'Show the plan; write nothing',
      },
      yes: {
        kind: 'boolean',
        default: false,
        brief: 'Ask nothing; accept only what was explicitly passed',
      },
      judge: {
        kind: 'parsed',
        parse: String,
        brief: 'The judge preset to bind (codex, claude, gemini, agy, grok)',
        placeholder: 'id',
        optional: true,
      },
      'workspace-id': {
        kind: 'parsed',
        parse: String,
        brief:
          'Workspace ID: needed with a login token and several workspaces; a personal access token is bound to its own',
        placeholder: 'uuid',
        optional: true,
      },
    },
    aliases: { y: 'yes', w: 'workspace-id' },
  },
  loader: async () => {
    const { gatesSetupHandler } = await import('./setupHandler.js');
    return gatesSetupHandler;
  },
});
