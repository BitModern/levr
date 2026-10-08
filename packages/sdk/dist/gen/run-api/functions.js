// Generated from the Levr OpenAPI specification. Do not edit.

import { client as _client } from '../../runtime/index.js';

/** PATCH /v1/run/run-result-variant/{runResultVariantId} */
export const runApiUpdateRunResultVariantByIdV1 = (options) => {
  return (options?.client ?? _client).patch({
    security: [
      {
        scheme: 'bearer',
        type: 'http',
      },
    ],
    url: '/v1/run/run-result-variant/{runResultVariantId}',
    ...options,
  });
};

