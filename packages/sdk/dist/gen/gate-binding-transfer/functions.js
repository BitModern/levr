// Generated from the Levr OpenAPI specification. Do not edit.

import { client as _client } from '../../runtime/index.js';

/** GET /v1/gate/bindings/export */
export const gateBindingTransferExportConfigV1 = (options) => {
  return (options?.client ?? _client).get({
    security: [
      {
        scheme: 'bearer',
        type: 'http',
      },
    ],
    url: '/v1/gate/bindings/export',
    ...options,
  });
};

/** POST /v1/gate/bindings/import */
export const gateBindingTransferImportConfigV1 = (options) => {
  return (options?.client ?? _client).post({
    security: [
      {
        scheme: 'bearer',
        type: 'http',
      },
    ],
    url: '/v1/gate/bindings/import',
    ...options,
  });
};

