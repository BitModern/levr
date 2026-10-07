import { buildCommand } from '@stricli/core';

export const ATTACHMENT_KINDS = [
  'screenshot',
  'video',
  'trace',
  'stdout_log',
  'stderr_log',
  'har',
  'report',
  'attachment',
  'other',
] as const;

export interface AttachCommandFlags {
  'workspace-id'?: string;
  kind?: (typeof ATTACHMENT_KINDS)[number];
  attempt?: number;
  embed: boolean;
  manifest?: string;
  verbose: boolean;
}

export const attachCommand = buildCommand({
  docs: {
    brief: 'Attach local files to a Levr entity',
    fullDescription: `Upload local files (screenshots, trace.zip, videos, logs) and attach them to
an issue, test, run or execution result, without passing base64 through an
MCP call.

Targets:
  internal                         an issue, by identifier
  TC-5                           a test case
  TR-3                           a run
  <related_type>:<uuid>          any entity with attachments, e.g.
                                 run_result_variant:<uuid>
                                 automation_run_result:<uuid>
  <related_type>:<identifier>    an explicit type, e.g. issue:TC-12 for a
                                 team whose key is TC or TR
Spoke identifiers (ENG-JP-5) work in every form.

Files are private: only signed-in workspace members can open them. --embed
also adds a link to the entity so they render there: a new comment on an
issue, test or run, or an append to an execution result's actual result.
Files over 50 MiB are skipped.

--manifest <json> attaches a batch: [{ "target": "...", "files": ["..."],
"kind": "trace", "attempt": 1 }]. --kind and --attempt apply to
automation_run_result targets only.

Exit code 1 when any file fails, is skipped, or an embed write fails.

Examples:
  levr attach internal screenshot.png
  levr attach run_result_variant:<uuid> shot.png --embed
  levr attach automation_run_result:<uuid> trace.zip --kind trace --attempt 0
  levr attach --manifest extra-artifacts.json`,
  },
  parameters: {
    positional: {
      kind: 'array',
      parameter: {
        parse: String,
        brief: 'Target, then the files to attach',
        placeholder: 'target|file',
      },
    },
    flags: {
      'workspace-id': {
        kind: 'parsed',
        parse: String,
        brief: 'Workspace ID (required for multi-workspace JWT auth)',
        placeholder: 'uuid',
        optional: true,
      },
      kind: {
        kind: 'enum',
        values: ATTACHMENT_KINDS,
        brief: 'Artifact kind (automation_run_result targets only)',
        optional: true,
      },
      attempt: {
        kind: 'parsed',
        parse: (v: string) => {
          if (!/^\d+$/.test(v)) throw new Error('--attempt must be >= 0');
          return Number(v);
        },
        brief:
          'Index of the earlier attempt (automation_run_result only; omit for the final attempt)',
        placeholder: 'n',
        optional: true,
      },
      embed: {
        kind: 'boolean',
        default: false,
        brief: 'Also add a markdown link (comment, or actual-result append)',
      },
      manifest: {
        kind: 'parsed',
        parse: String,
        brief: 'JSON file listing [{ target, files, kind?, attempt? }]',
        placeholder: 'file',
        optional: true,
      },
      verbose: {
        kind: 'boolean',
        default: false,
        brief: 'Show detailed output',
      },
    },
    aliases: {
      w: 'workspace-id',
      k: 'kind',
      e: 'embed',
      m: 'manifest',
      v: 'verbose',
    },
  },
  loader: async () => {
    const { attachHandler } = await import('./attachHandler.js');
    return attachHandler;
  },
});
