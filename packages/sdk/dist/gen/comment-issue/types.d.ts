// Generated from the Levr OpenAPI specification. Do not edit.
export type CreateCommentIssueDto = {
  id?: string;
  body?: string | null | null;
  key?: number;
  source?: unknown | null;
  spoke_key?: string | null | null;
  issue_id: string;
};

export type ResponseCommentIssueDto = {
  id: string;
  body?: string | null | null;
  key?: number;
  source?: unknown | null;
  spoke_key?: string | null | null;
  issue_id: string;
  created_at: unknown;
  updated_at: unknown;
  epoch: number;
  created_by: string;
  updated_by: string;
  workspace_id: string;
  deleted_at: unknown | null;
  deleted_by: string | null | null;
};

export type CommentIssueCreateV1Data = {
  body: CreateCommentIssueDto;
  path?: never;
  query?: never;
  url: '/v1/comment-issue';
};

export type CommentIssueCreateV1Responses = {
  201: ResponseCommentIssueDto;
};

export type CommentIssueCreateV1Errors = unknown;

