// Generated from the Levr OpenAPI specification. Do not edit.

import { z } from 'zod/v3';

export const zCreateCommentRunDto = /* @__PURE__ */ z.object({
  id: z.string().optional(),
  body: z.string().nullable().optional(),
  key: z.number().optional(),
  source: z.unknown().optional(),
  spoke_key: z.string().nullable().optional(),
  run_id: z.string(),
});

export const zResponseCommentRunDto = /* @__PURE__ */ z.object({
  id: z.string(),
  body: z.string().nullable().optional(),
  key: z.number().optional(),
  source: z.unknown().optional(),
  spoke_key: z.string().nullable().optional(),
  run_id: z.string(),
  created_at: z.unknown(),
  updated_at: z.unknown(),
  epoch: z.number(),
  created_by: z.string(),
  updated_by: z.string(),
  workspace_id: z.string(),
  deleted_at: z.unknown(),
  deleted_by: z.string().nullable(),
});

export const zCommentRunCreateV1Data = /* @__PURE__ */ z.object({
  body: zCreateCommentRunDto,
  url: z.literal('/v1/comment-run'),
});

