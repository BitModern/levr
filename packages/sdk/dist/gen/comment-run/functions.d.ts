// Generated from the Levr OpenAPI specification. Do not edit.

import type { Options } from '../../runtime/types.js';
import type {
  CommentRunCreateV1Data,
  CommentRunCreateV1Responses,
  CommentRunCreateV1Errors,
} from './types.js';

/** POST /v1/comment-run */
export declare const commentRunCreateV1: <ThrowOnError extends boolean = false>(
  options: Options<CommentRunCreateV1Data, ThrowOnError>,
) => import('../../runtime/types.js').RequestResult<CommentRunCreateV1Responses, CommentRunCreateV1Errors, ThrowOnError>;

