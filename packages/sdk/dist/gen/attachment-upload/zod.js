// Generated from the Levr OpenAPI specification. Do not edit.

import { z } from 'zod/v3';

export const zAttachmentUploadUploadV1Body = /* @__PURE__ */ z.object({
  related_type: z.enum(["test", "step", "folder", "plan", "defect", "requirement", "run_result", "run_result_step", "import_job", "run", "issue", "project", "initiative", "cycle", "staged", "data_set", "run_result_variant", "research_step", "project_update", "automation_run_result", "unlinked"]),
  related_id: z.string().optional(),
  kind: z.enum(["screenshot", "video", "trace", "stdout_log", "stderr_log", "har", "report", "attachment", "other"]).optional(),
  attempt_index: z.number().optional(),
  is_public: z.boolean().optional(),
  file: z.instanceof(Blob),
});

export const zUploadAttachmentResponseDto = /* @__PURE__ */ z.object({
  id: z.string(),
  url: z.string().nullable(),
  private_url: z.string().nullable(),
  original_file_name: z.string(),
  mime_type: z.string().nullable(),
  size: z.number().nullable(),
  is_public: z.boolean(),
  created_at: z.string(),
  related_type: z.enum(["test", "step", "folder", "plan", "defect", "requirement", "run_result", "run_result_step", "import_job", "run", "issue", "project", "initiative", "cycle", "staged", "data_set", "run_result_variant", "research_step", "project_update", "automation_run_result", "unlinked"]),
  target_id: z.string().nullable(),
  kind: z.enum(["screenshot", "video", "trace", "stdout_log", "stderr_log", "har", "report", "attachment", "other"]).nullable(),
  attempt_index: z.number().nullable(),
  deduplicated: z.boolean(),
});

export const zAttachmentUploadUploadV1Data = /* @__PURE__ */ z.object({
  body: zAttachmentUploadUploadV1Body,
  url: z.literal('/v1/attachment/upload'),
});

