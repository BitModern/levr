// Generated from the Levr OpenAPI specification. Do not edit.

import type { Options } from '../../runtime/types.js';
import type {
  CommentIssueCreateV1Data,
  CommentIssueCreateV1Responses,
  CommentIssueCreateV1Errors,
} from './types.js';

/** POST /v1/comment-issue */
export declare const commentIssueCreateV1: <ThrowOnError extends boolean = false>(
  options: Options<CommentIssueCreateV1Data, ThrowOnError>,
) => import('../../runtime/types.js').RequestResult<CommentIssueCreateV1Responses, CommentIssueCreateV1Errors, ThrowOnError>;

