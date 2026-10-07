/**
 * `levr push --artifacts` (internal D4, flow 2): upload every artifact the
 * import reported as `stored: false` to its automation result.
 *
 * fail_fallback(warn): every problem is counted in the summary and none
 * throws, so the push exit code never depends on an artifact (DD5, internal).
 */
import type { ImportResultItem } from './sdk-client.js';
import { resolveArtifactPath, uploadArtifactFile } from './artifact-upload.js';
import type { UploadArtifactResult } from './artifact-upload.js';

export const ARTIFACT_UPLOAD_CONCURRENCY = 4;

export interface ArtifactSummary {
  uploaded: number;
  deduplicated: number;
  skipped: number;
  missing: number;
  rejected: number;
  failed: number;
}

export function formatArtifactSummary(s: ArtifactSummary): string {
  return (
    `Artifacts: uploaded ${s.uploaded}, deduplicated ${s.deduplicated}, ` +
    `skipped ${s.skipped} (too large), missing ${s.missing}, ` +
    `rejected ${s.rejected} (outside the working directory), failed ${s.failed}`
  );
}

export async function uploadReportArtifacts(options: {
  results: ImportResultItem[];
  /** --artifacts <dir>: where report-relative paths resolve first. */
  artifactsDir: string;
  /** The report file's own directory: the fallback base. */
  reportDir: string;
  /** Confinement root (the working directory). */
  root?: string;
  onProblem?: (path: string, result: UploadArtifactResult | 'rejected') => void;
  concurrency?: number;
}): Promise<ArtifactSummary> {
  const summary: ArtifactSummary = {
    uploaded: 0,
    deduplicated: 0,
    skipped: 0,
    missing: 0,
    rejected: 0,
    failed: 0,
  };

  const tasks: Array<() => Promise<void>> = [];
  for (const result of options.results) {
    for (const att of result.attachments) {
      if (att.stored || !att.path) continue;
      const ref = att.path;
      const upload = async () => {
        let resolved = resolveArtifactPath(
          ref,
          options.artifactsDir,
          options.root,
        );
        if (resolved && resolved.status === 'missing') {
          resolved =
            resolveArtifactPath(ref, options.reportDir, options.root) ??
            resolved;
        }
        if (resolved === null) {
          summary.rejected += 1;
          options.onProblem?.(ref, 'rejected');
          return;
        }
        if (resolved.status === 'missing') {
          summary.missing += 1;
          options.onProblem?.(ref, { status: 'missing' });
          return;
        }
        const outcome = await uploadArtifactFile({
          target: {
            relatedType: 'automation_run_result',
            relatedId: result.id,
          },
          filePath: resolved.path,
          validated: resolved,
          name: att.name ?? undefined,
          kind: att.kind,
          attemptIndex: att.attempt_index,
        });
        switch (outcome.status) {
          case 'uploaded':
            summary.uploaded += 1;
            return;
          case 'deduplicated':
            summary.deduplicated += 1;
            return;
          case 'skipped':
            summary.skipped += 1;
            break;
          case 'missing':
            summary.missing += 1;
            break;
          case 'rejected':
            summary.rejected += 1;
            break;
          case 'failed':
            summary.failed += 1;
            break;
        }
        options.onProblem?.(ref, outcome);
      };
      // A task never rejects: one failure must not cost the other uploads
      // their place in the summary (internal code review F-002).
      tasks.push(async () => {
        try {
          await upload();
        } catch (err) {
          summary.failed += 1;
          options.onProblem?.(ref, {
            status: 'failed',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });
    }
  }

  await runBounded(tasks, options.concurrency ?? ARTIFACT_UPLOAD_CONCURRENCY);
  return summary;
}

/** Run tasks with at most `limit` in flight. Tasks must not throw. */
async function runBounded(
  tasks: Array<() => Promise<void>>,
  limit: number,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      if (task) await task();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker),
  );
}
