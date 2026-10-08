// Generated from the Levr OpenAPI specification. Do not edit.
export type AttachmentUploadUploadV1Body = {
  related_type: "test" | "step" | "folder" | "plan" | "defect" | "requirement" | "run_result" | "run_result_step" | "import_job" | "run" | "issue" | "project" | "initiative" | "cycle" | "staged" | "data_set" | "run_result_variant" | "research_step" | "project_update" | "automation_run_result" | "unlinked";
  related_id?: string;
  kind?: "screenshot" | "video" | "trace" | "stdout_log" | "stderr_log" | "har" | "report" | "attachment" | "other";
  attempt_index?: number;
  is_public?: boolean;
  file: Blob;
};

export type UploadAttachmentResponseDto = {
  id: string;
  url: string | null | null;
  private_url: string | null | null;
  original_file_name: string;
  mime_type: string | null | null;
  size: number | null | null;
  is_public: boolean;
  created_at: string;
  related_type: "test" | "step" | "folder" | "plan" | "defect" | "requirement" | "run_result" | "run_result_step" | "import_job" | "run" | "issue" | "project" | "initiative" | "cycle" | "staged" | "data_set" | "run_result_variant" | "research_step" | "project_update" | "automation_run_result" | "unlinked";
  target_id: string | null | null;
  kind: "screenshot" | "video" | "trace" | "stdout_log" | "stderr_log" | "har" | "report" | "attachment" | "other" | null;
  attempt_index: number | null | null;
  deduplicated: boolean;
};

export type AttachmentUploadUploadV1Data = {
  body: AttachmentUploadUploadV1Body;
  path?: never;
  query?: never;
  url: '/v1/attachment/upload';
};

export type AttachmentUploadUploadV1Responses = {
  200: UploadAttachmentResponseDto;
  201: UploadAttachmentResponseDto;
};

export type AttachmentUploadUploadV1Errors = unknown;

