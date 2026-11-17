// Generated from the Levr OpenAPI specification. Do not edit.

import type { Options } from '../../runtime/types.js';
import type {
  RepositoryRefCatalogResolveByRemoteV1Data,
  RepositoryRefCatalogResolveByRemoteV1Responses,
  RepositoryRefCatalogResolveByRemoteV1Errors,
  RepositoryRefCatalogCreateV1Data,
  RepositoryRefCatalogCreateV1Responses,
  RepositoryRefCatalogCreateV1Errors,
} from './types.js';

/** GET /v1/repository-catalog/resolve */
export declare const repositoryRefCatalogResolveByRemoteV1: <ThrowOnError extends boolean = false>(
  options?: Options<RepositoryRefCatalogResolveByRemoteV1Data, ThrowOnError>,
) => import('../../runtime/types.js').RequestResult<RepositoryRefCatalogResolveByRemoteV1Responses, RepositoryRefCatalogResolveByRemoteV1Errors, ThrowOnError>;

/** POST /v1/repository-catalog */
export declare const repositoryRefCatalogCreateV1: <ThrowOnError extends boolean = false>(
  options: Options<RepositoryRefCatalogCreateV1Data, ThrowOnError>,
) => import('../../runtime/types.js').RequestResult<RepositoryRefCatalogCreateV1Responses, RepositoryRefCatalogCreateV1Errors, ThrowOnError>;

