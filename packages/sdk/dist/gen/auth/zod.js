// Generated from the Levr OpenAPI specification. Do not edit.

import { z } from 'zod/v3';

export const zUserProfileResponseDto = /* @__PURE__ */ z.object({
  id: z.string(),
  user_account_id: z.string().optional(),
  email: z.string().optional(),
  name: z.string().optional(),
  avatar_url: z.string().optional(),
  color: z.string().optional(),
  verified: z.boolean().optional(),
  workspace_id: z.string().optional(),
  active_team_id: z.string().nullable().optional(),
});

export const zSitesResponseDto = /* @__PURE__ */ z.object({
  sites: z.array(z.object({
  workspace_id: z.string(),
  workspace_name: z.string(),
  workspace_url_key: z.string(),
  user_id: z.string(),
  role: z.enum(["owner", "admin", "member", "guest"]),
  is_primary: z.boolean(),
  last_accessed_at: z.string().nullable(),
})),
  current_workspace_id: z.string(),
});

export const zAuthGetProfileV1Data = /* @__PURE__ */ z.object({
  url: z.literal('/v1/auth/profile'),
});

export const zAuthGetSitesV1Data = /* @__PURE__ */ z.object({
  url: z.literal('/v1/auth/sites'),
});

