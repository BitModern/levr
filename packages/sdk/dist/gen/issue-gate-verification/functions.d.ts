// Generated from the Levr OpenAPI specification. Do not edit.

import type { Options } from '../../runtime/types.js';
import type {
  IssueGateVerificationVerifyGatesV1Data,
  IssueGateVerificationVerifyGatesV1Responses,
  IssueGateVerificationVerifyGatesV1Errors,
  IssueGateVerificationReportGateResultsV1Data,
  IssueGateVerificationReportGateResultsV1Responses,
  IssueGateVerificationReportGateResultsV1Errors,
} from './types.js';

/** POST /v1/issue/{id}/verify-gates */
export declare const issueGateVerificationVerifyGatesV1: <ThrowOnError extends boolean = false>(
  options?: Options<IssueGateVerificationVerifyGatesV1Data, ThrowOnError>,
) => import('../../runtime/types.js').RequestResult<IssueGateVerificationVerifyGatesV1Responses, IssueGateVerificationVerifyGatesV1Errors, ThrowOnError>;

/** POST /v1/issue/{id}/gate-results */
export declare const issueGateVerificationReportGateResultsV1: <ThrowOnError extends boolean = false>(
  options: Options<IssueGateVerificationReportGateResultsV1Data, ThrowOnError>,
) => import('../../runtime/types.js').RequestResult<IssueGateVerificationReportGateResultsV1Responses, IssueGateVerificationReportGateResultsV1Errors, ThrowOnError>;

