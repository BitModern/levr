// Generated from the Levr OpenAPI specification. Do not edit.
export type PreviewImportDto = {
  team_id: string;
  format?: "csv" | "xlsx" | "sheets" | "json";
  file_id?: string;
  sheets_url?: string;
};

export type PreviewImportResponseDto = {
  token: string;
  filename: string;
  format: "csv" | "xlsx" | "sheets" | "json";
  proposed_mapping: Array<{
  originalName: string;
  targetProperty: "row_type" | "test_id" | "test_key" | "folder_id" | "folder_path" | "folder_name" | "test_name" | "test_description" | "automation_status" | "automation_type" | "case_type_id" | "case_type_name" | "test_priority" | "estimate" | "assignee_email" | "labels" | "teams" | "attachment_filenames" | "data_set_names" | "sequence" | "item_id" | "method" | "expected_result" | "keyword" | "shared_step_id" | "shared_precondition_id" | "data_table" | "steps" | "preconditions" | null;
  matchType: "exact" | "prefix" | "fuzzy" | "llm" | "unmapped" | "manual" | "preset";
  confidence: number;
  fieldType?: "string" | "number" | "boolean" | "unknown";
  labelPrefix?: string;
  descriptionHeading?: string;
  teamQualifier?: string;
  team_id?: string;
}>;
  missing_required: Array<string>;
  sample_rows: Array<Record<string, unknown>>;
  row_count: number;
  expires_at: unknown;
  advisories: Array<{
  column: string;
  target: "row_type" | "test_id" | "test_key" | "folder_id" | "folder_path" | "folder_name" | "test_name" | "test_description" | "automation_status" | "automation_type" | "case_type_id" | "case_type_name" | "test_priority" | "estimate" | "assignee_email" | "labels" | "teams" | "attachment_filenames" | "data_set_names" | "sequence" | "item_id" | "method" | "expected_result" | "keyword" | "shared_step_id" | "shared_precondition_id" | "data_table" | "steps" | "preconditions";
  message: string;
  count: number;
  values: Array<{
  value: string;
  count: number;
}>;
}>;
  detected_vendor: string | null | null;
  assignee_resolution: {
  column: string;
  entries: Array<{
  sourceValue: string;
  count: number;
  kind: "existing" | "new_email" | "unresolved";
  userId?: string;
  userName?: string;
  suggestedEmail?: string;
}>;
} | null;
};

export type CommitImportDto = {
  token: string;
  confirmed_mapping?: Array<{
  originalName: string;
  targetProperty: "row_type" | "test_id" | "test_key" | "folder_id" | "folder_path" | "folder_name" | "test_name" | "test_description" | "automation_status" | "automation_type" | "case_type_id" | "case_type_name" | "test_priority" | "estimate" | "assignee_email" | "labels" | "teams" | "attachment_filenames" | "data_set_names" | "sequence" | "item_id" | "method" | "expected_result" | "keyword" | "shared_step_id" | "shared_precondition_id" | "data_table" | "steps" | "preconditions" | null;
  matchType: "exact" | "prefix" | "fuzzy" | "llm" | "unmapped" | "manual" | "preset";
  confidence: number;
  fieldType?: "string" | "number" | "boolean" | "unknown";
  labelPrefix?: string;
  descriptionHeading?: string;
  teamQualifier?: string;
  team_id?: string;
}>;
  assignee_plan?: {
  role?: "owner" | "admin" | "member" | "guest";
  teamIds?: Array<string>;
  entries: Array<{
  sourceValue: string;
  action: "assign" | "create" | "skip";
  userId?: string;
  email?: string;
}>;
};
  team_ids?: Array<string>;
};

export type TestCaseImportResultDto = {
  status: "completed" | "completed_with_warnings" | "failed";
  created_tests: Array<{
  id: string;
  name: string;
}>;
  stats: {
  rows_processed: number;
  tests_created: number;
  folders_created: number;
  steps_created: number;
  preconditions_created: number;
  rows_failed: number;
  members_provisioned?: number;
};
  warnings: Array<{
  type: "skipped" | "invalid" | "unresolved" | "write_failed";
  message: string;
  row_index?: number;
  column?: string;
  count?: number;
  values?: Array<{
  value: string;
  count: number;
}>;
}>;
  errors: Array<{
  type: "skipped" | "invalid" | "unresolved" | "write_failed";
  message: string;
  row_index?: number;
  column?: string;
  count?: number;
  values?: Array<{
  value: string;
  count: number;
}>;
}>;
};

export type TestCaseImportPreviewV1Data = {
  body: PreviewImportDto;
  path?: never;
  query?: never;
  url: '/v1/test-case-import/preview';
};

export type TestCaseImportPreviewV1Responses = {
  200: PreviewImportResponseDto;
};

export type TestCaseImportPreviewV1Errors = unknown;

export type TestCaseImportCommitV1Data = {
  body: CommitImportDto;
  path?: never;
  query?: never;
  url: '/v1/test-case-import/commit';
};

export type TestCaseImportCommitV1Responses = {
  200: TestCaseImportResultDto;
};

export type TestCaseImportCommitV1Errors = unknown;

