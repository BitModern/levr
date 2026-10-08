import { uploadAttachment } from "./sdk-client-DYv-0CfA.js";
import { sleep } from "./sleep-BpJ39Ypm.js";
import { constants, promises, readlinkSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

//#region src/utils/artifact-upload.ts
/** The per-file ceiling the server enforces (DD5): bigger files are skipped. */
const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;
/** Retries after the first attempt, for failures that are safe to repeat. */
const MAX_UPLOAD_RETRIES = 2;
/** Related types with an attachment table (the upload route accepts these). */
const TYPED_TARGET_TYPES = [
	"issue",
	"test",
	"run",
	"run_result",
	"run_result_variant",
	"import_job",
	"project",
	"project_update",
	"automation_run_result"
];
/** A target string the CLI cannot interpret; a usage error, exit 1. */
var TargetParseError = class extends Error {
	constructor(input) {
		super(`Invalid target "${input}". Use an identifier (ENG-42, TC-5, TR-3) or <related_type>:<uuid|identifier> with related_type one of ${TYPED_TARGET_TYPES.join(", ")}.`);
		this.name = "TargetParseError";
	}
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTIFIER_RE = /^([A-Z][A-Z0-9]*)(?:-[A-Z0-9]{2,10})?-(\d+)$/;
/**
* `ENG-42` → issue, `TC-5` → test, `TR-3` → run (the server resolves the
* identifier); `<related_type>:<uuid>` for any typed target.
*/
function parseTarget(input) {
	const trimmed = input.trim();
	const ident = IDENTIFIER_RE.exec(trimmed);
	if (ident) {
		const prefix = ident[1];
		return {
			relatedType: prefix === "TC" ? "test" : prefix === "TR" ? "run" : "issue",
			relatedId: trimmed
		};
	}
	const sep = trimmed.indexOf(":");
	if (sep > 0) {
		const type = trimmed.slice(0, sep);
		const id = trimmed.slice(sep + 1);
		if (TYPED_TARGET_TYPES.includes(type) && (UUID_RE.test(id) || IDENTIFIER_RE.test(id))) return {
			relatedType: type,
			relatedId: id
		};
	}
	throw new TargetParseError(input);
}
/**
* Resolve a path a REPORT supplied (untrusted: a fork PR controls its own
* JUnit) against `baseDir`, confined to `root` (audit P1). An absolute path
* is taken as-is and accepted when it lies inside `root` (R1-23).
*
* fail_closed: returns null — never read, counted as rejected — when the
* real path (symlinks followed) is outside `root`. A path that does not
* exist inside `root` is `{ status: 'missing' }`, never a throw.
*/
function resolveArtifactPath(ref, baseDir, root = process.cwd()) {
	const realRoot = safeRealpath(root) ?? path.resolve(root);
	const candidate = path.isAbsolute(ref) ? ref : path.resolve(baseDir, ref);
	const real = safeRealpath(candidate);
	if (real === void 0) return isInside(realRoot, realpathOfNearest(path.resolve(candidate))) ? { status: "missing" } : null;
	if (!isInside(realRoot, real)) return null;
	let st;
	try {
		st = statSync(real);
	} catch {
		return { status: "missing" };
	}
	if (!st.isFile()) return { status: "missing" };
	return {
		status: "ok",
		path: real,
		dev: st.dev,
		ino: st.ino,
		root: realRoot
	};
}
function safeRealpath(p) {
	try {
		return realpathSync(p);
	} catch {
		return;
	}
}
/** `p` with its longest existing prefix replaced by that prefix's real path. */
function realpathOfNearest(p) {
	const missing = [];
	let current = p;
	for (;;) {
		const real = safeRealpath(current);
		if (real !== void 0) return path.join(real, ...missing.reverse());
		const parent = path.dirname(current);
		if (parent === current) return p;
		missing.push(path.basename(current));
		current = parent;
	}
}
function isInside(root, p) {
	const rel = path.relative(root, p);
	return rel === "" || rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
/**
* Upload one file. Never throws: every outcome is a status.
*
* - The file is opened ONCE, with O_NOFOLLOW (omitted on win32, where the
*   dev/inode comparison alone guards the read), and the open handle's
*   dev/inode must match the validated path's; otherwise the file was
*   swapped after validation and the result is `rejected` (R1-07). The size
*   check and the bytes sent come from that same handle.
* - ENOENT/ENOTDIR → `missing`; over 50 MiB → `skipped` (DD5).
* - Fields go before the file part; kind/attempt_index only for an
*   automation_run_result target (the server rejects them elsewhere).
* - Retries split by idempotency (R1-06), fail_retry(2) with backoff: a
*   failure the server cannot have received (429, connection refused, DNS)
*   is retried for any target; an ambiguous one (timeout, reset, 5xx) only
*   for automation_run_result, whose uploads the server deduplicates. Any
*   other target gets `failed` ("outcome unknown") instead of a duplicate.
*/
async function uploadArtifactFile(options) {
	const { target, filePath } = options;
	const sleep$1 = options.sleep ?? sleep;
	const isAutomation = target.relatedType === "automation_run_result";
	let validated = options.validated;
	if (!validated) {
		const real = safeRealpath(filePath);
		if (real === void 0) return { status: "missing" };
		try {
			const st = statSync(real);
			if (!st.isFile()) return { status: "missing" };
			validated = {
				path: real,
				dev: st.dev,
				ino: st.ino
			};
		} catch {
			return { status: "missing" };
		}
	}
	const flags = process.platform === "win32" ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW;
	let handle;
	try {
		handle = await promises.open(validated.path, flags);
	} catch (err) {
		const code = err.code;
		if (code === "ENOENT" || code === "ENOTDIR") return { status: "missing" };
		if (code === "ELOOP") return {
			status: "rejected",
			message: "the path became a symlink"
		};
		return {
			status: "failed",
			message: err.message
		};
	}
	let bytes;
	try {
		const st = await handle.stat();
		if (st.dev !== validated.dev || st.ino !== validated.ino) return {
			status: "rejected",
			message: "the file changed after it was validated"
		};
		if (validated.root && !openedInside(handle.fd, validated, validated.root)) return {
			status: "rejected",
			message: "the opened file is outside the working directory"
		};
		if (st.size > MAX_ARTIFACT_BYTES) return {
			status: "skipped",
			reason: "too_large",
			size: st.size
		};
		bytes = await handle.readFile();
	} catch (err) {
		return {
			status: "failed",
			message: err.message
		};
	} finally {
		await handle.close().catch(() => void 0);
	}
	const name = options.name ?? path.basename(filePath);
	const body = {
		related_type: target.relatedType,
		related_id: target.relatedId
	};
	if (isAutomation) {
		if (options.kind) body.kind = options.kind;
		if (options.attemptIndex !== void 0 && options.attemptIndex !== null) body.attempt_index = options.attemptIndex;
	}
	if (options.isPublic !== void 0) body.is_public = options.isPublic;
	body.file = new File([new Uint8Array(bytes)], name);
	for (let attempt = 0;; attempt++) {
		let outcome;
		let thrown;
		try {
			outcome = await uploadAttachment(body);
		} catch (err) {
			thrown = err;
		}
		if (outcome && outcome.status >= 200 && outcome.status < 300) {
			const data = outcome.data;
			if (!data?.id) return {
				status: "failed",
				message: "upload returned no attachment"
			};
			return {
				status: data.deduplicated || outcome.status === 200 ? "deduplicated" : "uploaded",
				id: data.id,
				url: data.url ?? null,
				target_id: data.target_id ?? null
			};
		}
		const kind = classifyFailure(outcome, thrown);
		if ((kind === "not_received" || kind === "ambiguous" && isAutomation) && attempt < MAX_UPLOAD_RETRIES) {
			await sleep$1(500 * 2 ** attempt);
			continue;
		}
		if (kind === "ambiguous" && !isAutomation) return {
			status: "failed",
			message: "outcome unknown, not retried to avoid a duplicate attachment"
		};
		return {
			status: "failed",
			message: describeFailure(outcome, thrown)
		};
	}
}
/**
* Where the OPEN descriptor really lives (ENG-6165 code review F-005).
* O_NOFOLLOW guards only the last component, and the dev/inode recorded at
* validation was itself read through a path whose parent could have been
* swapped for a symlink in between. On Linux `/proc/self/fd/<fd>` names the
* opened file authoritatively. Elsewhere Node has no fd → path call, so the
* path is resolved again and must still be the validated, in-root path
* holding the same file: this narrows the window to the open itself rather
* than closing it.
*/
function openedInside(fd, validated, root) {
	if (process.platform === "linux") try {
		return isInside(root, readlinkSync(`/proc/self/fd/${fd}`));
	} catch {
		return false;
	}
	const again = safeRealpath(validated.path);
	if (again !== validated.path || !isInside(root, again)) return false;
	try {
		const st = statSync(again);
		return st.dev === validated.dev && st.ino === validated.ino;
	} catch {
		return false;
	}
}
/**
* not_received: the server cannot have acted (429, connection refused, DNS).
* ambiguous: the request may have landed (timeout, reset, 5xx, unknown).
* rejected: a definite 4xx answer — never retried.
*/
function classifyFailure(outcome, thrown) {
	if (outcome) {
		if (outcome.status === 429) return "not_received";
		if (outcome.status >= 500 || outcome.status === 0) return "ambiguous";
		return "rejected";
	}
	const code = errorCode(thrown);
	if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN") return "not_received";
	return "ambiguous";
}
function errorCode(err) {
	const e = err;
	const code = e?.code ?? e?.cause?.code;
	return typeof code === "string" ? code : void 0;
}
function describeFailure(outcome, thrown) {
	if (outcome) {
		const msg = outcome.error?.message;
		const text = Array.isArray(msg) ? msg.join("; ") : typeof msg === "string" ? msg : JSON.stringify(outcome.error ?? {});
		return `HTTP ${outcome.status}: ${text}`;
	}
	return thrown instanceof Error ? thrown.message : String(thrown);
}
/** Markdown that shows an uploaded file: an image inline, anything else as a link. */
function embedMarkdown(name, url) {
	return /\.(png|jpe?g|gif|webp)$/i.test(name) ? `![${name}](${url})` : `[${name}](${url})`;
}

//#endregion
export { TargetParseError, embedMarkdown, parseTarget, resolveArtifactPath, uploadArtifactFile };