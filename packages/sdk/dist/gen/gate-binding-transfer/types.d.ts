// Generated from the Levr OpenAPI specification. Do not edit.
export type ExportedGateConfigDto = {
  description?: string;
  definitions: Array<{
  key: string;
  name: string;
  description: string | null | null;
  technique: string;
  category: string | null | null;
  resolver_template: Record<string, unknown> | null;
}>;
  bindings: Array<{
  gate_key: string;
  repo_key?: string;
  path_prefix?: string;
  enabled: boolean;
  config: Record<string, unknown>;
}>;
};

export type GateConfigFileDto = {
  description?: string;
  definitions?: Array<Record<string, unknown>>;
  bindings: Array<Record<string, unknown>>;
};

export type GateConfigImportResultDto = {
  dry_run: boolean;
  definitions: Array<{
  key: string;
  action: "create" | "exists" | "differs";
  stored_id?: string;
  applied: boolean;
}>;
  bindings: Array<{
  gate_key: string;
  repo_key: string | null | null;
  path_prefix: string | null | null;
  action: "create" | "exists" | "differs" | "update" | "delete" | "absent";
  stored_id?: string;
  note?: string;
  applied: boolean;
}>;
};

export type GateBindingTransferExportConfigV1Data = {
  body?: never;
  path?: never;
  query?: never;
  url: '/v1/gate/bindings/export';
};

export type GateBindingTransferExportConfigV1Responses = {
  200: ExportedGateConfigDto;
};

export type GateBindingTransferExportConfigV1Errors = unknown;

export type GateBindingTransferImportConfigV1Data = {
  body: GateConfigFileDto;
  path?: never;
  query?: {
    dry_run?: "true" | "false";
  };
  url: '/v1/gate/bindings/import';
};

export type GateBindingTransferImportConfigV1Responses = {
  200: GateConfigImportResultDto;
};

export type GateBindingTransferImportConfigV1Errors = unknown;

