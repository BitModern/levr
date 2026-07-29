import type { LocalContext } from '../context.js';

export const COMPLETION_SHELLS = ['bash', 'zsh'] as const;

export type CompletionShell = (typeof COMPLETION_SHELLS)[number];

export function isCompletionShell(value: string): value is CompletionShell {
  return (COMPLETION_SHELLS as readonly string[]).includes(value);
}

/**
 * Best-effort shell detection from `$SHELL`. Matches on the basename so login
 * shells (`-bash`) and non-standard prefixes (`/usr/local/bin/zsh`) still
 * resolve. Returns undefined when the shell is unset or unsupported — the
 * caller must then fail loudly rather than guess.
 */
export function detectShell(
  shellPath: string | undefined,
): CompletionShell | undefined {
  const name = shellPath?.split('/').pop() ?? '';
  if (name.includes('zsh')) return 'zsh';
  if (name.includes('bash')) return 'bash';
  return undefined;
}

// Both scripts delegate to the hidden `levr __complete` entrypoint (see
// src/bin/cli.ts), which is shell-agnostic: it takes the words typed so far and
// prints one candidate per line. That is why zsh works even though the previous
// `@stricli/auto-complete` installer was bash-only — the ceiling was the
// installer's, not the completion engine's (internal).

// Passes the pre-tokenized $COMP_WORDS rather than an unquoted $COMP_LINE.
// Unquoted $COMP_LINE is subject to BOTH word-splitting and globbing, so a
// value containing a space split into two argv entries and a literal glob
// (`levr push *`) expanded against the cwd, injecting unrelated filenames.
// $COMP_WORDS is already tokenized by bash and respects quoting.
//
// The whole array is passed, including index 0 (the command name), because
// proposeCompletionLines() drops the first TWO argv entries (`__complete` and
// the command name). Passing "${COMP_WORDS[@]:1}" would silently eat the first
// real word. $COMP_LINE is still exported — __complete reads it from the
// environment purely to detect a trailing space (cursor on a fresh word).
const BASH_SCRIPT = `# levr bash completion.
# Load it from ~/.bashrc:  eval "$(levr completion bash)"
__levr_complete() {
  export COMP_LINE
  local -a words=( "\${COMP_WORDS[@]}" )
  # Drop a trailing empty word. COMP_LINE's trailing space is already the
  # signal that the cursor is on a fresh word; passing the empty word too
  # would make __complete see it twice and match nothing. Harmless when the
  # last word is non-empty, so this is correct however bash populates
  # COMP_WORDS.
  if [[ \${#words[@]} -gt 0 && -z "\${words[\${#words[@]}-1]}" ]]; then
    words=( "\${words[@]:0:\${#words[@]}-1}" )
  fi
  COMPREPLY=( $(levr __complete "\${words[@]}") )
  return 0
}
complete -o default -o nospace -F __levr_complete levr
`;

// \${(j: :)words} joins with a single space, so when the cursor sits on a fresh
// word the trailing empty element yields a trailing space — the same signal
// bash's unquoted $COMP_LINE produces, and what __complete checks to decide
// whether to propose the NEXT argument or filter the current one.
//
// The args array then drops that trailing empty word, mirroring how bash's
// unquoted word-splitting discards it. Without this, __complete would receive
// the empty word twice (once positionally, once from the trailing-space rule).
const ZSH_SCRIPT = `# levr zsh completion.
# Load it from ~/.zshrc, AFTER your compinit call:
#   autoload -Uz compinit && compinit
#   eval "$(levr completion zsh)"
_levr_complete() {
  local -a candidates args
  local raw
  local comp_line="\${(j: :)words}"

  args=("\${(@)words}")
  if [[ -z "\${args[-1]}" ]]; then
    args=("\${(@)args[1,-2]}")
  fi

  # Return before splitting when there is nothing to offer, so compadd is
  # never reached with an empty candidate list.
  raw="$(COMP_LINE="$comp_line" levr __complete "\${args[@]}" 2>/dev/null)"
  [[ -n "$raw" ]] || return

  candidates=(\${(f)raw})
  # -S '' matches bash's \`complete -o nospace\`: no space is appended after a
  # unique match, so subcommands can be chained without deleting one.
  compadd -S '' -- "\${candidates[@]}"
}

# compdef only exists once compinit has run. Without this guard a .zshrc that
# eval's this before compinit dies with a bare "command not found: compdef" on
# every new shell; the explicit message says what to actually do.
if (( $+functions[compdef] )); then
  compdef _levr_complete levr
else
  print -u2 "levr: completion not registered — run \\\`autoload -Uz compinit && compinit\\\` before loading it."
fi
`;

export function completionScript(shell: CompletionShell): string {
  return shell === 'zsh' ? ZSH_SCRIPT : BASH_SCRIPT;
}

/**
 * Print the completion script for `shell` (or the detected shell) to stdout.
 *
 * stdout carries the script and NOTHING else, so `eval "$(levr completion zsh)"`
 * is safe; diagnostics go to stderr and set a non-zero exit code. The command
 * never writes to the filesystem — wiring it up is the user's call (internal).
 */
export function completionHandler(
  this: LocalContext,
  _flags: Record<never, never>,
  shell?: string,
): void {
  // Distinguish "argument omitted" from "argument explicitly empty". `??`
  // conflates them, so `levr completion ""` fell through to $SHELL detection
  // and blamed an undetectable $SHELL even when $SHELL was valid. An explicit
  // value — empty or not — must be reported as an unsupported shell.
  const requested =
    shell === undefined ? detectShell(this.process.env['SHELL']) : shell;

  if (requested === undefined) {
    this.process.stderr.write(
      'Could not detect your shell from $SHELL. ' +
        `Pass one explicitly: levr completion <${COMPLETION_SHELLS.join('|')}>\n`,
    );
    this.process.exitCode = 1;
    return;
  }

  if (!isCompletionShell(requested)) {
    this.process.stderr.write(
      `Unsupported shell "${requested}". ` +
        `Supported shells: ${COMPLETION_SHELLS.join(', ')}.\n`,
    );
    this.process.exitCode = 1;
    return;
  }

  this.process.stdout.write(completionScript(requested));
}
