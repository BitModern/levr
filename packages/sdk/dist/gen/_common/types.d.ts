// Generated from the Levr OpenAPI specification. Do not edit.
// Shared schemas referenced by multiple controllers

export type PaginatedMetaDocumented = {
  itemsPerPage: number;
  totalItems: number;
  currentPage: number;
  totalPages: number;
  sortBy?: Array<Array<string | "ASC" | "DESC">>;
  searchBy?: Array<string>;
  search?: string;
  select?: Array<string>;
  filter?: Record<string, unknown>;
};

export type PaginatedLinksDocumented = {
  first?: string;
  previous?: string;
  current?: string;
  next?: string;
  last?: string;
};

export type PaginatedDocumented = {
  data: Array<Record<string, unknown>>;
  meta: PaginatedMetaDocumented;
  links: PaginatedLinksDocumented;
};

