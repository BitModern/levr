// Generated from the Levr OpenAPI specification. Do not edit.

import type { Options } from '../../runtime/types.js';
import type {
  IssueFindAllV1Data,
  IssueFindAllV1Responses,
  IssueFindAllV1Errors,
} from './types.js';

/** GET /v1/issue */
export declare const issueFindAllV1: <ThrowOnError extends boolean = false>(
  options?: Options<IssueFindAllV1Data, ThrowOnError>,
) => import('../../runtime/types.js').RequestResult<IssueFindAllV1Responses, IssueFindAllV1Errors, ThrowOnError>;

