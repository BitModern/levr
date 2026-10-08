// Generated from the Levr OpenAPI specification. Do not edit.

import type { Options } from '../../runtime/types.js';
import type {
  ImportCreateV1Data,
  ImportCreateV1Responses,
  ImportCreateV1Errors,
} from './types.js';

/** POST /v1/imports */
export declare const importCreateV1: <ThrowOnError extends boolean = false>(
  options: Options<ImportCreateV1Data, ThrowOnError>,
) => import('../../runtime/types.js').RequestResult<ImportCreateV1Responses, ImportCreateV1Errors, ThrowOnError>;

