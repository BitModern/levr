import { buildCommand } from '@stricli/core';

export interface ResultAppendCommandFlags {
  'workspace-id'?: string;
  text?: string;
  file?: string;
  attach?: string[];
  verbose: boolean;
}

export const resultAppendCommand = buildCommand({
  docs: {
    brief: "Append to an execution result's actual result",
    fullDescription: `Append text to an execution result's actual result, server-side (no
read-modify-write), optionally with local files attached first and embedded
as markdown links. Attached files are private: the links open for signed-in
workspace members.

The target is run_result_variant:<uuid> — the execution result id the levr
MCP tools and levr-browser return.

Examples:
  levr result append run_result_variant:<uuid> --text "Checkout returns 500"
  levr result append run_result_variant:<uuid> --file observed.md --attach shot.png trace.zip`,
  },
  parameters: {
    positional: {
      kind: 'tuple',
      parameters: [
        {
          parse: String,
          brief: 'run_result_variant:<uuid>',
          placeholder: 'target',
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
      text: {
        kind: 'parsed',
        parse: String,
        brief: 'Text to append',
        placeholder: 'text',
        optional: true,
      },
      file: {
        kind: 'parsed',
        parse: String,
        brief: 'Read the text to append from a file',
        placeholder: 'path',
        optional: true,
      },
      attach: {
        kind: 'parsed',
        parse: String,
        brief: 'Files to attach and embed (repeatable)',
        placeholder: 'file',
        variadic: true,
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
      t: 'text',
      f: 'file',
      a: 'attach',
      v: 'verbose',
    },
  },
  loader: async () => {
    const { resultAppendHandler } = await import('./appendHandler.js');
    return resultAppendHandler;
  },
});
