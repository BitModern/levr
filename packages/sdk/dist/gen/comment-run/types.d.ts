// Generated from the Levr OpenAPI specification. Do not edit.
export type CreateCommentRunDto = {
  id?: string;
  body?: string | null | null;
  key?: number;
  source?: unknown | null;
  spoke_key?: string | null | null;
  run_id: string;
};

export type ResponseCommentRunDto = {
  id: string;
  body?: string | null | null;
  key?: number;
  source?: unknown | null;
  spoke_key?: string | null | null;
  run_id: string;
  created_at: unknown;
  updated_at: unknown;
  epoch: number;
  created_by: string;
  updated_by: string;
  workspace_id: string;
  deleted_at: unknown | null;
  deleted_by: string | null | null;
};

export type CommentRunCreateV1Data = {
  body: CreateCommentRunDto;
  path?: never;
  query?: never;
  url: '/v1/comment-run';
};

export type CommentRunCreateV1Responses = {
  201: ResponseCommentRunDto;
};

export type CommentRunCreateV1Errors = unknown;

