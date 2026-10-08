import {
  attachmentUploadUploadV1,
  client,
  commentIssueCreateV1,
  commentRunCreateV1,
  commentTestCreateV1,
  importCreateV1,
  runApiUpdateRunResultVariantByIdV1,
} from '@levr-one/sdk';
import type {
  AttachmentUploadUploadV1Body,
  UpdateRunResultVariantDto,
  UploadAttachmentResponseDto,
} from '@levr-one/sdk';
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
    /** Present only when the import was sent with include_results (internal). */
    results?: ImportResultItem[];
  };
}

/** One imported automation result and the artifacts its report referenced. */
export interface ImportResultItem {
  id: string;
  name: string;
  suite: string | null;
  classname: string | null;
  status: string;
  test_key: string;
  attempts: number;
  attachments: Array<{
    path: string | null;
    name: string | null;
    kind: string;
    attempt_index: number | null;
    stored: boolean;
  }>;
}

export interface ImportOptions {
  teamId?: string;
  file: Blob;
  fileName: string;
  format?: 'junit' | 'gherkin' | 'cucumber-json' | 'ctrf-json';
  runName?: string;
  // internal R3: createRun option removed. Run creation is driven by the
  // parsed file's `hasResults` shape, not by a caller flag. internal:
  // parentFolderId / updateMode removed — ignored server-side since internal.
  /** Source name (find-or-create). Mutually exclusive with automationSourceId. */
  automationSource?: string;
  /** UUID of an existing source (internal). Mutually exclusive with automationSource. */
  automationSourceId?: string;
  importMetadata?: Record<string, unknown>;
  /**
   * Ask for result.results[] (internal): the server-side identity of every
   * imported result plus the artifacts its report references. Set by
   * `levr push --output-results / --artifacts`.
   */
  includeResults?: boolean;
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
      run_name: options.runName,
      automation_source: options.automationSource,
      automation_source_id: options.automationSourceId,
      import_metadata: options.importMetadata
        ? JSON.stringify(options.importMetadata)
        : undefined,
      include_results: options.includeResults ? true : undefined,
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

/**
 * The raw outcome of one POST /v1/attachment/upload (internal). Never
 * throws for an HTTP error: the caller decides what is retryable. A network
 * failure (fetch rejected) DOES throw — the caller classifies it.
 */
export interface UploadAttachmentOutcome {
  status: number;
  data?: UploadAttachmentResponseDto;
  error?: unknown;
}

export async function uploadAttachment(
  body: AttachmentUploadUploadV1Body,
): Promise<UploadAttachmentOutcome> {
  const result = await attachmentUploadUploadV1({
    body,
    requestValidator: undefined,
  });
  return {
    status: result.response?.status ?? 0,
    data: result.data,
    error: result.error,
  };
}

/**
 * Server-side append to an execution result's actual_result, addressed by
 * the variant id alone (internal PATCH /v1/run/run-result-variant/:id). Never
 * a read-modify-write: the server appends.
 */
export async function appendActualResult(
  runResultVariantId: string,
  text: string,
): Promise<void> {
  const result = await runApiUpdateRunResultVariantByIdV1({
    path: { runResultVariantId },
    // `actual_result` must be ABSENT: the server rejects it together with
    // append_actual_result. The generated type marks it required.
    body: {
      append_actual_result: text,
    } as unknown as UpdateRunResultVariantDto,
    requestValidator: undefined,
  });
  if (result.error) {
    throw new Error(
      `Append failed (${String(result.response?.status ?? 'unknown')}): ${
        tryReadMessage(result.error) ?? JSON.stringify(result.error)
      }`,
    );
  }
}

/** A NEW comment on an issue, test or run (append-only; internal --embed). */
export async function createComment(
  target: 'issue' | 'test' | 'run',
  targetId: string,
  body: string,
): Promise<void> {
  const result =
    target === 'issue'
      ? await commentIssueCreateV1({
          body: { issue_id: targetId, body },
          requestValidator: undefined,
        })
      : target === 'test'
        ? await commentTestCreateV1({
            body: { test_id: targetId, body },
            requestValidator: undefined,
          })
        : await commentRunCreateV1({
            body: { run_id: targetId, body },
            requestValidator: undefined,
          });
  if (result.error) {
    throw new Error(
      `Comment failed (${String(result.response?.status ?? 'unknown')}): ${
        tryReadMessage(result.error) ?? JSON.stringify(result.error)
      }`,
    );
  }
}
