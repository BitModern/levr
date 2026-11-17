/**
 * [issue:internal] The repository a CLI command runs in (plan internal D7;
 * shared with the bare `levr` onboarding, D9).
 *
 * - `git rev-parse --show-toplevel` gives the root; outside a repository the
 *   caller exits 2 with {@link NOT_A_REPO_MESSAGE}.
 * - `git remote get-url origin` gives the remote; a repo with no origin has a
 *   root and no remote (workspace-tier bindings only).
 * - *(Review R4 C13)* An ssh remote on a host that is no provider's default
 *   (`git@github-work:acme/api.git`) may be an ssh alias. When the user says
 *   it is, `ssh -G <host>` prints the resolved config WITHOUT connecting, and
 *   its `hostname` line names the real host. When that is a provider's
 *   default host, the remote is rewritten to it, so the server resolves the
 *   key GitHub-linked issues already carry (`acme/api`). If ssh is missing,
 *   or prints no `hostname`, or names another self-hosted host, the remote is
 *   kept as typed and the caller is told.
 *
 * The CLI never builds a repo key from the remote: it only finds the host,
 * and the server turns the remote into a key (RepositoryRefCatalog_*).
 *
 * Every process is spawned with an argv (`RunCommand`), never a shell string.
 */

/** A spawned command's exit code (-1 when it could not start) and stdout. */
export interface CommandResult {
  code: number;
  stdout: string;
}

/** Run a program with these arguments (never a shell string). */
export type RunCommand = (
  args: readonly string[],
  cwd?: string,
) => CommandResult;

export interface RepoContextOptions {
  cwd: string;
  /** Runs `git <args>` in `cwd`. */
  git: RunCommand;
  /** Runs `ssh <args>`; only ever `['-G', host]`. */
  ssh: RunCommand;
  /** Is this unknown ssh host an alias from ~/.ssh/config? */
  askIsSshAlias: (host: string) => Promise<boolean>;
  /** A line for the person: what was resolved, or why not. */
  note: (line: string) => void;
}

export interface RepoContext {
  /** Absolute repository root. */
  root: string;
  /** The origin remote, with an ssh alias resolved; null when there is none. */
  remote: string | null;
  /** The origin remote exactly as git printed it. */
  originalRemote: string | null;
  /** The remote's lower-cased host, after alias resolution. */
  host: string | null;
  /** Is `host` a hosted provider's default host (github.com, ...)? */
  isDefaultProviderHost: boolean;
}

export type RepoContextResult =
  | { ok: true; context: RepoContext }
  | { ok: false; exitCode: 2; message: string };

export const NOT_A_REPO_MESSAGE =
  'Not inside a git repository: cd into one of your repos and run `levr gates setup`.';

/** The default host of each hosted provider; anything else is self-hosted. */
export const PROVIDER_DEFAULT_HOSTS: Readonly<Record<string, string>> = {
  github: 'github.com',
  gitlab: 'gitlab.com',
  bitbucket: 'bitbucket.org',
};

export function isDefaultProviderHost(host: string): boolean {
  return Object.values(PROVIDER_DEFAULT_HOSTS).includes(host.toLowerCase());
}

/** A host name safe to hand to ssh as its destination: never option-like. */
const SAFE_SSH_HOST = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const SCP_LIKE = /^((?:[^@/\s]+@)?)([^:/\s]+):(?!\/\/)(.+)$/;

export interface ParsedRemoteHost {
  /** Lower-cased host. */
  host: string;
  /** Reached over ssh (scp-like or `ssh://`), so an alias is possible. */
  ssh: boolean;
  /** The same remote with its host replaced. */
  withHost: (host: string) => string;
}

/** The host of a git remote, or null when it is not a remote. */
export function parseRemoteHost(remote: string): ParsedRemoteHost | null {
  const raw = remote.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw);
  if (scheme) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (!url.hostname) return null;
    const protocol = scheme[1]!.toLowerCase();
    return {
      host: url.hostname.toLowerCase(),
      ssh: protocol === 'ssh' || protocol === 'git+ssh',
      withHost: (host) => {
        const next = new URL(raw);
        next.hostname = host;
        return next.toString();
      },
    };
  }
  const scp = SCP_LIKE.exec(raw);
  if (!scp) return null;
  const [, user, host, path] = scp;
  return {
    host: host!.toLowerCase(),
    ssh: true,
    withHost: (next) => `${user}${next}:${path}`,
  };
}

/** The `hostname` line `ssh -G` prints, or null. */
function sshHostname(stdout: string): string | null {
  const m = /^hostname\s+(\S+)\s*$/im.exec(stdout);
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * Resolve an ssh alias with `ssh -G <host>`: the real host when it is a
 * provider's default host, else null (the caller keeps the host as typed).
 */
function resolveSshAlias(
  host: string,
  opts: Pick<RepoContextOptions, 'ssh' | 'note'>,
): string | null {
  if (!SAFE_SSH_HOST.test(host)) {
    opts.note(
      `"${host}" is not a plain host name, so it is not passed to ssh; continuing with it as typed.`,
    );
    return null;
  }
  const result = opts.ssh(['-G', host]);
  const real = result.code === 0 ? sshHostname(result.stdout) : null;
  if (!real) {
    opts.note(
      result.code === 0
        ? `\`ssh -G ${host}\` printed no hostname; continuing with ${host} as typed.`
        : `Could not run \`ssh -G ${host}\` (is ssh installed?); continuing with ${host} as typed.`,
    );
    return null;
  }
  if (!isDefaultProviderHost(real)) {
    opts.note(
      `ssh alias ${host} points at ${real}, which is no provider's default host; continuing with ${host} as typed.`,
    );
    return null;
  }
  opts.note(`ssh alias ${host} resolves to ${real}.`);
  return real;
}

/** The repository `cwd` is in, its origin remote, and an ssh alias resolved. */
export async function resolveRepoContext(
  opts: RepoContextOptions,
): Promise<RepoContextResult> {
  const top = opts.git(['rev-parse', '--show-toplevel'], opts.cwd);
  const root = top.stdout.trim();
  if (top.code !== 0 || root === '') {
    return { ok: false, exitCode: 2, message: NOT_A_REPO_MESSAGE };
  }
  const origin = opts.git(['remote', 'get-url', 'origin'], opts.cwd);
  const originalRemote = origin.code === 0 ? origin.stdout.trim() : '';
  if (originalRemote === '') {
    return {
      ok: true,
      context: {
        root,
        remote: null,
        originalRemote: null,
        host: null,
        isDefaultProviderHost: false,
      },
    };
  }

  const parsed = parseRemoteHost(originalRemote);
  let remote = originalRemote;
  let host = parsed?.host ?? null;
  if (parsed && parsed.ssh && !isDefaultProviderHost(parsed.host)) {
    const isAlias = SAFE_SSH_HOST.test(parsed.host)
      ? await opts.askIsSshAlias(parsed.host)
      : true;
    if (isAlias) {
      const real = resolveSshAlias(parsed.host, opts);
      if (real) {
        remote = parsed.withHost(real);
        host = real;
      }
    }
  }
  return {
    ok: true,
    context: {
      root,
      remote,
      originalRemote,
      host,
      isDefaultProviderHost: host != null && isDefaultProviderHost(host),
    },
  };
}
