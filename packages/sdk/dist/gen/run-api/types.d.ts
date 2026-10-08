// Generated from the Levr OpenAPI specification. Do not edit.
export {};

interface DataSetRowSnapshot {
    id: string;
    input: Record<string, unknown>;
    expected_output?: Record<string, unknown> | null;
    context?: Record<string, unknown> | null;
}
interface EnvironmentSnapshot {
    id: string;
    name: string;
    key: number;
    description?: string | null;
    location?: string | null;
    resources?: Record<string, string> | null;
}
interface ExecutionSource {
    type?: string;
    name?: string;
    url?: string;
    version?: string;
    [key: string]: unknown;
}
interface RunResultData {
    steps?: Array<{
        status_id?: string;
        status_name?: string;
        elapsed_time?: number;
        result?: string;
    }>;
}

export type UpdateRunResultVariantDto = {
  status_id?: string;
  actual_result: string | null | null;
  append_actual_result?: string;
  started_at: unknown | null;
  ended_at: unknown | null;
  duration_ms: number | null | null;
};

export type RunResultVariantNodeDto = {
  type: "run_result_variant";
  id: string;
  run_id: string;
  run_result_id: string;
  status_id: string;
  environment_id: string | null | null;
  data_set_row_id: string | null | null;
  sequence: string;
  actual_result: string | null | null;
  started_at: unknown | null;
  ended_at: unknown | null;
  duration_ms: number | null | null;
  environment_snapshot: EnvironmentSnapshot | null;
  data_set_row_snapshot: DataSetRowSnapshot | null;
  data: RunResultData | null;
  source: ExecutionSource | null;
  created_at: unknown;
  updated_at: unknown;
  created_by: string;
  updated_by: string;
  epoch: number;
  status?: {
  id: string;
  name: string;
  key: number;
  color: string | null | null;
};
  environment?: {
  id: string;
  name: string;
  key: number;
  description: string | null | null;
};
};

export type RunApiUpdateRunResultVariantByIdV1Data = {
  body: UpdateRunResultVariantDto;
  path: {
    runResultVariantId: string;
  };
  query?: never;
  url: '/v1/run/run-result-variant/{runResultVariantId}';
};

export type RunApiUpdateRunResultVariantByIdV1Responses = {
  200: RunResultVariantNodeDto;
};

export type RunApiUpdateRunResultVariantByIdV1Errors = unknown;

