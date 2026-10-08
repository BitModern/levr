// Generated from the Levr OpenAPI specification. Do not edit.

import type { Options } from '../../runtime/types.js';
import type {
  TeamFindAllV1Data,
  TeamFindAllV1Responses,
  TeamFindAllV1Errors,
} from './types.js';

/** GET /v1/team */
export declare const teamFindAllV1: <ThrowOnError extends boolean = false>(
  options?: Options<TeamFindAllV1Data, ThrowOnError>,
) => import('../../runtime/types.js').RequestResult<TeamFindAllV1Responses, TeamFindAllV1Errors, ThrowOnError>;

