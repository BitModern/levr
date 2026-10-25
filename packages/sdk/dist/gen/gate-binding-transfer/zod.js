// Generated from the Levr OpenAPI specification. Do not edit.

import { z } from 'zod/v3';

export const zExportedGateConfigDto = /* @__PURE__ */ z.object({
  description: z.string().optional(),
  definitions: z.array(z.object({
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  technique: z.string(),
  category: z.string().nullable(),
  resolver_template: z.record(z.string(), z.unknown()).nullable(),
})),
  bindings: z.array(z.object({
  gate_key: z.string(),
  repo_key: z.string().optional(),
  path_prefix: z.string().optional(),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()),
})),
});

export const zGateConfigFileDto = /* @__PURE__ */ z.object({
  description: z.string().optional(),
  definitions: z.array(z.record(z.string(), z.unknown())).optional(),
  bindings: z.array(z.record(z.string(), z.unknown())),
});

export const zGateConfigImportResultDto = /* @__PURE__ */ z.object({
  dry_run: z.boolean(),
  definitions: z.array(z.object({
  key: z.string(),
  action: z.enum(["create", "exists", "differs"]),
  stored_id: z.string().optional(),
  applied: z.boolean(),
})),
  bindings: z.array(z.object({
  gate_key: z.string(),
  repo_key: z.string().nullable(),
  path_prefix: z.string().nullable(),
  action: z.enum(["create", "exists", "differs", "update", "delete", "absent"]),
  stored_id: z.string().optional(),
  note: z.string().optional(),
  applied: z.boolean(),
})),
});

export const zGateBindingTransferExportConfigV1Data = /* @__PURE__ */ z.object({
  url: z.literal('/v1/gate/bindings/export'),
});

export const zGateBindingTransferImportConfigV1Data = /* @__PURE__ */ z.object({
  body: zGateConfigFileDto,
  query: z.object({
    'dry_run': z.enum(["true", "false"]).optional(),
  }).optional(),
  url: z.literal('/v1/gate/bindings/import'),
});

