import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { LocalContext } from '../../context.js';
import type { ResultAppendCommandFlags } from './append.js';
import { connect } from '../../utils/connect.js';
import {
  embedMarkdown,
  parseTarget,
  uploadArtifactFile,
} from '../../utils/artifact-upload.js';
import { appendActualResult } from '../../utils/sdk-client.js';

/**
 * `levr result append` (internal D4, DD4). Uploads the --attach files first
 * (private: Levr serves their url to signed-in members, so the embedded
 * links render there; internal code review F-006), then sends ONE server-side
 * `append_actual_result` carrying the text plus a markdown link per file,
 * through PATCH /v1/run/run-result-variant/:id — the only public append that
 * needs no run or run-result id (audit A2). fail_closed: any failed upload
 * or a failed append exits 1; nothing is appended when an upload failed.
 */
export async function resultAppendHandler(
  this: LocalContext,
  flags: ResultAppendCommandFlags,
  targetArg: string,
): Promise<void> {
  if (flags.verbose) this.logger.setVerbose(true);

  let target;
  try {
    target = parseTarget(targetArg);
  } catch (err) {
    this.logger.error(err instanceof Error ? err.message : String(err));
    this.process.exitCode = 1;
    return;
  }
  if (target.relatedType !== 'run_result_variant') {
    this.logger.error(
      'levr result append takes run_result_variant:<uuid> (an execution result id).',
    );
    this.process.exitCode = 1;
    return;
  }
  if ((flags.text === undefined) === (flags.file === undefined)) {
    this.logger.error('Provide exactly one of --text or --file.');
    this.process.exitCode = 1;
    return;
  }

  let text: string;
  try {
    text = flags.text ?? readFileSync(flags.file as string, 'utf8');
  } catch (err) {
    this.logger.error(
      `Cannot read ${flags.file}: ${err instanceof Error ? err.message : String(err)}`,
    );
    this.process.exitCode = 1;
    return;
  }

  if (!(await connect(this, flags['workspace-id']))) return;

  const links: string[] = [];
  for (const file of flags.attach ?? []) {
    const result = await uploadArtifactFile({
      target,
      filePath: file,
    });
    if (
      (result.status === 'uploaded' || result.status === 'deduplicated') &&
      result.url
    ) {
      links.push(embedMarkdown(basename(file), result.url));
      this.process.stdout.write(`  attached ${file} (${result.id})\n`);
      continue;
    }
    const why =
      result.status === 'skipped'
        ? 'larger than 50 MiB'
        : result.status === 'missing'
          ? 'not found'
          : 'message' in result
            ? result.message
            : result.status;
    this.logger.error(`failed ${file}: ${why}`);
    this.process.exitCode = 1;
    return;
  }

  const appendText = [text.trimEnd(), ...links].filter((t) => t).join('\n');
  try {
    await appendActualResult(target.relatedId, appendText);
  } catch (err) {
    this.logger.error(err instanceof Error ? err.message : String(err));
    this.process.exitCode = 1;
    return;
  }
  this.process.stdout.write(
    `Appended to ${target.relatedId}${links.length ? ` with ${links.length} attachment(s)` : ''}.\n`,
  );
}
