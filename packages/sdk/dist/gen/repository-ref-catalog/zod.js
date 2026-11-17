// Generated from the Levr OpenAPI specification. Do not edit.

import { z } from 'zod/v3';

export const zResolveByRemoteResultDto = /* @__PURE__ */ z.object({
  repository: z.object({
  repository_ref_id: z.string().nullable(),
  github_repository_id: z.string().nullable(),
  provider: z.enum(["github", "gitlab", "bitbucket", "other"]),
  host: z.string().nullable(),
  name: z.string(),
  repo_key: z.string(),
}).nullable(),
});

export const zCreateRepositoryRefDto = /* @__PURE__ */ z.object({
  remote: z.string().max(2048),
  provider: z.enum(["github", "gitlab", "bitbucket", "other"]).optional(),
  github_repository_id: z.string().optional(),
});

export const zCreatedRepositoryRefDto = /* @__PURE__ */ z.object({
  id: z.string(),
  workspace_id: z.string(),
  provider: z.enum(["github", "gitlab", "bitbucket", "other"]),
  host: z.string().nullable(),
  name: z.string(),
  remote_urls: z.array(z.string()),
  github_repository_id: z.string().nullable(),
  repo_key: z.string(),
});

export const zRepositoryRefCatalogResolveByRemoteV1Data = /* @__PURE__ */ z.object({
  query: z.object({
    'remote': z.string().max(2048),
  }).optional(),
  url: z.literal('/v1/repository-catalog/resolve'),
});

export const zRepositoryRefCatalogCreateV1Data = /* @__PURE__ */ z.object({
  body: zCreateRepositoryRefDto,
  url: z.literal('/v1/repository-catalog'),
});

