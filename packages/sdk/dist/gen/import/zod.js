// Generated from the Levr OpenAPI specification. Do not edit.

import { z } from 'zod/v3';

export const zImportCreateV1Body = /* @__PURE__ */ z.object({
  file: z.instanceof(Blob).optional(),
  file_id: z.string().optional(),
  team_id: z.string().optional(),
  format: z.enum(["junit", "gherkin", "cucumber-json", "ctrf-json"]).optional(),
  run_name: z.string().max(250).optional(),
  automation_source: z.string().max(100).optional(),
  automation_source_id: z.string().optional(),
  import_metadata: z.string().optional(),
  include_results: z.boolean().optional(),
});

export const zImportResponseDto = /* @__PURE__ */ z.object({
  id: z.string(),
  team_id: z.string(),
  status: z.enum(["processing", "completed", "completed_with_warnings", "failed"]),
  format: z.enum(["junit", "gherkin", "cucumber-json", "ctrf-json"]),
  created_at: z.string(),
  completed_at: z.string(),
  result: z.object({
  run_id: z.string().optional(),
  root_folder_id: z.string(),
  stats: z.object({
  suites_created: z.number(),
  suites_updated: z.number(),
  tests_created: z.number(),
  tests_updated: z.number(),
  results_created: z.number(),
  results_updated: z.number(),
  labels_created: z.number(),
  label_assignments_created: z.number(),
  passed: z.number(),
  failed: z.number(),
  errored: z.number(),
  skipped: z.number(),
  pending: z.number(),
  todo: z.number(),
  flaky: z.number(),
}),
  warnings: z.array(z.object({
  type: z.string(),
  message: z.string(),
  count: z.number(),
  details: z.array(z.string()).optional(),
  truncated: z.boolean().optional(),
})).optional(),
  results: z.array(z.object({
  id: z.string(),
  name: z.string(),
  suite: z.string().nullable(),
  classname: z.string().nullable(),
  status: z.string(),
  test_key: z.string(),
  attempts: z.number(),
  attachments: z.array(z.object({
  path: z.string().nullable(),
  name: z.string().nullable(),
  kind: z.enum(["screenshot", "video", "trace", "stdout_log", "stderr_log", "har", "report", "attachment", "other"]),
  attempt_index: z.number().nullable(),
  stored: z.boolean(),
})),
})).optional(),
}).optional(),
  error: z.object({
  code: z.string(),
  message: z.string(),
  details: z.object({
  line: z.number().optional(),
  column: z.number().optional(),
  element: z.string().optional(),
}).optional(),
}).optional(),
  automation_source_id: z.string().optional(),
  automation_source_name: z.string().optional(),
});

export const zImportCreateV1Data = /* @__PURE__ */ z.object({
  body: zImportCreateV1Body,
  url: z.literal('/v1/imports'),
});

