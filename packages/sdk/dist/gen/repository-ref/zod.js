// Generated from the Levr OpenAPI specification. Do not edit.

import { z } from 'zod/v3';

export const zResponseRepositoryRefDto = /* @__PURE__ */ z.object({
  id: z.string(),
  provider: z.enum(["github", "gitlab", "bitbucket", "other"]),
  host: z.string().nullable().optional(),
  name: z.string(),
  remote_urls: z.unknown().optional(),
  github_repository_id: z.string().nullable().optional(),
  created_at: z.unknown(),
  updated_at: z.unknown(),
  epoch: z.number(),
  created_by: z.string(),
  updated_by: z.string(),
  workspace_id: z.string(),
  deleted_at: z.unknown(),
  deleted_by: z.string().nullable(),
});

export const zRepositoryRefFindAllV1Data = /* @__PURE__ */ z.object({
  query: z.object({
    '_with': z.string().optional(),
    'page': z.number().optional(),
    'limit': z.number().optional(),
    'filter.id': z.array(z.string()).optional(),
    'filter.host': z.array(z.string()).optional(),
    'filter.name': z.array(z.string()).optional(),
    'filter.github_repository_id': z.array(z.string()).optional(),
    'filter.created_at': z.array(z.string()).optional(),
    'filter.updated_at': z.array(z.string()).optional(),
    'filter.deleted_at': z.array(z.string()).optional(),
    'sortBy': z.array(z.enum(["id:ASC", "id:DESC", "host:ASC", "host:DESC", "name:ASC", "name:DESC", "github_repository_id:ASC", "github_repository_id:DESC", "created_at:ASC", "created_at:DESC", "updated_at:ASC", "updated_at:DESC", "deleted_at:ASC", "deleted_at:DESC"])).optional(),
    'search': z.string().optional(),
    'searchBy': z.array(z.string()).optional(),
  }).optional(),
  url: z.literal('/v1/repository-ref'),
});

