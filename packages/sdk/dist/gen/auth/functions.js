// Generated from the Levr OpenAPI specification. Do not edit.

import { client as _client } from '../../runtime/index.js';

/** GET /v1/auth/profile */
export const authGetProfileV1 = (options) => {
  return (options?.client ?? _client).get({
    security: [
      {
        scheme: 'bearer',
        type: 'http',
      },
    ],
    url: '/v1/auth/profile',
    ...options,
  });
};

/** GET /v1/auth/sites */
export const authGetSitesV1 = (options) => {
  return (options?.client ?? _client).get({
    security: [
      {
        scheme: 'bearer',
        type: 'http',
      },
    ],
    url: '/v1/auth/sites',
    ...options,
  });
};

