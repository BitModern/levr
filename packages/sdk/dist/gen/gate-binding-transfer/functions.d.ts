// Generated from the Levr OpenAPI specification. Do not edit.

import type { Options } from '../../runtime/types.js';
import type {
  GateBindingTransferExportConfigV1Data,
  GateBindingTransferExportConfigV1Responses,
  GateBindingTransferExportConfigV1Errors,
  GateBindingTransferImportConfigV1Data,
  GateBindingTransferImportConfigV1Responses,
  GateBindingTransferImportConfigV1Errors,
} from './types.js';

/** GET /v1/gate/bindings/export */
export declare const gateBindingTransferExportConfigV1: <ThrowOnError extends boolean = false>(
  options?: Options<GateBindingTransferExportConfigV1Data, ThrowOnError>,
) => import('../../runtime/types.js').RequestResult<GateBindingTransferExportConfigV1Responses, GateBindingTransferExportConfigV1Errors, ThrowOnError>;

/** POST /v1/gate/bindings/import */
export declare const gateBindingTransferImportConfigV1: <ThrowOnError extends boolean = false>(
  options: Options<GateBindingTransferImportConfigV1Data, ThrowOnError>,
) => import('../../runtime/types.js').RequestResult<GateBindingTransferImportConfigV1Responses, GateBindingTransferImportConfigV1Errors, ThrowOnError>;

