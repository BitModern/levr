// Generated from the Levr OpenAPI specification. Do not edit.

import type { Options } from '../../runtime/types.js';
import type {
  CommentTestCreateV1Data,
  CommentTestCreateV1Responses,
  CommentTestCreateV1Errors,
} from './types.js';

/** POST /v1/comment-test */
export declare const commentTestCreateV1: <ThrowOnError extends boolean = false>(
  options: Options<CommentTestCreateV1Data, ThrowOnError>,
) => import('../../runtime/types.js').RequestResult<CommentTestCreateV1Responses, CommentTestCreateV1Errors, ThrowOnError>;

