import { proposeCompletions } from '@stricli/core';
import { app } from './app.js';
import type { LocalContext } from './context.js';

/**
 * Compute shell tab-completion suggestions for the hidden `__complete` entrypoint
 * (see src/bin/cli.ts). `levr install` registers a bash function that invokes
 * `levr __complete <COMP_LINE>` on each TAB, so `rawArgs` (process.argv.slice(2))
 * is `['__complete', <targetCommandName>, ...wordsBeingCompleted]`. A COMP_LINE
 * ending in a space means the cursor is on a fresh (empty) word to complete.
 *
 * Never throws — completion must not surface an error to the user's shell.
 */
export async function proposeCompletionLines(
  rawArgs: readonly string[],
  compLine: string | undefined,
  context: LocalContext,
): Promise<string[]> {
  // Drop the '__complete' sentinel and the target command name to recover the
  // words being completed.
  const inputs = rawArgs.slice(2);
  if (compLine?.endsWith(' ')) {
    inputs.push('');
  }
  try {
    const proposals = await proposeCompletions(app, inputs, context);
    return proposals.map(({ completion }) => completion);
  } catch {
    return [];
  }
}
