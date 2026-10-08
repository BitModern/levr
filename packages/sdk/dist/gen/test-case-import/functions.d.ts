// Generated from the Levr OpenAPI specification. Do not edit.

import type { Options } from '../../runtime/types.js';
import type {
  TestCaseImportPreviewV1Data,
  TestCaseImportPreviewV1Responses,
  TestCaseImportPreviewV1Errors,
  TestCaseImportCommitV1Data,
  TestCaseImportCommitV1Responses,
  TestCaseImportCommitV1Errors,
} from './types.js';

/** POST /v1/test-case-import/preview */
export declare const testCaseImportPreviewV1: <ThrowOnError extends boolean = false>(
  options: Options<TestCaseImportPreviewV1Data, ThrowOnError>,
) => import('../../runtime/types.js').RequestResult<TestCaseImportPreviewV1Responses, TestCaseImportPreviewV1Errors, ThrowOnError>;

/** POST /v1/test-case-import/commit */
export declare const testCaseImportCommitV1: <ThrowOnError extends boolean = false>(
  options: Options<TestCaseImportCommitV1Data, ThrowOnError>,
) => import('../../runtime/types.js').RequestResult<TestCaseImportCommitV1Responses, TestCaseImportCommitV1Errors, ThrowOnError>;

