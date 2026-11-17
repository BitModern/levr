/**
 * Does a bare `levr` run the onboarding wizard? (internal, plan internal D9)
 *
 * Pure and import-free, so `bin/cli.ts` can ask before it loads the wizard.
 * Only a person at a terminal is ever prompted: stdin AND stdout must be a
 * TTY, and none of the opt-outs may be set. Anything else prints the Stricli
 * help exactly as before.
 */

/** The one flag a bare `levr` may carry and still be "bare". */
export const NON_INTERACTIVE_FLAG = '--non-interactive';

export interface OnboardingEntry {
  /** `process.argv.slice(2)`. */
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  stdinIsTTY: boolean | undefined;
  stdoutIsTTY: boolean | undefined;
}

/**
 * CI is detected by the exact `CI` variable, the convention every major CI
 * provider sets. A `CI_*` prefix is NOT a signal: `CI_TOKEN` in a developer's
 * shell must not silence the wizard. `CI=false` / `CI=0` / empty mean "not CI".
 */
export function isCiEnv(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const value = env['CI'];
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v !== '' && v !== 'false' && v !== '0';
}

/** `LEVR_NO_PROMPT` set to anything but empty, `0` or `false`. */
function noPrompt(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = env['LEVR_NO_PROMPT'];
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v !== '' && v !== 'false' && v !== '0';
}

/** Is this argv a bare `levr` (optionally with `--non-interactive`)? */
export function isBareInvocation(argv: readonly string[]): boolean {
  return (
    argv.length === 0 || (argv.length === 1 && argv[0] === NON_INTERACTIVE_FLAG)
  );
}

export function shouldRunOnboarding(entry: OnboardingEntry): boolean {
  if (entry.argv.length !== 0) return false;
  if (entry.stdinIsTTY !== true || entry.stdoutIsTTY !== true) return false;
  if (isCiEnv(entry.env)) return false;
  if (noPrompt(entry.env)) return false;
  return true;
}
