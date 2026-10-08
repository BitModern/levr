// Generated from the Levr OpenAPI specification. Do not edit.

import { z } from 'zod/v3';

export const zUpdateRunResultVariantDto = /* @__PURE__ */ z.object({
  status_id: z.string().optional(),
  actual_result: z.string().nullable(),
  append_actual_result: z.string().optional(),
  started_at: z.unknown(),
  ended_at: z.unknown(),
  duration_ms: z.number().nullable(),
});

export const zRunResultVariantNodeDto = /* @__PURE__ */ z.object({
  type: z.enum(["run_result_variant"]),
  id: z.string(),
  run_id: z.string(),
  run_result_id: z.string(),
  status_id: z.string(),
  environment_id: z.string().nullable(),
  data_set_row_id: z.string().nullable(),
  sequence: z.string(),
  actual_result: z.string().nullable(),
  started_at: z.unknown(),
  ended_at: z.unknown(),
  duration_ms: z.number().nullable(),
  environment_snapshot: z.record(z.string(), z.unknown()).nullable(),
  data_set_row_snapshot: z.record(z.string(), z.unknown()).nullable(),
  data: z.record(z.string(), z.unknown()).nullable(),
  source: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.unknown(),
  updated_at: z.unknown(),
  created_by: z.string(),
  updated_by: z.string(),
  epoch: z.number(),
  status: z.object({
  id: z.string(),
  name: z.string(),
  key: z.number(),
  color: z.string().nullable(),
}).optional(),
  environment: z.object({
  id: z.string(),
  name: z.string(),
  key: z.number(),
  description: z.string().nullable(),
}).optional(),
});

export const zRunApiUpdateRunResultVariantByIdV1Data = /* @__PURE__ */ z.object({
  body: zUpdateRunResultVariantDto,
  path: z.object({
    'runResultVariantId': z.string(),
  }),
  url: z.literal('/v1/run/run-result-variant/{runResultVariantId}'),
});

