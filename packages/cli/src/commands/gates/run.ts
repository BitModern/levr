import { buildCommand } from '@stricli/core';

export const gatesRunCommand = buildCommand({
  docs: {
    brief: "Run a deliverable's gate commands and report the raw results",
    fullDescription: `Verify a deliverable's gates, run every local command from the current
directory (run it from the repo root), and report the raw exit code and output
tails so the server can derive each verdict.

File checks (inspect ops, printed as \`npx @levr-one/cli gates inspect '…'\`)
run inside this CLI and spawn nothing. Every other command runs EXACTLY as the
server returned it, in /bin/bash -c (or sh).

Each command is printed before it runs; use --dry-run to read them first. A
dry run runs nothing locally and shows, per command, where it would run
(\`runs\`) and the server's approval (\`approval\`). It still calls the
server's verify, which records state there. A \`confirm\` approval is not
prompted for yet: the command runs. The server validates every local command
before handing it out: a command that fails its check comes back as a
verification error, never as a command to run.

Guided gates are listed, not run: perform them and report what you observed
with report_gate_results step_results[].

Exit code 0 when every gate passes after the report, 1 otherwise.

Examples:
  levr gates run internal
  levr gates run internal --dry-run      # list the commands; run and report nothing
  levr gates run <issue-uuid> --json`,
  },
  parameters: {
    positional: {
      kind: 'tuple',
      parameters: [
        {
          parse: String,
          brief: 'Deliverable issue identifier (internal) or UUID',
          placeholder: 'issue',
          optional: false,
        },
      ] as const,
    },
    flags: {
      'workspace-id': {
        kind: 'parsed',
        parse: String,
        brief: 'Workspace ID (required for multi-workspace JWT auth)',
        placeholder: 'uuid',
        optional: true,
      },
      'dry-run': {
        kind: 'boolean',
        default: false,
        brief:
          'List the commands and the report entries they would produce; run nothing',
      },
      json: {
        kind: 'boolean',
        default: false,
        brief: 'Print machine-readable JSON',
      },
      verbose: {
        kind: 'boolean',
        default: false,
        brief: 'Show detailed output',
      },
      ci: {
        kind: 'boolean',
        default: false,
        brief:
          'Declare this run is CI. On GitHub Actions, attach an OIDC token (audience levr:<workspace_id>); without one the server records the run as unverified',
      },
    },
    aliases: {
      w: 'workspace-id',
      v: 'verbose',
    },
  },
  loader: async () => {
    const { gatesRunHandler } = await import('./runHandler.js');
    return gatesRunHandler;
  },
});
