// Generated from the Levr OpenAPI specification. Do not edit.
import type {
  PaginatedDocumented,
} from '../_common/types.js';
export type ResponseRepositoryRefDto = {
  id: string;
  provider: "github" | "gitlab" | "bitbucket" | "other";
  host?: string | null | null;
  name: string;
  remote_urls?: unknown;
  github_repository_id?: string | null | null;
  created_at: unknown;
  updated_at: unknown;
  epoch: number;
  created_by: string;
  updated_by: string;
  workspace_id: string;
  deleted_at: unknown | null;
  deleted_by: string | null | null;
};

export type RepositoryRefFindAllV1Data = {
  body?: never;
  path?: never;
  query?: {
    _with?: string;
    page?: number;
    limit?: number;
    'filter.id'?: Array<string>;
    'filter.host'?: Array<string>;
    'filter.name'?: Array<string>;
    'filter.github_repository_id'?: Array<string>;
    'filter.created_at'?: Array<string>;
    'filter.updated_at'?: Array<string>;
    'filter.deleted_at'?: Array<string>;
    sortBy?: Array<"id:ASC" | "id:DESC" | "host:ASC" | "host:DESC" | "name:ASC" | "name:DESC" | "github_repository_id:ASC" | "github_repository_id:DESC" | "created_at:ASC" | "created_at:DESC" | "updated_at:ASC" | "updated_at:DESC" | "deleted_at:ASC" | "deleted_at:DESC">;
    search?: string;
    searchBy?: Array<string>;
  };
  url: '/v1/repository-ref';
};

export type RepositoryRefFindAllV1Responses = {
  200: PaginatedDocumented & {
    data?: Array<ResponseRepositoryRefDto>;
    meta?: unknown;
  };
};

export type RepositoryRefFindAllV1Errors = unknown;

