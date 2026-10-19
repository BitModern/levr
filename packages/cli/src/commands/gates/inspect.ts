import { buildCommand } from '@stricli/core';

import { GateOpSchema } from '@levr/shared/runs/gate-op';

import type { LocalContext } from '../../context.js';
import { runBuiltin, type InspectResult } from './builtins.js';

/**
 * `levr gates inspect '<op json>'` (internal).
 *
 * Parses an inspect op with `GateOpSchema`, runs the builtin, and exits 0
 * when the check passes or 1 when it fails. An op that does not parse, or
 * that is not an inspect op, exits 2.
 */
export function executeInspect(
  opJson: string,
  root = process.cwd(),
): InspectResult {
  let raw: unknown;
  try {
    raw = JSON.parse(opJson) as unknown;
  } catch {
    return {
      exitCode: 2,
      stdout: '',
      stderr: 'gates inspect: op does not parse\n',
    };
  }
  const parsed = GateOpSchema.safeParse(raw);
  if (!parsed.success || parsed.data.op !== 'inspect') {
    return {
      exitCode: 2,
      stdout: '',
      stderr: 'gates inspect: op does not parse\n',
    };
  }
  return runBuiltin(
    { check: parsed.data.check, params: parsed.data.params },
    root,
  );
}

export function gatesInspectHandler(
  this: LocalContext,
  _flags: Record<string, never>,
  opJson: string,
): void {
  const result = executeInspect(opJson);
  if (result.stdout.length > 0) this.process.stdout.write(result.stdout);
  if (result.stderr.length > 0) this.process.stderr.write(result.stderr);
  this.process.exitCode = result.exitCode;
}

export const gatesInspectCommand = buildCommand({
  docs: {
    brief: 'Run one inspect op and print its result',
    fullDescription: `Parse an inspect op JSON and run it in process. Exit 0 when the
check passes, 1 when it fails, and 2 when the op does not parse.

The op is the JSON object \`{ "op": "inspect", "check", "params" }\`. This is
the command a harness runs for an inspect gate.

Examples:
  levr gates inspect '{"op":"inspect","check":"exists","params":{"path":"package.json"}}'`,
  },
  parameters: {
    positional: {
      kind: 'tuple',
      parameters: [
        {
          parse: String,
          brief: 'Inspect op as JSON',
          placeholder: 'op-json',
          optional: false,
        },
      ] as const,
    },
    flags: {},
  },
  loader: async () => {
    const { gatesInspectHandler: handler } = await import('./inspect.js');
    return handler;
  },
});
