// Generated from the Levr OpenAPI specification. Do not edit.
export type ImportCreateV1Body = {
  file?: Blob;
  file_id?: string;
  team_id?: string;
  format?: "junit" | "gherkin" | "cucumber-json" | "ctrf-json";
  run_name?: string;
  automation_source?: string;
  automation_source_id?: string;
  import_metadata?: string;
  include_results?: boolean;
};

export type ImportResponseDto = {
  id: string;
  team_id: string;
  status: "processing" | "completed" | "completed_with_warnings" | "failed";
  format: "junit" | "gherkin" | "cucumber-json" | "ctrf-json";
  created_at: string;
  completed_at: string;
  result?: {
  run_id?: string;
  root_folder_id: string;
  stats: {
  suites_created: number;
  suites_updated: number;
  tests_created: number;
  tests_updated: number;
  results_created: number;
  results_updated: number;
  labels_created: number;
  label_assignments_created: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  pending: number;
  todo: number;
  flaky: number;
};
  warnings?: Array<{
  type: string;
  message: string;
  count: number;
  details?: Array<string>;
  truncated?: boolean;
}>;
  results?: Array<{
  id: string;
  name: string;
  suite: string | null | null;
  classname: string | null | null;
  status: string;
  test_key: string;
  attempts: number;
  attachments: Array<{
  path: string | null | null;
  name: string | null | null;
  kind: "screenshot" | "video" | "trace" | "stdout_log" | "stderr_log" | "har" | "report" | "attachment" | "other";
  attempt_index: number | null | null;
  stored: boolean;
}>;
}>;
};
  error?: {
  code: string;
  message: string;
  details?: {
  line?: number;
  column?: number;
  element?: string;
};
};
  automation_source_id?: string;
  automation_source_name?: string;
};

export type ImportCreateV1Data = {
  body: ImportCreateV1Body;
  path?: never;
  query?: never;
  url: '/v1/imports';
};

export type ImportCreateV1Responses = {
  200: ImportResponseDto;
};

export type ImportCreateV1Errors = unknown;

