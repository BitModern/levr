# @levr-one/sdk

The TypeScript SDK for the Levr API: typed functions, with request and
response types and zod validators, generated from the published OpenAPI spec.
It covers the part of the API listed below, not every endpoint, and grows as
operations are added.

## Install

```bash
npm install @levr-one/sdk
```

The package is **ESM only** and needs Node.js 18 or later. There is no
CommonJS build: from CommonJS code, load it with a dynamic import inside an
async function, `const sdk = await import('@levr-one/sdk')`. The upload
examples below use the global `File`, which Node.js has from version 20; on
Node.js 18, take it from `node:buffer` (`import { File } from 'node:buffer'`).

## What it covers

| Function | Request |
| --- | --- |
| `importCreateV1` | `POST /v1/imports` — import a test report |
| `authGetProfileV1` | `GET /v1/auth/profile` — the signed-in user |
| `authGetSitesV1` | `GET /v1/auth/sites` — the workspaces you belong to |
| `teamFindAllV1` | `GET /v1/team` — list teams |
| `issueFindAllV1` | `GET /v1/issue` — list issues |
| `issueGateVerificationVerifyGatesV1` | `POST /v1/issue/{id}/verify-gates` — run an issue's gates |
| `issueGateVerificationReportGateResultsV1` | `POST /v1/issue/{id}/gate-results` — report gate results |
| `testCaseImportPreviewV1` | `POST /v1/test-case-import/preview` — preview a test case import |
| `testCaseImportCommitV1` | `POST /v1/test-case-import/commit` — commit a test case import |
| `attachmentUploadUploadV1` | `POST /v1/attachment/upload` — attach a file |
| `commentIssueCreateV1` | `POST /v1/comment-issue` — comment on an issue |
| `commentTestCreateV1` | `POST /v1/comment-test` — comment on a test |
| `commentRunCreateV1` | `POST /v1/comment-run` — comment on a run |
| `runApiUpdateRunResultVariantByIdV1` | `PATCH /v1/run/run-result-variant/{runResultVariantId}` — update a run result |

Each function has matching request and response types. `client` and
`createClient` configure where and how requests are sent.

## Authenticate

Create a personal access token in Levr (Settings → Access tokens) and keep it
in `LEVR_TOKEN`. If your account belongs to more than one workspace, also set
`LEVR_WORKSPACE_ID`.

```ts
import { client } from '@levr-one/sdk';

client.setConfig({
  baseUrl: 'https://api.levr.one',
  auth: () => process.env.LEVR_TOKEN ?? '',
  workspaceId: process.env.LEVR_WORKSPACE_ID,
});
```

## Errors

A call resolves with `{ data, error }` and never throws for an HTTP error
status: check `error` (or `response.ok`). `error` is the parsed response body:
the JSON object when the body is JSON, otherwise its text, and `{}` when the
body is empty.

To throw instead, pass `throwOnError: true` on the call. It is a per-call
option; `client.setConfig` does not accept it. What is thrown is that same
parsed body, not an `Error` instance.

```ts
import { teamFindAllV1 } from '@levr-one/sdk';

try {
  const { data } = await teamFindAllV1({ throwOnError: true });
  console.log(data);
} catch (body) {
  console.error('request failed:', body);
}
```

## Attach a file

Attach a screenshot to an issue by its identifier. Send the text fields
before the file.

```ts
import { readFile } from 'node:fs/promises';
import { attachmentUploadUploadV1 } from '@levr-one/sdk';

const bytes = await readFile('screenshot.png');
const { data, error } = await attachmentUploadUploadV1({
  body: {
    related_type: 'issue',
    related_id: 'QA-42', // an issue identifier, or its UUID
    file: new File([bytes], 'screenshot.png', { type: 'image/png' }),
  },
});
if (error) throw new Error(JSON.stringify(error));
console.log(data?.id, data?.target_id);
```

For a CI artifact on an automation result, use
`related_type: 'automation_run_result'` with the result id, plus `kind`
(`screenshot`, `trace`, `video`, …) and, for an earlier attempt,
`attempt_index`. An identical re-upload returns the existing attachment.

## Import a test report

```ts
import { readFile } from 'node:fs/promises';
import { importCreateV1 } from '@levr-one/sdk';

const xml = await readFile('junit.xml');
const { data, error } = await importCreateV1({
  body: {
    file: new File([xml], 'junit.xml', { type: 'application/xml' }),
    automation_source: 'e2e',
    include_results: true,
  },
});
if (error) throw new Error(JSON.stringify(error));
console.log(data?.result?.run_id, data?.result?.results?.length);
```

## Versioning

Each release increments the patch version automatically; minor and major
versions are set by hand. Adding a function is a patch or minor release;
removing or renaming one is a major release. The SDK tracks the Levr API, so
update it alongside the `levr` CLI.

## License

MIT
