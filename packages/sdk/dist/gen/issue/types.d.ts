// Generated from the Levr OpenAPI specification. Do not edit.
import type {
  PaginatedDocumented,
} from '../_common/types.js';
export type ResponseIssueDto = {
  id: string;
  identifier?: string;
  number?: number;
  title: string;
  description?: string | null | null;
  priority?: number;
  estimate?: number | null | null;
  rolled_up_estimate?: number | null | null;
  rolled_up_completed_estimate?: number | null | null;
  sequence?: string;
  sub_issue_sequence?: string | null | null;
  due_date?: unknown | null;
  snoozed_until?: unknown | null;
  started_at?: unknown | null;
  completed_at?: unknown | null;
  canceled_at?: unknown | null;
  auto_closed_at?: unknown | null;
  origin?: string;
  origin_detail?: string | null | null;
  origin_model?: string | null | null;
  origin_harness?: string | null | null;
  origin_harness_version?: string | null | null;
  origin_run_result_id?: string | null | null;
  verification_status?: string;
  verification_detail?: unknown | null;
  confidence_score?: number | null | null;
  added_to_cycle_at?: unknown | null;
  sla_status?: string | null | null;
  team_id: string;
  workflow_state_id?: string;
  creator_id?: string;
  gate_set_id?: string | null | null;
  milestone_id?: string | null | null;
  spoke_key?: string | null | null;
  gate_run_id?: string | null | null;
  project_id?: string | null | null;
  assignee_id?: string | null | null;
  parent_id?: string | null | null;
  cycle_id?: string | null | null;
  type_label_id?: string | null | null;
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
  auto_archived_at: unknown | null;
  web_url?: string | null | null;
};

export type IssueFindAllV1Data = {
  body?: never;
  path?: never;
  query?: {
    _with?: string;
    page?: number;
    limit?: number;
    'filter.id'?: Array<string>;
    'filter.identifier'?: Array<string>;
    'filter.number'?: Array<string>;
    'filter.title'?: Array<string>;
    'filter.description'?: Array<string>;
    'filter.priority'?: Array<string>;
    'filter.estimate'?: Array<string>;
    'filter.rolled_up_estimate'?: Array<string>;
    'filter.rolled_up_completed_estimate'?: Array<string>;
    'filter.sequence'?: Array<string>;
    'filter.sub_issue_sequence'?: Array<string>;
    'filter.due_date'?: Array<string>;
    'filter.snoozed_until'?: Array<string>;
    'filter.started_at'?: Array<string>;
    'filter.completed_at'?: Array<string>;
    'filter.canceled_at'?: Array<string>;
    'filter.auto_closed_at'?: Array<string>;
    'filter.origin'?: Array<string>;
    'filter.origin_detail'?: Array<string>;
    'filter.origin_model'?: Array<string>;
    'filter.origin_harness'?: Array<string>;
    'filter.origin_harness_version'?: Array<string>;
    'filter.origin_run_result_id'?: Array<string>;
    'filter.verification_status'?: Array<string>;
    'filter.confidence_score'?: Array<string>;
    'filter.added_to_cycle_at'?: Array<string>;
    'filter.sla_status'?: Array<string>;
    'filter.team_id'?: Array<string>;
    'filter.workflow_state_id'?: Array<string>;
    'filter.creator_id'?: Array<string>;
    'filter.gate_set_id'?: Array<string>;
    'filter.milestone_id'?: Array<string>;
    'filter.spoke_key'?: Array<string>;
    'filter.gate_run_id'?: Array<string>;
    'filter.assignee_id'?: Array<string>;
    'filter.parent_id'?: Array<string>;
    'filter.cycle_id'?: Array<string>;
    'filter.type_label_id'?: Array<string>;
    'filter.created_at'?: Array<string>;
    'filter.updated_at'?: Array<string>;
    'filter.project_id'?: Array<string>;
    'filter.deleted_at'?: Array<string>;
    'filter.archived_at'?: Array<string>;
    sortBy?: Array<"id:ASC" | "id:DESC" | "identifier:ASC" | "identifier:DESC" | "number:ASC" | "number:DESC" | "title:ASC" | "title:DESC" | "description:ASC" | "description:DESC" | "priority:ASC" | "priority:DESC" | "estimate:ASC" | "estimate:DESC" | "rolled_up_estimate:ASC" | "rolled_up_estimate:DESC" | "rolled_up_completed_estimate:ASC" | "rolled_up_completed_estimate:DESC" | "sequence:ASC" | "sequence:DESC" | "sub_issue_sequence:ASC" | "sub_issue_sequence:DESC" | "due_date:ASC" | "due_date:DESC" | "snoozed_until:ASC" | "snoozed_until:DESC" | "started_at:ASC" | "started_at:DESC" | "completed_at:ASC" | "completed_at:DESC" | "canceled_at:ASC" | "canceled_at:DESC" | "auto_closed_at:ASC" | "auto_closed_at:DESC" | "origin:ASC" | "origin:DESC" | "origin_detail:ASC" | "origin_detail:DESC" | "origin_model:ASC" | "origin_model:DESC" | "origin_harness:ASC" | "origin_harness:DESC" | "origin_harness_version:ASC" | "origin_harness_version:DESC" | "verification_status:ASC" | "verification_status:DESC" | "confidence_score:ASC" | "confidence_score:DESC" | "added_to_cycle_at:ASC" | "added_to_cycle_at:DESC" | "sla_status:ASC" | "sla_status:DESC" | "spoke_key:ASC" | "spoke_key:DESC" | "project_id:ASC" | "project_id:DESC" | "assignee_id:ASC" | "assignee_id:DESC" | "parent_id:ASC" | "parent_id:DESC" | "origin_run_result_id:ASC" | "origin_run_result_id:DESC" | "cycle_id:ASC" | "cycle_id:DESC" | "type_label_id:ASC" | "type_label_id:DESC" | "gate_set_id:ASC" | "gate_set_id:DESC" | "milestone_id:ASC" | "milestone_id:DESC" | "gate_run_id:ASC" | "gate_run_id:DESC" | "created_at:ASC" | "created_at:DESC" | "updated_at:ASC" | "updated_at:DESC" | "deleted_at:ASC" | "deleted_at:DESC" | "archived_at:ASC" | "archived_at:DESC">;
    search?: string;
    searchBy?: Array<string>;
  };
  url: '/v1/issue';
};

export type IssueFindAllV1Responses = {
  200: PaginatedDocumented & {
    data?: Array<ResponseIssueDto>;
    meta?: unknown;
  };
};

export type IssueFindAllV1Errors = unknown;

