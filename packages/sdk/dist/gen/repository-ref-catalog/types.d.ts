// Generated from the Levr OpenAPI specification. Do not edit.
export type ResolveByRemoteResultDto = {
  repository: {
  repository_ref_id: string | null | null;
  github_repository_id: string | null | null;
  provider: "github" | "gitlab" | "bitbucket" | "other";
  host: string | null | null;
  name: string;
  repo_key: string;
} | null;
};

export type CreateRepositoryRefDto = {
  remote: string;
  provider?: "github" | "gitlab" | "bitbucket" | "other";
  github_repository_id?: string;
};

export type CreatedRepositoryRefDto = {
  id: string;
  workspace_id: string;
  provider: "github" | "gitlab" | "bitbucket" | "other";
  host: string | null | null;
  name: string;
  remote_urls: Array<string>;
  github_repository_id: string | null | null;
  repo_key: string;
};

export type RepositoryRefCatalogResolveByRemoteV1Data = {
  body?: never;
  path?: never;
  query?: {
    remote: string;
  };
  url: '/v1/repository-catalog/resolve';
};

export type RepositoryRefCatalogResolveByRemoteV1Responses = {
  200: ResolveByRemoteResultDto;
};

export type RepositoryRefCatalogResolveByRemoteV1Errors = unknown;

export type RepositoryRefCatalogCreateV1Data = {
  body: CreateRepositoryRefDto;
  path?: never;
  query?: never;
  url: '/v1/repository-catalog';
};

export type RepositoryRefCatalogCreateV1Responses = {
  201: CreatedRepositoryRefDto;
};

export type RepositoryRefCatalogCreateV1Errors = unknown;

