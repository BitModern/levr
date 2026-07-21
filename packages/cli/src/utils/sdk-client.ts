import {
  client,
  importCreateV1,
  automationRunIngestIngestV1,
} from '@levr/sdk';
import { getApiUrl } from './env.js';
import type { ResolvedAuth } from '../types/auth-types.js';

/**
 * Configure the SDK client with the resolved auth token and API URL.
 */
export function configureClient(
  auth: ResolvedAuth,
  workspaceId?: string,
): void {
  client.setConfig({
    baseUrl: getApiUrl(),
    auth: () => auth.token,
    workspaceId,
  });
}

export interface ImportResult {
  status?: string;
  error?: { message?: string };
  team_id?: string;
  format?: string;
  result?: {
    run_id?: string;
    // internal R6 — unified on AutomationBuildResult.stats shape.
    stats?: {
      suites_created: number;
      suites_updated: number;
      tests_created: number;
      tests_updated: number;
      results_created: number;
      results_updated: number;
      labels_created: number;
      label_assignments_created: number;
      passed: number;
      failed: number;
      errored: number;
      skipped: number;
      pending: number;
      todo: number;
      flaky: number;
    };
    warnings?: Array<{ message: string; count: number }>;
  };
}

export interface ImportOptions {
  teamId?: string;
  file: Blob;
  fileName: string;
  format?: 'junit' | 'gherkin' | 'cucumber-json';
  parentFolderId?: string;
  runName?: string;
  // internal R3: createRun option removed. Run creation is driven by the
  // parsed file's `hasResults` shape, not by a caller flag.
  updateMode?: 'update' | 'create_new';
  automationSource?: string;
  importMetadata?: Record<string, unknown>;
}

/**
 * Upload a test result file via the generated SDK function.
 * importCreateV1 handles auth, FormData serialization, and Content-Type automatically.
 *
 * Note: requestValidator is disabled because the generated Zod schema types
 * `file` as z.string() (from OpenAPI `format: binary`) but we pass a File object.
 * The server validates the actual multipart payload.
 */
export async function uploadImport(options: ImportOptions) {
  const result = await importCreateV1({
    body: {
      file: options.file,
      team_id: options.teamId,
      format: options.format,
      parent_folder_id: options.parentFolderId,
      run_name: options.runName,
      update_mode: options.updateMode,
      automation_source: options.automationSource,
      import_metadata: options.importMetadata
        ? JSON.stringify(options.importMetadata)
        : undefined,
    },
    requestValidator: undefined,
  });

  if (result.error) {
    const status = result.response?.status;
    switch (status) {
      case 401:
        throw new Error(
          "Authentication failed. Check your token or run 'levr auth login'.",
        );
      case 403:
        throw new Error('Permission denied. Check your team access.');
      case 422:
        throw new Error('File could not be processed. Check the file format.');
      case 429:
        throw new Error('Rate limited. Please try again later.');
      default:
        throw new Error(
          `Import failed (${String(status ?? 'unknown')}): ${JSON.stringify(result.error)}`,
        );
    }
  }

  return result.data as ImportResult;
}

export interface AutomationIngestOptions {
  file: Blob;
  fileName: string;
  automationSourceId: string;
  runName?: string;
  format?: 'junit' | 'ctrf-json' | 'gherkin' | 'cucumber-json';
  externalRunKey?: string;
  importMetadata?: Record<string, unknown>;
}

export interface AutomationIngestResult {
  automation_run_id: string;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  total_tests: number;
}

/**
 * Direct synchronous automation run ingest. Bypasses the ImportJob queue
 * used by uploadImport — calls POST /v1/automation-run/ingest and returns
 * the created automation_run_id immediately. Use when an
 * automation_source_id is known (from --automation-source flag or
 * LEVR_AUTOMATION_SOURCE_ID env var).
 */
export async function uploadAutomationIngest(
  options: AutomationIngestOptions,
): Promise<AutomationIngestResult> {
  const result = await automationRunIngestIngestV1({
    body: {
      file: options.file,
      automation_source_id: options.automationSourceId,
      run_name: options.runName,
      format: options.format,
      external_run_key: options.externalRunKey,
      import_metadata: options.importMetadata
        ? JSON.stringify(options.importMetadata)
        : undefined,
    },
    requestValidator: undefined,
  });

  if (result.error) {
    const status = result.response?.status;
    switch (status) {
      case 400:
        throw new Error(
          `Bad request: ${tryReadMessage(result.error) ?? 'check --automation-source value and file'}`,
        );
      case 401:
        throw new Error(
          "Authentication failed. Check your token or run 'levr auth login'.",
        );
      case 403:
        throw new Error('Permission denied. Check your workspace access.');
      case 404:
        throw new Error(
          `automation_source ${options.automationSourceId} not found in your workspace.`,
        );
      case 422:
        throw new Error(
          `File could not be parsed: ${tryReadMessage(result.error) ?? 'check the file and --format hint'}`,
        );
      case 429:
        throw new Error('Rate limited. Please try again later.');
      default:
        throw new Error(
          `Automation ingest failed (${String(status ?? 'unknown')}): ${JSON.stringify(result.error)}`,
        );
    }
  }

  return result.data as AutomationIngestResult;
}

function tryReadMessage(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    return typeof m === 'string' ? m : undefined;
  }
  return undefined;
}
