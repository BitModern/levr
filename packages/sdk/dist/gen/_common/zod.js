// Generated from the Levr OpenAPI specification. Do not edit.
// Shared Zod schemas referenced by multiple controllers

import { z } from 'zod/v3';

export const zPaginatedMetaDocumented = /* @__PURE__ */ z.object({
  itemsPerPage: z.number(),
  totalItems: z.number(),
  currentPage: z.number(),
  totalPages: z.number(),
  sortBy: z.array(z.array(z.union([z.string(), z.enum(["ASC", "DESC"])]))).optional(),
  searchBy: z.array(z.string()).optional(),
  search: z.string().optional(),
  select: z.array(z.string()).optional(),
  filter: z.record(z.string(), z.unknown()).optional(),
});

export const zPaginatedLinksDocumented = /* @__PURE__ */ z.object({
  first: z.string().optional(),
  previous: z.string().optional(),
  current: z.string().optional(),
  next: z.string().optional(),
  last: z.string().optional(),
});

export const zPaginatedDocumented = /* @__PURE__ */ z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  meta: zPaginatedMetaDocumented,
  links: zPaginatedLinksDocumented,
});

