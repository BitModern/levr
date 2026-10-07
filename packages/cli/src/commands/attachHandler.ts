import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { LocalContext } from '../context.js';
import type { AttachCommandFlags } from './attach.js';
import { connect } from '../utils/connect.js';
import {
  TargetParseError,
  embedMarkdown,
  parseTarget,
  uploadArtifactFile,
} from '../utils/artifact-upload.js';
import type {
  ArtifactTarget,
  UploadArtifactResult,
} from '../utils/artifact-upload.js';
import { appendActualResult, createComment } from '../utils/sdk-client.js';

interface AttachJob {
  target: ArtifactTarget;
  files: string[];
  kind?: string;
  attempt?: number;
}

/**
 * `levr attach` (internal D4). fail_closed: any file that fails or is
 * skipped, and any failed embed write, exits 1 — an explicit attach is a
 * request, unlike `levr push --artifacts`.
 *
 * Visibility: every upload is private, --embed included (internal code
 * review F-006). Levr serves a private attachment's url to any signed-in
 * workspace member, so the embedded link renders in Levr without making the
 * file readable by anyone holding the link. --embed writes
 * append-only — a NEW comment on an issue, test or run, or a server-side
 * `append_actual_result` on an execution result — never a rewrite of
 * entity text (audit A3).
 */
export async function attachHandler(
  this: LocalContext,
  flags: AttachCommandFlags,
  ...args: string[]
): Promise<void> {
  if (flags.verbose) this.logger.setVerbose(true);

  let jobs: AttachJob[];
  try {
    jobs = flags.manifest
      ? readManifest(flags.manifest)
      : [singleJob(args, flags)];
  } catch (err) {
    this.logger.error(err instanceof Error ? err.message : String(err));
    this.process.exitCode = 1;
    return;
  }

  if (flags.embed) {
    for (const job of jobs) {
      if (!embedWriter(job.target)) {
        this.logger.error(
          `--embed is not supported for ${job.target.relatedType} targets (issue, test, run or run_result_variant only).`,
        );
        this.process.exitCode = 1;
        return;
      }
    }
  }

  if (!(await connect(this, flags['workspace-id']))) return;

  let failed = false;
  for (const job of jobs) {
    const uploaded: Array<{ name: string; url: string; targetId: string }> = [];
    for (const file of job.files) {
      const result = await uploadArtifactFile({
        target: job.target,
        filePath: file,
        kind: job.kind,
        attemptIndex: job.attempt,
      });
      report(this, file, result);
      if (result.status === 'uploaded' || result.status === 'deduplicated') {
        if (result.url && result.target_id) {
          uploaded.push({
            name: basename(file),
            url: result.url,
            targetId: result.target_id,
          });
        }
      } else {
        failed = true;
      }
    }

    const first = uploaded[0];
    if (flags.embed && first) {
      const markdown = uploaded
        .map((u) => embedMarkdown(u.name, u.url))
        .join('\n');
      try {
        await writeEmbed(job.target, first.targetId, markdown);
        this.process.stdout.write(
          `  embedded ${uploaded.length} file(s) on ${job.target.relatedId}\n`,
        );
      } catch (err) {
        // The attachments stay (they are listed on the entity); only the
        // link failed.
        this.logger.error(
          `Embed failed for ${job.target.relatedId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        failed = true;
      }
    }
  }

  if (failed) this.process.exitCode = 1;
}

function singleJob(args: string[], flags: AttachCommandFlags): AttachJob {
  const [targetArg, ...files] = args;
  if (!targetArg || files.length === 0) {
    throw new Error(
      'Usage: levr attach <target> <files...>  (or levr attach --manifest <json>)',
    );
  }
  return {
    target: parseTarget(targetArg),
    files,
    kind: flags.kind,
    attempt: flags.attempt,
  };
}

/** `[{ target, files[], kind?, attempt? }]` — validated before any upload. */
function readManifest(file: string): AttachJob[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(
      `Cannot read manifest ${file}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!Array.isArray(raw)) {
    throw new Error(`Manifest ${file} must be a JSON array`);
  }
  return raw.map((entry: unknown, i: number) => {
    const e = entry as {
      target?: unknown;
      files?: unknown;
      kind?: unknown;
      attempt?: unknown;
    };
    if (typeof e?.target !== 'string') {
      throw new Error(`Manifest entry ${i}: "target" must be a string`);
    }
    if (
      !Array.isArray(e.files) ||
      e.files.length === 0 ||
      !e.files.every((f) => typeof f === 'string')
    ) {
      throw new Error(`Manifest entry ${i}: "files" must be a string array`);
    }
    if (
      e.attempt !== undefined &&
      !(Number.isInteger(e.attempt) && (e.attempt as number) >= 0)
    ) {
      throw new Error(`Manifest entry ${i}: "attempt" must be an integer >= 0`);
    }
    try {
      return {
        target: parseTarget(e.target),
        files: e.files,
        kind: typeof e.kind === 'string' ? e.kind : undefined,
        attempt: e.attempt as number | undefined,
      };
    } catch (err) {
      if (err instanceof TargetParseError) {
        throw new Error(`Manifest entry ${i}: ${err.message}`);
      }
      throw err;
    }
  });
}

type EmbedWriter = 'comment' | 'actual_result';

function embedWriter(target: ArtifactTarget): EmbedWriter | undefined {
  if (target.relatedType === 'run_result_variant') return 'actual_result';
  if (
    target.relatedType === 'issue' ||
    target.relatedType === 'test' ||
    target.relatedType === 'run'
  ) {
    return 'comment';
  }
  return undefined;
}

/** Append-only: a new comment, or the server-side actual-result append. */
async function writeEmbed(
  target: ArtifactTarget,
  targetId: string,
  markdown: string,
): Promise<void> {
  if (embedWriter(target) === 'actual_result') {
    await appendActualResult(targetId, markdown);
    return;
  }
  await createComment(
    target.relatedType as 'issue' | 'test' | 'run',
    targetId,
    markdown,
  );
}

function report(
  ctx: LocalContext,
  file: string,
  result: UploadArtifactResult,
): void {
  switch (result.status) {
    case 'uploaded':
      ctx.process.stdout.write(`  attached ${file} (${result.id})\n`);
      return;
    case 'deduplicated':
      ctx.process.stdout.write(`  already attached ${file} (${result.id})\n`);
      return;
    case 'skipped':
      ctx.logger.warning(`skipped ${file}: larger than 50 MiB`);
      return;
    case 'missing':
      ctx.logger.error(`not found: ${file}`);
      return;
    case 'rejected':
      ctx.logger.error(`refused ${file}: ${result.message}`);
      return;
    case 'failed':
      ctx.logger.error(`failed ${file}: ${result.message}`);
      return;
  }
}
