// Generated from the Levr OpenAPI specification. Do not edit.

import { client as _client } from '../../runtime/index.js';

/** POST /v1/issue/{id}/verify-gates */
export const issueGateVerificationVerifyGatesV1 = (options) => {
  return (options?.client ?? _client).post({
    security: [
      {
        scheme: 'bearer',
        type: 'http',
      },
    ],
    url: '/v1/issue/{id}/verify-gates',
    ...options,
  });
};

/** POST /v1/issue/{id}/gate-results */
export const issueGateVerificationReportGateResultsV1 = (options) => {
  return (options?.client ?? _client).post({
    security: [
      {
        scheme: 'bearer',
        type: 'http',
      },
    ],
    url: '/v1/issue/{id}/gate-results',
    ...options,
  });
};

