// Generated from the Levr OpenAPI specification. Do not edit.

import { z } from 'zod/v3';

export const zPreviewImportDto = /* @__PURE__ */ z.object({
  team_id: z.string(),
  format: z.enum(["csv", "xlsx", "sheets", "json"]).optional(),
  file_id: z.string().optional(),
  sheets_url: z.string().optional(),
});

export const zPreviewImportResponseDto = /* @__PURE__ */ z.object({
  token: z.string(),
  filename: z.string(),
  format: z.enum(["csv", "xlsx", "sheets", "json"]),
  proposed_mapping: z.array(z.object({
  originalName: z.string(),
  targetProperty: z.enum(["row_type", "test_id", "test_key", "folder_id", "folder_path", "folder_name", "test_name", "test_description", "automation_status", "automation_type", "case_type_id", "case_type_name", "test_priority", "estimate", "assignee_email", "labels", "teams", "attachment_filenames", "data_set_names", "sequence", "item_id", "method", "expected_result", "keyword", "shared_step_id", "shared_precondition_id", "data_table", "steps", "preconditions"]).nullable(),
  matchType: z.enum(["exact", "prefix", "fuzzy", "llm", "unmapped", "manual", "preset"]),
  confidence: z.number(),
  fieldType: z.enum(["string", "number", "boolean", "unknown"]).optional(),
  labelPrefix: z.string().max(60).optional(),
  descriptionHeading: z.string().max(80).optional(),
  teamQualifier: z.string().max(80).optional(),
  team_id: z.string().optional(),
})),
  missing_required: z.array(z.string()),
  sample_rows: z.array(z.record(z.string(), z.unknown())),
  row_count: z.number(),
  expires_at: z.unknown(),
  advisories: z.array(z.object({
  column: z.string(),
  target: z.enum(["row_type", "test_id", "test_key", "folder_id", "folder_path", "folder_name", "test_name", "test_description", "automation_status", "automation_type", "case_type_id", "case_type_name", "test_priority", "estimate", "assignee_email", "labels", "teams", "attachment_filenames", "data_set_names", "sequence", "item_id", "method", "expected_result", "keyword", "shared_step_id", "shared_precondition_id", "data_table", "steps", "preconditions"]),
  message: z.string(),
  count: z.number(),
  values: z.array(z.object({
  value: z.string(),
  count: z.number(),
})),
})),
  detected_vendor: z.string().nullable(),
  assignee_resolution: z.object({
  column: z.string(),
  entries: z.array(z.object({
  sourceValue: z.string(),
  count: z.number(),
  kind: z.enum(["existing", "new_email", "unresolved"]),
  userId: z.string().optional(),
  userName: z.string().optional(),
  suggestedEmail: z.string().optional(),
})),
}).nullable(),
});

export const zCommitImportDto = /* @__PURE__ */ z.object({
  token: z.string(),
  confirmed_mapping: z.array(z.object({
  originalName: z.string(),
  targetProperty: z.enum(["row_type", "test_id", "test_key", "folder_id", "folder_path", "folder_name", "test_name", "test_description", "automation_status", "automation_type", "case_type_id", "case_type_name", "test_priority", "estimate", "assignee_email", "labels", "teams", "attachment_filenames", "data_set_names", "sequence", "item_id", "method", "expected_result", "keyword", "shared_step_id", "shared_precondition_id", "data_table", "steps", "preconditions"]).nullable(),
  matchType: z.enum(["exact", "prefix", "fuzzy", "llm", "unmapped", "manual", "preset"]),
  confidence: z.number(),
  fieldType: z.enum(["string", "number", "boolean", "unknown"]).optional(),
  labelPrefix: z.string().max(60).optional(),
  descriptionHeading: z.string().max(80).optional(),
  teamQualifier: z.string().max(80).optional(),
  team_id: z.string().optional(),
})).optional(),
  assignee_plan: z.object({
  role: z.enum(["owner", "admin", "member", "guest"]).optional(),
  teamIds: z.array(z.string()).optional(),
  entries: z.array(z.object({
  sourceValue: z.string(),
  action: z.enum(["assign", "create", "skip"]),
  userId: z.string().optional(),
  email: z.string().optional(),
})),
}).optional(),
  team_ids: z.array(z.string()).optional(),
});

export const zTestCaseImportResultDto = /* @__PURE__ */ z.object({
  status: z.enum(["completed", "completed_with_warnings", "failed"]),
  created_tests: z.array(z.object({
  id: z.string(),
  name: z.string(),
})),
  stats: z.object({
  rows_processed: z.number(),
  tests_created: z.number(),
  folders_created: z.number(),
  steps_created: z.number(),
  preconditions_created: z.number(),
  rows_failed: z.number(),
  members_provisioned: z.number().optional(),
}),
  warnings: z.array(z.object({
  type: z.enum(["skipped", "invalid", "unresolved", "write_failed"]),
  message: z.string(),
  row_index: z.number().optional(),
  column: z.string().optional(),
  count: z.number().optional(),
  values: z.array(z.object({
  value: z.string(),
  count: z.number(),
})).optional(),
})),
  errors: z.array(z.object({
  type: z.enum(["skipped", "invalid", "unresolved", "write_failed"]),
  message: z.string(),
  row_index: z.number().optional(),
  column: z.string().optional(),
  count: z.number().optional(),
  values: z.array(z.object({
  value: z.string(),
  count: z.number(),
})).optional(),
})),
});

export const zTestCaseImportPreviewV1Data = /* @__PURE__ */ z.object({
  body: zPreviewImportDto,
  url: z.literal('/v1/test-case-import/preview'),
});

export const zTestCaseImportCommitV1Data = /* @__PURE__ */ z.object({
  body: zCommitImportDto,
  url: z.literal('/v1/test-case-import/commit'),
});

