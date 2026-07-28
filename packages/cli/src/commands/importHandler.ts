import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createInterface } from 'node:readline/promises';
import chalk from 'chalk';
import ora from 'ora';
import {
  testCaseImportCommitV1,
  testCaseImportPreviewV1,
  type PreviewImportResponseDto,
  type TestCaseImportResultDto,
} from '@levr/sdk';
import type { LocalContext } from '../context.js';
import { resolveToken } from '../auth/resolve-token.js';
import { resolveWorkspace } from '../workspace/resolve-workspace.js';
import { configureClient } from '../utils/sdk-client.js';
import { getApiUrl } from '../utils/env.js';
import {
  IMPORT_TARGETS,
  applyOverrides,
  columnsNeedingReview,
  missingRequired,
  parseMapFlag,
  type ImportTarget,
  type MappingEntry,
} from '../utils/import-mapping.js';

export interface ImportCommandFlags {
  'workspace-id'?: string;
  'team-id': string;
  'sheets-url'?: string;
  format?: 'csv' | 'xlsx' | 'json';
  map?: string[];
  'mapping-file'?: string;
  'save-mapping'?: string;
  yes: boolean;
  verbose: boolean;
}

const MATCH_COLORS: Record<string, (s: string) => string> = {
  exact: chalk.green,
  prefix: chalk.green,
  preset: chalk.green,
  fuzzy: chalk.yellow,
  llm: chalk.magenta,
  unmapped: chalk.red,
  manual: chalk.green, // user-asserted via --map or the interactive picker
};

/** Stream the file into a Blob — no readFileSync, no sync stall. */
async function fileToBlob(path: string): Promise<Blob> {
  const chunks: Buffer[] = [];
  for await (const chunk of createReadStream(path)) {
    chunks.push(chunk as Buffer);
  }
  return new Blob(chunks);
}

function printMapping(
  logger: LocalContext['logger'],
  mapping: MappingEntry[],
): void {
  const width = Math.max(...mapping.map((m) => m.originalName.length), 13);
  logger.info('');
  logger.info(
    chalk.bold(
      `  ${'SOURCE COLUMN'.padEnd(width)}  →  ${'TARGET'.padEnd(24)} MATCH`,
    ),
  );
  for (const m of mapping) {
    const color = MATCH_COLORS[m.matchType] ?? chalk.white;
    const target = m.targetProperty ?? '— unmapped —';
    const badge =
      m.matchType === 'unmapped'
        ? 'unmapped'
        : `${m.matchType} ${Math.round(m.confidence * 100)}%`;
    logger.info(
      `  ${m.originalName.padEnd(width)}  →  ${target.padEnd(24)} ${color(badge)}`,
    );
  }
  logger.info('');
}

async function pickTarget(
  rl: ReturnType<typeof createInterface>,
  logger: LocalContext['logger'],
  column: MappingEntry,
): Promise<ImportTarget | null> {
  logger.info(
    chalk.bold(
      `"${column.originalName}" is ${
        column.targetProperty
          ? `mapped to ${column.targetProperty} (low confidence)`
          : 'unmapped'
      }.`,
    ),
  );
  const columns = 3;
  const cellWidth = 26;
  for (let i = 0; i < IMPORT_TARGETS.length; i += columns) {
    logger.info(
      '  ' +
        IMPORT_TARGETS.slice(i, i + columns)
          .map((t, j) =>
            `${String(i + j + 1).padStart(2)}) ${t}`.padEnd(cellWidth),
          )
          .join(''),
    );
  }
  for (;;) {
    const answer = (
      await rl.question(
        'Target number or name (blank = skip/drop this column): ',
      )
    ).trim();
    if (answer === '') return null;
    const byNumber = IMPORT_TARGETS[Number(answer) - 1];
    if (byNumber && String(Number(answer)) === answer) return byNumber;
    const byName = IMPORT_TARGETS.find((t) => t === answer.toLowerCase());
    if (byName) return byName;
    logger.info(chalk.red(`  "${answer}" is not a valid target — try again.`));
  }
}

export async function importHandler(
  this: LocalContext,
  flags: ImportCommandFlags,
  file?: string,
): Promise<void> {
  if (flags.verbose) {
    this.logger.setVerbose(true);
  }

  if (!file && !flags['sheets-url']) {
    this.logger.error('Provide a file path or --sheets-url.');
    this.process.exitCode = 1;
    return;
  }
  if (file && flags['sheets-url']) {
    this.logger.error('Provide a file OR --sheets-url, not both.');
    this.process.exitCode = 1;
    return;
  }

  // 1. Auth + workspace (mirrors pushHandler)
  let auth;
  try {
    auth = await resolveToken();
  } catch (err) {
    this.logger.error(
      err instanceof Error ? err.message : 'Authentication failed.',
    );
    this.process.exitCode = 1;
    return;
  }
  configureClient(auth);
  if (flags.verbose) {
    this.logger.debug(`Auth: ${auth.type.toUpperCase()}`);
    this.logger.debug(`API:  ${getApiUrl()}`);
  }
  if (auth.type === 'jwt') {
    const workspaceOk = await resolveWorkspace.call(
      this,
      flags['workspace-id'],
    );
    if (!workspaceOk) {
      this.process.exitCode = 1;
      return;
    }
  }

  // 2. Preview
  const spinner = ora('Uploading and analyzing the file…').start();
  let preview: PreviewImportResponseDto;
  try {
    const body: Record<string, unknown> = {
      team_id: flags['team-id'],
      format: flags.format,
      sheets_url: flags['sheets-url'],
    };
    if (file) {
      // Streamed read (never readFileSync) — see fileToBlob.
      const blob = await fileToBlob(file);
      body['file'] = new File([blob], basename(file));
    }
    const result = await testCaseImportPreviewV1({
      body: body as never,
      requestValidator: undefined,
    });
    if (result.error || !result.data) {
      throw new Error(
        (result.error as { message?: string } | undefined)?.message ??
          `Preview failed (HTTP ${result.response?.status ?? '?'}).`,
      );
    }
    preview = result.data;
    spinner.succeed(
      `${preview.filename} (${preview.format}) — ${preview.row_count} data rows detected`,
    );
  } catch (err) {
    spinner.fail(err instanceof Error ? err.message : 'Preview failed.');
    this.process.exitCode = 1;
    return;
  }

  // 3. Overrides from flags / mapping file
  let mapping: MappingEntry[];
  try {
    const overrides = (flags.map ?? []).map(parseMapFlag);
    if (flags['mapping-file']) {
      const saved = JSON.parse(
        await readFile(flags['mapping-file'], 'utf8'),
      ) as Array<{ column: string; target: ImportTarget | null }>;
      overrides.push(...saved);
    }
    mapping = applyOverrides(preview.proposed_mapping, overrides);
  } catch (err) {
    this.logger.error(err instanceof Error ? err.message : String(err));
    this.process.exitCode = 1;
    return;
  }

  printMapping(this.logger, mapping);

  // 4. Interactive review (TTY only, skipped by --yes)
  const interactive = !flags.yes && process.stdin.isTTY === true;
  if (interactive) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      for (const column of columnsNeedingReview(mapping)) {
        const target = await pickTarget(rl, this.logger, column);
        mapping = applyOverrides(mapping, [
          { column: column.originalName, target },
        ]);
      }
      // Required-field gate: ask specifically rather than failing later.
      while (missingRequired(mapping).length > 0) {
        this.logger.info(
          chalk.red(
            `Required field(s) uncovered: ${missingRequired(mapping).join(', ')}. Every test case needs a name.`,
          ),
        );
        const source = (
          await rl.question(
            `Which source column holds the test name? (${mapping.map((m) => m.originalName).join(', ')}): `,
          )
        ).trim();
        const entry = mapping.find((m) => m.originalName === source);
        if (!entry) {
          this.logger.info(
            chalk.red(`  "${source}" is not a column — try again.`),
          );
          continue;
        }
        mapping = applyOverrides(mapping, [
          { column: entry.originalName, target: 'test_name' },
        ]);
      }
      printMapping(this.logger, mapping);
      const confirm = (await rl.question('Commit this import? [y/N]: '))
        .trim()
        .toLowerCase();
      if (confirm !== 'y' && confirm !== 'yes') {
        this.logger.info('Aborted — nothing was written.');
        return;
      }
    } finally {
      rl.close();
    }
  } else if (missingRequired(mapping).length > 0) {
    this.logger.error(
      `Required field(s) uncovered: ${missingRequired(mapping).join(', ')}. ` +
        'Map them with --map "Source Column=test_name" (non-interactive runs cannot prompt).',
    );
    this.process.exitCode = 1;
    return;
  }

  if (flags['save-mapping']) {
    await writeFile(
      flags['save-mapping'],
      JSON.stringify(
        mapping.map((m) => ({
          column: m.originalName,
          target: m.targetProperty,
        })),
        null,
        2,
      ) + '\n',
    );
    this.logger.info(`Confirmed mapping saved to ${flags['save-mapping']}`);
  }

  // 5. Commit
  const commitSpinner = ora('Committing import…').start();
  let outcome: TestCaseImportResultDto;
  try {
    const result = await testCaseImportCommitV1({
      body: {
        token: preview.token,
        confirmed_mapping: mapping,
      },
      requestValidator: undefined,
    });
    if (result.error || !result.data) {
      throw new Error(
        (result.error as { message?: string } | undefined)?.message ??
          `Commit failed (HTTP ${result.response?.status ?? '?'}).`,
      );
    }
    outcome = result.data;
  } catch (err) {
    commitSpinner.fail(err instanceof Error ? err.message : 'Commit failed.');
    this.process.exitCode = 1;
    return;
  }

  const { stats } = outcome;
  if (outcome.status === 'failed') {
    commitSpinner.fail(
      `Import failed — 0 of ${stats.rows_processed} rows imported.`,
    );
  } else {
    commitSpinner.succeed(
      `Import ${outcome.status.replace(/_/g, ' ')}: ${stats.tests_created} tests, ` +
        `${stats.folders_created} folders, ${stats.steps_created} steps, ` +
        `${stats.preconditions_created} preconditions (${stats.rows_failed} rows failed)`,
    );
  }
  for (const warning of outcome.warnings) {
    this.logger.info(chalk.yellow(`  warning: ${warning.message}`));
  }
  for (const error of outcome.errors) {
    this.logger.info(chalk.red(`  error: ${error.message}`));
  }
  if (outcome.status === 'failed') {
    this.process.exitCode = 1;
  }
}
