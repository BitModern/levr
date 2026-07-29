import { buildCommand } from '@stricli/core';
import { COMPLETION_SHELLS } from './completionHandler.js';

export const completionCommand = buildCommand({
  docs: {
    brief: 'Print the shell completion script for bash or zsh',
    fullDescription: `Prints a shell completion script to stdout. You decide where it goes —
this command never edits your shell config.

Load it for the current session:
  eval "$(levr completion bash)"
  eval "$(levr completion zsh)"

Or persist it:
  levr completion bash >> ~/.bashrc
  levr completion zsh  >> ~/.zshrc
  levr completion bash > /etc/bash_completion.d/levr   # system-wide

The shell is detected from $SHELL when omitted; pass it explicitly in scripts
or when generating a script for a shell other than the one you are running.`,
  },
  parameters: {
    positional: {
      kind: 'tuple',
      parameters: [
        {
          parse: String,
          // Without this, `levr completion <TAB>` proposes nothing, because a
          // free-form String positional has no values to enumerate. Parsing
          // stays String (not a choice parser) so an invalid shell is rejected
          // by the handler's own message rather than a generic enum error.
          proposeCompletions: (partial: string) =>
            COMPLETION_SHELLS.filter((shell) => shell.startsWith(partial)),
          brief: `Shell to emit (${COMPLETION_SHELLS.join('|')}); detected from $SHELL if omitted`,
          placeholder: 'shell',
          optional: true,
        },
      ] as const,
    },
    flags: {},
  },
  loader: async () => {
    const { completionHandler } = await import('./completionHandler.js');
    return completionHandler;
  },
});
