// Generated from the Levr OpenAPI specification. Do not edit.

import type { Options } from '../../runtime/types.js';
import type {
  AuthGetProfileV1Data,
  AuthGetProfileV1Responses,
  AuthGetProfileV1Errors,
  AuthGetSitesV1Data,
  AuthGetSitesV1Responses,
  AuthGetSitesV1Errors,
} from './types.js';

/** GET /v1/auth/profile */
export declare const authGetProfileV1: <ThrowOnError extends boolean = false>(
  options?: Options<AuthGetProfileV1Data, ThrowOnError>,
) => import('../../runtime/types.js').RequestResult<AuthGetProfileV1Responses, AuthGetProfileV1Errors, ThrowOnError>;

/** GET /v1/auth/sites */
export declare const authGetSitesV1: <ThrowOnError extends boolean = false>(
  options?: Options<AuthGetSitesV1Data, ThrowOnError>,
) => import('../../runtime/types.js').RequestResult<AuthGetSitesV1Responses, AuthGetSitesV1Errors, ThrowOnError>;

