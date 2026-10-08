// Generated from the Levr OpenAPI specification. Do not edit.

import type { Options } from '../../runtime/types.js';
import type {
  RunApiUpdateRunResultVariantByIdV1Data,
  RunApiUpdateRunResultVariantByIdV1Responses,
  RunApiUpdateRunResultVariantByIdV1Errors,
} from './types.js';

/** PATCH /v1/run/run-result-variant/{runResultVariantId} */
export declare const runApiUpdateRunResultVariantByIdV1: <ThrowOnError extends boolean = false>(
  options: Options<RunApiUpdateRunResultVariantByIdV1Data, ThrowOnError>,
) => import('../../runtime/types.js').RequestResult<RunApiUpdateRunResultVariantByIdV1Responses, RunApiUpdateRunResultVariantByIdV1Errors, ThrowOnError>;

