// Generated from the Levr OpenAPI specification. Do not edit.

import { client as _client } from '../../runtime/index.js';

/** GET /v1/issue */
export const issueFindAllV1 = (options) => {
  return (options?.client ?? _client).get({
    security: [
      {
        scheme: 'bearer',
        type: 'http',
      },
    ],
    url: '/v1/issue',
    ...options,
  });
};

