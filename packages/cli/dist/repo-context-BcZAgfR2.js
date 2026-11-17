//#region src/repo/repo-context.ts
const NOT_A_REPO_MESSAGE = "Not inside a git repository: cd into one of your repos and run `levr gates setup`.";
/** The default host of each hosted provider; anything else is self-hosted. */
const PROVIDER_DEFAULT_HOSTS = {
	github: "github.com",
	gitlab: "gitlab.com",
	bitbucket: "bitbucket.org"
};
function isDefaultProviderHost(host) {
	return Object.values(PROVIDER_DEFAULT_HOSTS).includes(host.toLowerCase());
}
/** A host name safe to hand to ssh as its destination: never option-like. */
const SAFE_SSH_HOST = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SCP_LIKE = /^((?:[^@/\s]+@)?)([^:/\s]+):(?!\/\/)(.+)$/;
/** The host of a git remote, or null when it is not a remote. */
function parseRemoteHost(remote) {
	const raw = remote.trim();
	const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw);
	if (scheme) {
		let url;
		try {
			url = new URL(raw);
		} catch {
			return null;
		}
		if (!url.hostname) return null;
		const protocol = scheme[1].toLowerCase();
		return {
			host: url.hostname.toLowerCase(),
			ssh: protocol === "ssh" || protocol === "git+ssh",
			withHost: (host$1) => {
				const next = new URL(raw);
				next.hostname = host$1;
				return next.toString();
			}
		};
	}
	const scp = SCP_LIKE.exec(raw);
	if (!scp) return null;
	const [, user, host, path] = scp;
	return {
		host: host.toLowerCase(),
		ssh: true,
		withHost: (next) => `${user}${next}:${path}`
	};
}
/** The `hostname` line `ssh -G` prints, or null. */
function sshHostname(stdout) {
	const m = /^hostname\s+(\S+)\s*$/im.exec(stdout);
	return m ? m[1].toLowerCase() : null;
}
/**
* Resolve an ssh alias with `ssh -G <host>`: the real host when it is a
* provider's default host, else null (the caller keeps the host as typed).
*/
function resolveSshAlias(host, opts) {
	if (!SAFE_SSH_HOST.test(host)) {
		opts.note(`"${host}" is not a plain host name, so it is not passed to ssh; continuing with it as typed.`);
		return null;
	}
	const result = opts.ssh(["-G", host]);
	const real = result.code === 0 ? sshHostname(result.stdout) : null;
	if (!real) {
		opts.note(result.code === 0 ? `\`ssh -G ${host}\` printed no hostname; continuing with ${host} as typed.` : `Could not run \`ssh -G ${host}\` (is ssh installed?); continuing with ${host} as typed.`);
		return null;
	}
	if (!isDefaultProviderHost(real)) {
		opts.note(`ssh alias ${host} points at ${real}, which is no provider's default host; continuing with ${host} as typed.`);
		return null;
	}
	opts.note(`ssh alias ${host} resolves to ${real}.`);
	return real;
}
/** The repository `cwd` is in, its origin remote, and an ssh alias resolved. */
async function resolveRepoContext(opts) {
	const top = opts.git(["rev-parse", "--show-toplevel"], opts.cwd);
	const root = top.stdout.trim();
	if (top.code !== 0 || root === "") return {
		ok: false,
		exitCode: 2,
		message: NOT_A_REPO_MESSAGE
	};
	const origin = opts.git([
		"remote",
		"get-url",
		"origin"
	], opts.cwd);
	const originalRemote = origin.code === 0 ? origin.stdout.trim() : "";
	if (originalRemote === "") return {
		ok: true,
		context: {
			root,
			remote: null,
			originalRemote: null,
			host: null,
			isDefaultProviderHost: false
		}
	};
	const parsed = parseRemoteHost(originalRemote);
	let remote = originalRemote;
	let host = parsed?.host ?? null;
	if (parsed && parsed.ssh && !isDefaultProviderHost(parsed.host)) {
		if (SAFE_SSH_HOST.test(parsed.host) ? await opts.askIsSshAlias(parsed.host) : true) {
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
			isDefaultProviderHost: host != null && isDefaultProviderHost(host)
		}
	};
}

//#endregion
export { resolveRepoContext };