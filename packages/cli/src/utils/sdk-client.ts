import { client, importCreateV1 } from '@levr/sdk';
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
  automation_source_id?: string;
  automation_source_name?: string;
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
  format?: 'junit' | 'gherkin' | 'cucumber-json' | 'ctrf-json';
  parentFolderId?: string;
  runName?: string;
  // internal R3: createRun option removed. Run creation is driven by the
  // parsed file's `hasResults` shape, not by a caller flag.
  updateMode?: 'update' | 'create_new';
  /** Source name (find-or-create). Mutually exclusive with automationSourceId. */
  automationSource?: string;
  /** UUID of an existing source (internal). Mutually exclusive with automationSource. */
  automationSourceId?: string;
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
      automation_source_id: options.automationSourceId,
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
      case 404:
        throw new Error(
          tryReadMessage(result.error) ??
            'Not found. Check --automation-source and --team-id.',
        );
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

function tryReadMessage(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    return typeof m === 'string' ? m : undefined;
  }
  return undefined;
}
