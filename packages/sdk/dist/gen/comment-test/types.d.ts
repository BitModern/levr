// Generated from the Levr OpenAPI specification. Do not edit.
export type CreateCommentTestDto = {
  id?: string;
  body?: string | null | null;
  key?: number;
  source?: unknown | null;
  spoke_key?: string | null | null;
  test_id: string;
};

export type ResponseCommentTestDto = {
  id: string;
  body?: string | null | null;
  key?: number;
  source?: unknown | null;
  spoke_key?: string | null | null;
  test_id: string;
  created_at: unknown;
  updated_at: unknown;
  epoch: number;
  created_by: string;
  updated_by: string;
  workspace_id: string;
  deleted_at: unknown | null;
  deleted_by: string | null | null;
};

export type CommentTestCreateV1Data = {
  body: CreateCommentTestDto;
  path?: never;
  query?: never;
  url: '/v1/comment-test';
};

export type CommentTestCreateV1Responses = {
  201: ResponseCommentTestDto;
};

export type CommentTestCreateV1Errors = unknown;

