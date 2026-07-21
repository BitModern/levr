import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import ora from 'ora';
import { client } from '@levr/sdk';
import type { LocalContext } from '../context.js';
import type { PushCommandFlags } from '../types/push-types.js';
import { resolveToken } from '../auth/resolve-token.js';
import { resolveWorkspace } from '../workspace/resolve-workspace.js';
import {
  getTeamId,
  getSourceOverride,
  getAutomationSourceIdOverride,
  getApiUrl,
} from '../utils/env.js';
import { detectSource, getCiMetadata } from '../utils/ci-detect.js';
import {
  configureClient,
  uploadImport,
  uploadAutomationIngest,
} from '../utils/sdk-client.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)}KB`;
  return `${(kb / 1024).toFixed(1)}MB`;
}

export async function pushHandler(
  this: LocalContext,
  flags: PushCommandFlags,
  file: string,
): Promise<void> {
  if (flags.verbose) {
    this.logger.setVerbose(true);
  }

  // 1. Resolve auth
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

  // 1b. Resolve workspace (JWT only — PAT has workspace baked in)
  if (auth.type === 'jwt') {
    try {
      const ws = await resolveWorkspace(flags['workspace-id']);
      // Update client config with resolved workspace
      client.setConfig({ ...client.getConfig(), workspaceId: ws.workspaceId });
      if (flags.verbose) {
        this.logger.debug(`Workspace: ${ws.workspaceId} (${ws.source})`);
      }
    } catch (err) {
      this.logger.error(
        err instanceof Error ? err.message : 'Workspace resolution failed.',
      );
      this.process.exitCode = 1;
      return;
    }
  }

  // 2. Validate file
  let fileStat;
  try {
    fileStat = statSync(file);
  } catch {
    this.logger.error(`File not found: ${file}`);
    this.process.exitCode = 1;
    return;
  }

  if (fileStat.size > MAX_FILE_SIZE) {
    const sizeMB = (fileStat.size / (1024 * 1024)).toFixed(1);
    this.logger.error(`File too large (${sizeMB}MB). Maximum is 10MB.`);
    this.process.exitCode = 1;
    return;
  }

  // 3. Resolve team ID (optional — server resolves default if omitted)
  const teamId = getTeamId(flags['team-id']);

  // 4. Resolve source: flag > env > CI auto-detect > undefined
  const sourceName = flags.source ?? getSourceOverride() ?? detectSource();
  let sourceOrigin: string | undefined;
  if (flags.source) {
    sourceOrigin = 'explicit';
  } else if (getSourceOverride()) {
    sourceOrigin = 'LEVR_SOURCE';
  } else if (sourceName) {
    sourceOrigin = 'auto-detected';
  }

  // internal R2 — source is required. Guard on the resolved `sourceName`
  // (post all three tiers: flag → LEVR_SOURCE → CI auto-detect), NOT on the
  // raw `flags.source`. CI users who rely on auto-detection don't pass
  // `--source` explicitly; guarding only the flag would falsely reject
  // them. Local reject before HTTP for a fast, descriptive error.
  if (!sourceName) {
    this.logger.error(
      'Error: --source is required. Provide it explicitly with --source, set the LEVR_SOURCE env var, or run in a supported CI environment for auto-detection.',
    );
    this.logger.error('');
    this.logger.error('Example:');
    this.logger.error('  levr push results.xml --source backend-unit-tests');
    this.process.exitCode = 1;
    return;
  }

  // 4b. Resolve automation-source UUID: flag > env (no auto-detect — UUIDs
  // require an explicit caller decision). When set, routes the upload to
  // the synchronous /v1/automation-run/ingest endpoint instead of the
  // legacy /v1/imports queue.
  const automationSourceId =
    flags['automation-source'] ?? getAutomationSourceIdOverride();
  const automationSourceOrigin = flags['automation-source']
    ? 'explicit'
    : automationSourceId
      ? 'LEVR_AUTOMATION_SOURCE_ID'
      : undefined;

  // 5. CI metadata
  const ciMeta = getCiMetadata();

  // Verbose: pre-upload diagnostics
  if (flags.verbose) {
    this.logger.debug(`Team: ${teamId ?? '(server default)'}`);

    this.logger.debug(`File: ${file} (${formatBytes(fileStat.size)})`);
    if (flags.format) {
      this.logger.debug(`Format: ${flags.format}`);
    }
    if (flags['update-mode']) {
      this.logger.debug(`Update mode: ${flags['update-mode']}`);
    }
    if (sourceName) {
      this.logger.debug(`Source: ${sourceName} (${sourceOrigin})`);
    }
    if (automationSourceId) {
      this.logger.debug(
        `Automation source: ${automationSourceId} (${automationSourceOrigin}) → POST /v1/automation-run/ingest`,
      );
    }
    if (ciMeta) {
      this.logger.debug(
        `CI detected: ${ciMeta.ci_provider?.replace(/_/g, ' ') ?? 'unknown'}`,
      );
      if (ciMeta.branch) this.logger.debug(`Branch: ${ciMeta.branch}`);
      if (ciMeta.commit_sha) {
        this.logger.debug(`Commit: ${ciMeta.commit_sha.slice(0, 7)}`);
      }
      if (ciMeta.ci_build_id) {
        this.logger.debug(`Build: ${ciMeta.ci_build_id}`);
      }
    }
  }

  // 6. Read file and upload
  const fileName = basename(file);
  this.process.stdout.write(`Pushing ${fileName}...\n`);

  const spinner = ora({
    text: 'Uploading...',
    stream: this.process.stdout,
  }).start();

  try {
    const fileBuffer = readFileSync(file);
    const fileObj = new File([fileBuffer], fileName);

    // internal D9 routing fork: when an automation_source UUID is in scope,
    // route to the synchronous /v1/automation-run/ingest endpoint and emit
    // a streamlined automation result. Otherwise fall through to the legacy
    // /v1/imports queue (which routes server-side to AutomationBuilder when
    // a source NAME is present, via the D3 fork).
    if (automationSourceId) {
      // Map non-junit/ctrf-json formats from the legacy enum to ctrf-json
      // shouldn't happen — automation ingest only supports junit/ctrf-json.
      // For 'gherkin' / 'cucumber-json' format hints with an automation
      // source set, the server will reject with a parse error. Pass the
      // hint through and let the server respond with a 422.
      const ingestResult = await uploadAutomationIngest({
        file: fileObj,
        fileName,
        automationSourceId,
        runName: flags['run-name'],
        format: flags.format as
          | 'junit'
          | 'ctrf-json'
          | 'gherkin'
          | 'cucumber-json'
          | undefined,
        externalRunKey: ciMeta?.ci_build_id,
        importMetadata: ciMeta as Record<string, unknown> | undefined,
      });

      spinner.stop();

      this.process.stdout.write('\nAutomation run ingested!\n\n');
      this.process.stdout.write(
        `  Run ID:   ${ingestResult.automation_run_id}\n`,
      );
      this.process.stdout.write(`  Source:   ${automationSourceId}\n`);
      this.process.stdout.write(
        `  Results:  ${ingestResult.passed} passed, ${ingestResult.failed} failed, ${ingestResult.errored} errored, ${ingestResult.skipped} skipped\n`,
      );
      this.process.stdout.write(`  Total:    ${ingestResult.total_tests}\n`);
      if (ciMeta) {
        const prettyProvider = ciMeta.ci_provider?.replace(/_/g, ' ') ?? 'CI';
        const ciLabel = ciMeta.ci_build_id
          ? `${prettyProvider} #${ciMeta.ci_build_id}`
          : prettyProvider;
        this.process.stdout.write(`  CI:       ${ciLabel}\n`);
      }
      return;
    }

    const result = await uploadImport({
      teamId,
      file: fileObj,
      fileName,
      format: flags.format,
      parentFolderId: flags['parent-folder-id'],
      runName: flags['run-name'],
      updateMode: flags['update-mode'],
      automationSource: sourceName,
      importMetadata: ciMeta as Record<string, unknown> | undefined,
    });

    spinner.stop();

    // 7. Check import status and display results
    if (result?.status === 'failed') {
      const msg = result.error?.message ?? 'Import failed on the server.';
      this.logger.error(msg);
      this.process.exitCode = 1;
      return;
    }

    this.process.stdout.write('\nImport completed!\n\n');

    if (result) {
      if (result.team_id) {
        this.process.stdout.write(`  Team:     ${result.team_id}\n`);
      }
      if (result.format) {
        this.process.stdout.write(`  Format:   ${result.format}\n`);
      }
      if (sourceName) {
        this.process.stdout.write(
          `  Source:   ${sourceName}${sourceOrigin ? ` (${sourceOrigin})` : ''}\n`,
        );
      }
      if (result.result?.stats) {
        const { tests_created, tests_updated } = result.result.stats;
        this.process.stdout.write(
          `  Tests:    ${tests_created} created, ${tests_updated} updated\n`,
        );
      }
      if (result.result?.run_id) {
        this.process.stdout.write(`  Run:      ${result.result.run_id}\n`);
      }

      if (
        result.status === 'completed_with_warnings' &&
        result.result?.warnings?.length
      ) {
        this.process.stdout.write('\n');
        const warnings = result.result.warnings as Array<{
          message: string;
          count: number;
        }>;
        for (const w of warnings) {
          this.logger.warning(`${w.message} (${w.count})`);
        }
      }

      if (ciMeta) {
        const prettyProvider = ciMeta.ci_provider?.replace(/_/g, ' ') ?? 'CI';
        const ciLabel = ciMeta.ci_build_id
          ? `${prettyProvider} #${ciMeta.ci_build_id}`
          : prettyProvider;
        this.process.stdout.write(`  CI:       ${ciLabel}\n`);
      }

      // Verbose: detailed import stats. internal R6 — unified on the
      // AutomationBuildResult.stats shape. Legacy keys (folders_*,
      // steps_created, tests_skipped, attachments_*) are gone; the
      // automation builder doesn't model those concepts.
      if (flags.verbose && result.result?.stats) {
        const s = result.result.stats;
        this.process.stdout.write('\n  Details:\n');
        // Result counters: include the full enum surface. Errored / pending
        // / todo / flaky are CTRF-native states the legacy stats shape
        // didn't carry.
        this.process.stdout.write(
          `    Results:     ${s.passed} passed, ${s.failed} failed, ${s.errored} errored, ${s.skipped} skipped\n`,
        );
        if (s.pending || s.todo || s.flaky) {
          this.process.stdout.write(
            `                 ${s.pending} pending, ${s.todo} todo, ${s.flaky} flaky\n`,
          );
        }
        // Suites = CTRF suite hierarchy (renamed from "folders" because
        // automation_suite ≠ the manual test-folder tree).
        if (s.suites_created || s.suites_updated) {
          this.process.stdout.write(
            `    Suites:      ${s.suites_created} created, ${s.suites_updated} updated\n`,
          );
        }
        if (s.tests_created || s.tests_updated) {
          this.process.stdout.write(
            `    Tests:       ${s.tests_created} created, ${s.tests_updated} updated\n`,
          );
        }
        if (s.results_created || s.results_updated) {
          this.process.stdout.write(
            `    Run results: ${s.results_created} created, ${s.results_updated} updated\n`,
          );
        }
        if (s.labels_created || s.label_assignments_created) {
          this.process.stdout.write(
            `    Labels:      ${s.labels_created} created, ${s.label_assignments_created} assignments\n`,
          );
        }
      }
    }
  } catch (err) {
    spinner.stop();
    this.logger.error(err instanceof Error ? err.message : 'Upload failed.');
    this.process.exitCode = 1;
  }
}
