import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
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
import { configureClient, uploadImport } from '../utils/sdk-client.js';
import type { ImportResult } from '../utils/sdk-client.js';
import {
  formatArtifactSummary,
  uploadReportArtifacts,
} from '../utils/push-artifacts.js';

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

  // 4b. Resolve automation-source UUID: flag > env (no auto-detect — UUIDs
  // require an explicit caller decision). internal: the UUID names an
  // existing source and is sent to POST /v1/imports as
  // `automation_source_id` INSTEAD of the name — the server accepts exactly
  // one of the two.
  const automationSourceId =
    flags['automation-source'] ?? getAutomationSourceIdOverride();
  const automationSourceOrigin = flags['automation-source']
    ? 'explicit'
    : automationSourceId
      ? 'LEVR_AUTOMATION_SOURCE_ID'
      : undefined;

  // internal R2 — a source is required: a name (resolved post all three
  // tiers: flag → LEVR_SOURCE → CI auto-detect, NOT the raw `flags.source`,
  // so CI users relying on auto-detection pass) or a UUID. internal: the
  // UUID satisfies it on its own — this guard used to run before the UUID
  // was read, so `-a` alone failed everywhere except CI. Local reject before
  // HTTP for a fast, descriptive error.
  if (!sourceName && !automationSourceId) {
    this.logger.error(
      'Error: --source is required. Provide it explicitly with --source (or an existing source UUID with --automation-source), set the LEVR_SOURCE env var, or run in a supported CI environment for auto-detection.',
    );
    this.logger.error('');
    this.logger.error('Example:');
    this.logger.error('  levr push results.xml --source backend-unit-tests');
    this.process.exitCode = 1;
    return;
  }

  // The UUID wins over a name. An auto-detected name is dropped silently
  // (it was never the caller's choice); an explicit one is reported, since
  // it will not be used.
  if (automationSourceId && sourceName && sourceOrigin !== 'auto-detected') {
    this.logger.warning(
      `--automation-source (${automationSourceOrigin}) takes precedence; ignoring source name "${sourceName}" (${sourceOrigin}).`,
    );
  }

  // A source addressed by UUID already has a team, and the server rejects a
  // team_id that differs from it. Forward only an EXPLICIT --team-id: a
  // workspace-wide LEVR_TEAM_ID was never sent on this path before internal,
  // and forwarding it would break pipelines whose source lives elsewhere.
  const uploadTeamId =
    automationSourceId && !flags['team-id'] ? undefined : teamId;

  // 5. CI metadata
  const ciMeta = getCiMetadata();

  // 5b. internal: --output-results / --artifacts both need the server's
  // per-result identities, so either one sends include_results. The CLI
  // never derives a test identity itself.
  const outputResults = flags['output-results'];
  const artifactsDir = flags.artifacts;
  const includeResults = Boolean(outputResults || artifactsDir);

  // Verbose: pre-upload diagnostics
  if (flags.verbose) {
    this.logger.debug(
      `Team: ${uploadTeamId ?? (automationSourceId ? "(automation source's team)" : '(server default)')}`,
    );

    this.logger.debug(`File: ${file} (${formatBytes(fileStat.size)})`);
    if (flags.format) {
      this.logger.debug(`Format: ${flags.format}`);
    }
    if (automationSourceId) {
      this.logger.debug(
        `Automation source: ${automationSourceId} (${automationSourceOrigin})`,
      );
    } else if (sourceName) {
      this.logger.debug(`Source: ${sourceName} (${sourceOrigin})`);
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

    const result = await uploadImport({
      teamId: uploadTeamId,
      file: fileObj,
      fileName,
      format: flags.format,
      runName: flags['run-name'],
      ...(automationSourceId
        ? { automationSourceId }
        : { automationSource: sourceName }),
      importMetadata: ciMeta as Record<string, unknown> | undefined,
      includeResults,
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
      if (automationSourceId) {
        this.process.stdout.write(
          `  Source:   ${result.automation_source_name ?? automationSourceId} (${automationSourceOrigin})\n`,
        );
      } else if (sourceName) {
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
        if (result.result.stats) {
          const s = result.result.stats;
          this.process.stdout.write(
            `  Results:  ${s.passed} passed, ${s.failed} failed, ${s.errored} errored, ${s.skipped} skipped\n`,
          );
        }
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

      if (includeResults) {
        await handleResultArtifacts(this, result, {
          outputResults,
          artifactsDir,
          reportFile: file,
        });
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

/**
 * internal: write the results file and upload the report's artifacts.
 * fail_fallback(warn) throughout — nothing here changes the push exit code
 * (DD5, internal): every problem becomes a warning or a summary count.
 */
async function handleResultArtifacts(
  ctx: LocalContext,
  result: ImportResult,
  options: {
    outputResults?: string;
    artifactsDir?: string;
    reportFile: string;
  },
): Promise<void> {
  const results = result.result?.results ?? [];
  if (options.outputResults) {
    try {
      writeFileSync(
        options.outputResults,
        `${JSON.stringify(results, null, 2)}\n`,
      );
      ctx.process.stdout.write(
        `  Results:  ${results.length} written to ${options.outputResults}\n`,
      );
    } catch (err) {
      ctx.logger.warning(
        `Could not write ${options.outputResults}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (options.artifactsDir) {
    try {
      const summary = await uploadReportArtifacts({
        results,
        artifactsDir: resolve(options.artifactsDir),
        reportDir: dirname(resolve(options.reportFile)),
        onProblem: (path, outcome) => {
          const why =
            outcome === 'rejected'
              ? 'outside the working directory'
              : outcome.status === 'skipped'
                ? 'larger than 50 MiB'
                : 'message' in outcome
                  ? outcome.message
                  : outcome.status;
          ctx.logger.debug(`artifact ${path}: ${why}`);
        },
      });
      const line = formatArtifactSummary(summary);
      const problems =
        summary.skipped + summary.missing + summary.rejected + summary.failed;
      if (problems > 0) ctx.logger.warning(line);
      else ctx.process.stdout.write(`  ${line}\n`);
    } catch (err) {
      ctx.logger.warning(
        `Artifact upload stopped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
