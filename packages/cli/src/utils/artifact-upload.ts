/**
 * Upload a local file to a Levr entity (internal D4) — the one path behind
 * `levr attach`, `levr result append --attach` and `levr push --artifacts`.
 *
 * Talks to POST /v1/attachment/upload through the CLI's own authenticated
 * SDK client (`./sdk-client.js`). Never computes a test identity: automation
 * results are addressed by the ids the server returned (include_results).
 */
import {
  constants,
  promises as fsp,
  readlinkSync,
  realpathSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { sleep as defaultSleep } from './sleep.js';
import { uploadAttachment } from './sdk-client.js';
import type { UploadAttachmentOutcome } from './sdk-client.js';

/** The per-file ceiling the server enforces (DD5): bigger files are skipped. */
export const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;

/** Retries after the first attempt, for failures that are safe to repeat. */
export const MAX_UPLOAD_RETRIES = 2;

/** Related types with an attachment table (the upload route accepts these). */
export const TYPED_TARGET_TYPES = [
  'issue',
  'test',
  'run',
  'run_result',
  'run_result_variant',
  'import_job',
  'project',
  'project_update',
  'automation_run_result',
] as const;

export type TargetType = (typeof TYPED_TARGET_TYPES)[number];

export interface ArtifactTarget {
  relatedType: TargetType;
  /** A UUID, or a human identifier (internal, TC-5, TR-3) for issue/test/run. */
  relatedId: string;
}

/** A target string the CLI cannot interpret; a usage error, exit 1. */
export class TargetParseError extends Error {
  constructor(input: string) {
    super(
      `Invalid target "${input}". Use an identifier (internal, TC-5, TR-3) or <related_type>:<uuid|identifier> with related_type one of ${TYPED_TARGET_TYPES.join(', ')}.`,
    );
    this.name = 'TargetParseError';
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// One optional spoke segment (ENG-JP-5, TC-ROD-40), the shape the server
// accepts (internal code review F-010).
const IDENTIFIER_RE = /^([A-Z][A-Z0-9]*)(?:-[A-Z0-9]{2,10})?-(\d+)$/;

/**
 * `internal` → issue, `TC-5` → test, `TR-3` → run (the server resolves the
 * identifier); `<related_type>:<uuid>` for any typed target.
 */
export function parseTarget(input: string): ArtifactTarget {
  const trimmed = input.trim();
  const ident = IDENTIFIER_RE.exec(trimmed);
  if (ident) {
    const prefix = ident[1];
    const relatedType: TargetType =
      prefix === 'TC' ? 'test' : prefix === 'TR' ? 'run' : 'issue';
    return { relatedType, relatedId: trimmed };
  }
  const sep = trimmed.indexOf(':');
  if (sep > 0) {
    const type = trimmed.slice(0, sep);
    const id = trimmed.slice(sep + 1);
    // `issue:TC-12` names the type explicitly, for a team whose key is TC
    // or TR (the bare prefixes are read as test and run).
    if (
      (TYPED_TARGET_TYPES as readonly string[]).includes(type) &&
      (UUID_RE.test(id) || IDENTIFIER_RE.test(id))
    ) {
      return { relatedType: type as TargetType, relatedId: id };
    }
  }
  throw new TargetParseError(input);
}

/** A report-supplied path that resolved inside the working directory. */
export interface ResolvedArtifactPath {
  status: 'ok';
  /** The real (symlink-free) path. */
  path: string;
  dev: number;
  ino: number;
  /**
   * The real working directory the path was confined to. The uploader
   * re-checks the OPENED file against it (internal code review F-005).
   */
  root?: string;
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
export function resolveArtifactPath(
  ref: string,
  baseDir: string,
  root: string = process.cwd(),
): ResolvedArtifactPath | { status: 'missing' } | null {
  const realRoot = safeRealpath(root) ?? path.resolve(root);
  const candidate = path.isAbsolute(ref) ? ref : path.resolve(baseDir, ref);
  const real = safeRealpath(candidate);
  if (real === undefined) {
    // Nothing there. Report it as missing only when the path itself would
    // be inside the root; a missing path outside it is still a rejection.
    // Compared through its nearest EXISTING ancestor's real path, so a base
    // reached through a symlink (macOS /var → /private/var) is not misread.
    return isInside(realRoot, realpathOfNearest(path.resolve(candidate)))
      ? { status: 'missing' }
      : null;
  }
  if (!isInside(realRoot, real)) return null;
  let st;
  try {
    st = statSync(real);
  } catch {
    return { status: 'missing' };
  }
  if (!st.isFile()) return { status: 'missing' };
  return { status: 'ok', path: real, dev: st.dev, ino: st.ino, root: realRoot };
}

function safeRealpath(p: string): string | undefined {
  try {
    return realpathSync(p);
  } catch {
    return undefined;
  }
}

/** `p` with its longest existing prefix replaced by that prefix's real path. */
function realpathOfNearest(p: string): string {
  const missing: string[] = [];
  let current = p;
  for (;;) {
    const real = safeRealpath(current);
    if (real !== undefined) return path.join(real, ...missing.reverse());
    const parent = path.dirname(current);
    if (parent === current) return p;
    missing.push(path.basename(current));
    current = parent;
  }
}

function isInside(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  // `..` as a whole segment only: `..trace.zip` is a file in the root
  // (internal code review F-015).
  return (
    rel === '' ||
    (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
  );
}

export type UploadArtifactResult =
  | {
      status: 'uploaded' | 'deduplicated';
      id: string;
      url: string | null;
      target_id: string | null;
    }
  | { status: 'skipped'; reason: 'too_large'; size: number }
  | { status: 'missing' }
  | { status: 'rejected'; message: string }
  | { status: 'failed'; message: string };

export interface UploadArtifactOptions {
  target: ArtifactTarget;
  filePath: string;
  /** automation_run_result only: screenshot, trace, video, … */
  kind?: string;
  /** automation_run_result only: index of the earlier attempt. */
  attemptIndex?: number | null;
  /** Serve the file without auth (`--embed` needs it; default private). */
  isPublic?: boolean;
  /**
   * The identity `resolveArtifactPath` recorded. When absent, the file's
   * real path is stat'ed here (an explicit `levr attach` file).
   */
  validated?: Pick<ResolvedArtifactPath, 'path' | 'dev' | 'ino' | 'root'>;
  /** Display name; defaults to the file's base name. */
  name?: string;
  /** Test seam: backoff between retries. */
  sleep?: (ms: number) => Promise<void>;
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
export async function uploadArtifactFile(
  options: UploadArtifactOptions,
): Promise<UploadArtifactResult> {
  const { target, filePath } = options;
  const sleep = options.sleep ?? defaultSleep;
  const isAutomation = target.relatedType === 'automation_run_result';

  let validated = options.validated;
  if (!validated) {
    const real = safeRealpath(filePath);
    if (real === undefined) return { status: 'missing' };
    try {
      const st = statSync(real);
      if (!st.isFile()) return { status: 'missing' };
      validated = { path: real, dev: st.dev, ino: st.ino };
    } catch {
      return { status: 'missing' };
    }
  }

  const flags =
    process.platform === 'win32'
      ? constants.O_RDONLY
      : constants.O_RDONLY | constants.O_NOFOLLOW;
  let handle: fsp.FileHandle;
  try {
    handle = await fsp.open(validated.path, flags);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { status: 'missing' };
    if (code === 'ELOOP') {
      return { status: 'rejected', message: 'the path became a symlink' };
    }
    return { status: 'failed', message: (err as Error).message };
  }

  let bytes: Buffer;
  try {
    const st = await handle.stat();
    if (st.dev !== validated.dev || st.ino !== validated.ino) {
      return {
        status: 'rejected',
        message: 'the file changed after it was validated',
      };
    }
    if (validated.root && !openedInside(handle.fd, validated, validated.root)) {
      return {
        status: 'rejected',
        message: 'the opened file is outside the working directory',
      };
    }
    if (st.size > MAX_ARTIFACT_BYTES) {
      return { status: 'skipped', reason: 'too_large', size: st.size };
    }
    bytes = await handle.readFile();
  } catch (err) {
    // An I/O error on the open handle is a status too: the caller counts
    // it, it never escapes (internal code review F-002).
    return { status: 'failed', message: (err as Error).message };
  } finally {
    await handle.close().catch(() => undefined);
  }

  const name = options.name ?? path.basename(filePath);
  // Insertion order IS the multipart part order: every text field first,
  // the file part last.
  const body: {
    related_type: TargetType;
    related_id: string;
    kind?: string;
    attempt_index?: number;
    is_public?: boolean;
    file?: File;
  } = {
    related_type: target.relatedType,
    related_id: target.relatedId,
  };
  if (isAutomation) {
    if (options.kind) body.kind = options.kind;
    if (options.attemptIndex !== undefined && options.attemptIndex !== null) {
      body.attempt_index = options.attemptIndex;
    }
  }
  if (options.isPublic !== undefined) body.is_public = options.isPublic;
  body.file = new File([new Uint8Array(bytes)], name);

  for (let attempt = 0; ; attempt++) {
    let outcome: UploadAttachmentOutcome | undefined;
    let thrown: unknown;
    try {
      outcome = await uploadAttachment(body as never);
    } catch (err) {
      thrown = err;
    }

    if (outcome && outcome.status >= 200 && outcome.status < 300) {
      const data = outcome.data;
      if (!data?.id) {
        return { status: 'failed', message: 'upload returned no attachment' };
      }
      return {
        status:
          data.deduplicated || outcome.status === 200
            ? 'deduplicated'
            : 'uploaded',
        id: data.id,
        url: data.url ?? null,
        target_id: data.target_id ?? null,
      };
    }

    const kind = classifyFailure(outcome, thrown);
    const retryable =
      kind === 'not_received' || (kind === 'ambiguous' && isAutomation);
    if (retryable && attempt < MAX_UPLOAD_RETRIES) {
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if (kind === 'ambiguous' && !isAutomation) {
      return {
        status: 'failed',
        message: 'outcome unknown, not retried to avoid a duplicate attachment',
      };
    }
    return { status: 'failed', message: describeFailure(outcome, thrown) };
  }
}

/**
 * Where the OPEN descriptor really lives (internal code review F-005).
 * O_NOFOLLOW guards only the last component, and the dev/inode recorded at
 * validation was itself read through a path whose parent could have been
 * swapped for a symlink in between. On Linux `/proc/self/fd/<fd>` names the
 * opened file authoritatively. Elsewhere Node has no fd → path call, so the
 * path is resolved again and must still be the validated, in-root path
 * holding the same file: this narrows the window to the open itself rather
 * than closing it.
 */
function openedInside(
  fd: number,
  validated: { path: string; dev: number; ino: number },
  root: string,
): boolean {
  if (process.platform === 'linux') {
    try {
      return isInside(root, readlinkSync(`/proc/self/fd/${fd}`));
    } catch {
      return false;
    }
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

type FailureKind = 'not_received' | 'ambiguous' | 'rejected';

/**
 * not_received: the server cannot have acted (429, connection refused, DNS).
 * ambiguous: the request may have landed (timeout, reset, 5xx, unknown).
 * rejected: a definite 4xx answer — never retried.
 */
function classifyFailure(
  outcome: UploadAttachmentOutcome | undefined,
  thrown: unknown,
): FailureKind {
  if (outcome) {
    if (outcome.status === 429) return 'not_received';
    if (outcome.status >= 500 || outcome.status === 0) return 'ambiguous';
    return 'rejected';
  }
  const code = errorCode(thrown);
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'not_received';
  }
  return 'ambiguous';
}

function errorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | undefined;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === 'string' ? code : undefined;
}

function describeFailure(
  outcome: UploadAttachmentOutcome | undefined,
  thrown: unknown,
): string {
  if (outcome) {
    const msg = (outcome.error as { message?: unknown } | undefined)?.message;
    const text = Array.isArray(msg)
      ? msg.join('; ')
      : typeof msg === 'string'
        ? msg
        : JSON.stringify(outcome.error ?? {});
    return `HTTP ${outcome.status}: ${text}`;
  }
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/** Markdown that shows an uploaded file: an image inline, anything else as a link. */
export function embedMarkdown(name: string, url: string): string {
  return /\.(png|jpe?g|gif|webp)$/i.test(name)
    ? `![${name}](${url})`
    : `[${name}](${url})`;
}
