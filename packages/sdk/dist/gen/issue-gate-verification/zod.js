// Generated from the Levr OpenAPI specification. Do not edit.

import { z } from 'zod/v3';

export const zIssueGateVerificationReportGateResultsV1Body = /* @__PURE__ */ z.object({
  results: z.array(z.object({
  gate_type: z.string(),
  link_id: z.string(),
  status: z.enum(["pass", "fail", "error"]),
  output: z.string(),
  expected: z.string().optional(),
  step_id: z.string().optional(),
  rule_hash: z.string().optional(),
  steps: z.array(z.object({
  command: z.string(),
  exit_code: z.number(),
  stdout_tail: z.string(),
  stderr_tail: z.string(),
  step_id: z.string().optional(),
})).optional(),
})),
});

export const zIssueGateVerificationVerifyGatesV1Data = /* @__PURE__ */ z.object({
  path: z.object({
    'id': z.string(),
  }),
  url: z.literal('/v1/issue/{id}/verify-gates'),
});

export const zIssueGateVerificationReportGateResultsV1Data = /* @__PURE__ */ z.object({
  body: zIssueGateVerificationReportGateResultsV1Body,
  path: z.object({
    'id': z.string(),
  }),
  url: z.literal('/v1/issue/{id}/gate-results'),
});

