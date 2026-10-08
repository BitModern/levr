// Generated from the Levr OpenAPI specification. Do not edit.
import type {
  PaginatedDocumented,
} from '../_common/types.js';
export type ResponseTeamDto = {
  id: string;
  name: string;
  key?: string;
  description?: string | null | null;
  icon?: string | null | null;
  color?: string | null | null;
  is_private?: boolean;
  issue_count?: number;
  settings?: unknown | null;
  estimation_scale?: "none" | "fibonacci" | "linear" | "tshirt";
  estimation_allow_zero?: boolean;
  estimation_unestimated_value?: number;
  is_system?: boolean;
  created_at: unknown;
  updated_at: unknown;
  epoch: number;
  created_by: string;
  updated_by: string;
  workspace_id: string;
  deleted_at: unknown | null;
  deleted_by: string | null | null;
  archived_at: unknown | null;
  archived_by: string | null | null;
  web_url?: string | null | null;
};

export type TeamFindAllV1Data = {
  body?: never;
  path?: never;
  query?: {
    _with?: string;
    page?: number;
    limit?: number;
    'filter.id'?: Array<string>;
    'filter.name'?: Array<string>;
    'filter.key'?: Array<string>;
    'filter.description'?: Array<string>;
    'filter.icon'?: Array<string>;
    'filter.color'?: Array<string>;
    'filter.is_private'?: Array<string>;
    'filter.issue_count'?: Array<string>;
    'filter.estimation_allow_zero'?: Array<string>;
    'filter.estimation_unestimated_value'?: Array<string>;
    'filter.is_system'?: Array<string>;
    'filter.created_at'?: Array<string>;
    'filter.updated_at'?: Array<string>;
    'filter.deleted_at'?: Array<string>;
    'filter.archived_at'?: Array<string>;
    sortBy?: Array<"id:ASC" | "id:DESC" | "name:ASC" | "name:DESC" | "key:ASC" | "key:DESC" | "description:ASC" | "description:DESC" | "icon:ASC" | "icon:DESC" | "color:ASC" | "color:DESC" | "issue_count:ASC" | "issue_count:DESC" | "estimation_unestimated_value:ASC" | "estimation_unestimated_value:DESC" | "created_at:ASC" | "created_at:DESC" | "updated_at:ASC" | "updated_at:DESC" | "deleted_at:ASC" | "deleted_at:DESC" | "archived_at:ASC" | "archived_at:DESC">;
    search?: string;
    searchBy?: Array<string>;
  };
  url: '/v1/team';
};

export type TeamFindAllV1Responses = {
  200: PaginatedDocumented & {
    data?: Array<ResponseTeamDto>;
    meta?: unknown;
  };
};

export type TeamFindAllV1Errors = unknown;

