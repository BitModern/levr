//#region src/commands/completionHandler.ts
const COMPLETION_SHELLS = ["bash", "zsh"];
function isCompletionShell(value) {
	return COMPLETION_SHELLS.includes(value);
}
/**
* Best-effort shell detection from `$SHELL`. Matches on the basename so login
* shells (`-bash`) and non-standard prefixes (`/usr/local/bin/zsh`) still
* resolve. Returns undefined when the shell is unset or unsupported — the
* caller must then fail loudly rather than guess.
*/
function detectShell(shellPath) {
	const name = shellPath?.split("/").pop() ?? "";
	if (name.includes("zsh")) return "zsh";
	if (name.includes("bash")) return "bash";
}
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
function completionScript(shell) {
	return shell === "zsh" ? ZSH_SCRIPT : BASH_SCRIPT;
}
/**
* Print the completion script for `shell` (or the detected shell) to stdout.
*
* stdout carries the script and NOTHING else, so `eval "$(levr completion zsh)"`
* is safe; diagnostics go to stderr and set a non-zero exit code. The command
* never writes to the filesystem — wiring it up is the user's call (ENG-2702).
*/
function completionHandler(_flags, shell) {
	const requested = shell === void 0 ? detectShell(this.process.env["SHELL"]) : shell;
	if (requested === void 0) {
		this.process.stderr.write(`Could not detect your shell from \$SHELL. Pass one explicitly: levr completion <${COMPLETION_SHELLS.join("|")}>\n`);
		this.process.exitCode = 1;
		return;
	}
	if (!isCompletionShell(requested)) {
		this.process.stderr.write(`Unsupported shell "${requested}". Supported shells: ${COMPLETION_SHELLS.join(", ")}.\n`);
		this.process.exitCode = 1;
		return;
	}
	this.process.stdout.write(completionScript(requested));
}

//#endregion
export { COMPLETION_SHELLS, completionHandler, completionScript, detectShell, isCompletionShell };