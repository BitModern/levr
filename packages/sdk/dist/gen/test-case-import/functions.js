// Generated from the Levr OpenAPI specification. Do not edit.

import { client as _client } from '../../runtime/index.js';

/** POST /v1/test-case-import/preview */
export const testCaseImportPreviewV1 = (options) => {
  return (options?.client ?? _client).post({
    security: [
      {
        scheme: 'bearer',
        type: 'http',
      },
    ],
    url: '/v1/test-case-import/preview',
    bodySerializer: (body) => {
      const fd = new FormData();
      if (body && typeof body === 'object') {
        for (const [k, v] of Object.entries(body)) {
          if (v == null) continue;
          fd.append(k, v instanceof Blob ? v : String(v));
        }
      }
      return fd;
    },
    ...options,
  });
};

/** POST /v1/test-case-import/commit */
export const testCaseImportCommitV1 = (options) => {
  return (options?.client ?? _client).post({
    security: [
      {
        scheme: 'bearer',
        type: 'http',
      },
    ],
    url: '/v1/test-case-import/commit',
    ...options,
  });
};

