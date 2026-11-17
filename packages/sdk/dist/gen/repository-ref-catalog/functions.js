// Generated from the Levr OpenAPI specification. Do not edit.

import { client as _client } from '../../runtime/index.js';

/** GET /v1/repository-catalog/resolve */
export const repositoryRefCatalogResolveByRemoteV1 = (options) => {
  return (options?.client ?? _client).get({
    security: [
      {
        scheme: 'bearer',
        type: 'http',
      },
    ],
    url: '/v1/repository-catalog/resolve',
    ...options,
  });
};

/** POST /v1/repository-catalog */
export const repositoryRefCatalogCreateV1 = (options) => {
  return (options?.client ?? _client).post({
    security: [
      {
        scheme: 'bearer',
        type: 'http',
      },
    ],
    url: '/v1/repository-catalog',
    ...options,
  });
};

