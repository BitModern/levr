// Generated from the Levr OpenAPI specification. Do not edit.
export type UserProfileResponseDto = {
  id: string;
  user_account_id?: string;
  email?: string;
  name?: string;
  avatar_url?: string;
  color?: string;
  verified?: boolean;
  workspace_id?: string;
  active_team_id?: string | null | null;
};

export type SitesResponseDto = {
  sites: Array<{
  workspace_id: string;
  workspace_name: string;
  workspace_url_key: string;
  user_id: string;
  role: "owner" | "admin" | "member" | "guest";
  is_primary: boolean;
  last_accessed_at: string | null | null;
}>;
  current_workspace_id: string;
};

export type AuthGetProfileV1Data = {
  body?: never;
  path?: never;
  query?: never;
  url: '/v1/auth/profile';
};

export type AuthGetProfileV1Responses = {
  200: UserProfileResponseDto;
};

export type AuthGetProfileV1Errors = unknown;

export type AuthGetSitesV1Data = {
  body?: never;
  path?: never;
  query?: never;
  url: '/v1/auth/sites';
};

export type AuthGetSitesV1Responses = {
  200: SitesResponseDto;
};

export type AuthGetSitesV1Errors = unknown;

