// Generated from the Levr OpenAPI specification. Do not edit.

import type { Options } from '../../runtime/types.js';
import type {
  RepositoryRefFindAllV1Data,
  RepositoryRefFindAllV1Responses,
  RepositoryRefFindAllV1Errors,
} from './types.js';

/** GET /v1/repository-ref */
export declare const repositoryRefFindAllV1: <ThrowOnError extends boolean = false>(
  options?: Options<RepositoryRefFindAllV1Data, ThrowOnError>,
) => import('../../runtime/types.js').RequestResult<RepositoryRefFindAllV1Responses, RepositoryRefFindAllV1Errors, ThrowOnError>;

