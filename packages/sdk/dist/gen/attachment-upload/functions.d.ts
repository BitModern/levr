// Generated from the Levr OpenAPI specification. Do not edit.

import type { Options } from '../../runtime/types.js';
import type {
  AttachmentUploadUploadV1Data,
  AttachmentUploadUploadV1Responses,
  AttachmentUploadUploadV1Errors,
} from './types.js';

/** POST /v1/attachment/upload */
export declare const attachmentUploadUploadV1: <ThrowOnError extends boolean = false>(
  options: Options<AttachmentUploadUploadV1Data, ThrowOnError>,
) => import('../../runtime/types.js').RequestResult<AttachmentUploadUploadV1Responses, AttachmentUploadUploadV1Errors, ThrowOnError>;

