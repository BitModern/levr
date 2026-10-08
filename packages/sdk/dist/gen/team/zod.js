// Generated from the Levr OpenAPI specification. Do not edit.

import { z } from 'zod/v3';

export const zResponseTeamDto = /* @__PURE__ */ z.object({
  id: z.string(),
  name: z.string(),
  key: z.string().optional(),
  description: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  is_private: z.boolean().optional(),
  issue_count: z.number().optional(),
  settings: z.unknown().optional(),
  estimation_scale: z.enum(["none", "fibonacci", "linear", "tshirt"]).optional(),
  estimation_allow_zero: z.boolean().optional(),
  estimation_unestimated_value: z.number().optional(),
  is_system: z.boolean().optional(),
  created_at: z.unknown(),
  updated_at: z.unknown(),
  epoch: z.number(),
  created_by: z.string(),
  updated_by: z.string(),
  workspace_id: z.string(),
  deleted_at: z.unknown(),
  deleted_by: z.string().nullable(),
  archived_at: z.unknown(),
  archived_by: z.string().nullable(),
  web_url: z.string().nullable().optional(),
});

export const zTeamFindAllV1Data = /* @__PURE__ */ z.object({
  query: z.object({
    '_with': z.string().optional(),
    'page': z.number().optional(),
    'limit': z.number().optional(),
    'filter.id': z.array(z.string()).optional(),
    'filter.name': z.array(z.string()).optional(),
    'filter.key': z.array(z.string()).optional(),
    'filter.description': z.array(z.string()).optional(),
    'filter.icon': z.array(z.string()).optional(),
    'filter.color': z.array(z.string()).optional(),
    'filter.is_private': z.array(z.string()).optional(),
    'filter.issue_count': z.array(z.string()).optional(),
    'filter.estimation_allow_zero': z.array(z.string()).optional(),
    'filter.estimation_unestimated_value': z.array(z.string()).optional(),
    'filter.is_system': z.array(z.string()).optional(),
    'filter.created_at': z.array(z.string()).optional(),
    'filter.updated_at': z.array(z.string()).optional(),
    'filter.deleted_at': z.array(z.string()).optional(),
    'filter.archived_at': z.array(z.string()).optional(),
    'sortBy': z.array(z.enum(["id:ASC", "id:DESC", "name:ASC", "name:DESC", "key:ASC", "key:DESC", "description:ASC", "description:DESC", "icon:ASC", "icon:DESC", "color:ASC", "color:DESC", "issue_count:ASC", "issue_count:DESC", "estimation_unestimated_value:ASC", "estimation_unestimated_value:DESC", "created_at:ASC", "created_at:DESC", "updated_at:ASC", "updated_at:DESC", "deleted_at:ASC", "deleted_at:DESC", "archived_at:ASC", "archived_at:DESC"])).optional(),
    'search': z.string().optional(),
    'searchBy': z.array(z.string()).optional(),
  }).optional(),
  url: z.literal('/v1/team'),
});

