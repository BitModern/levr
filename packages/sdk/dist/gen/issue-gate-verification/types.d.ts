// Generated from the Levr OpenAPI specification. Do not edit.
export type IssueGateVerificationReportGateResultsV1Body = {
  results: Array<{
  gate_type: string;
  link_id: string;
  status: "pass" | "fail" | "error";
  output: string;
  expected?: string;
  step_id?: string;
  rule_hash?: string;
  steps?: Array<{
  command: string;
  exit_code: number;
  stdout_tail: string;
  stderr_tail: string;
  step_id?: string;
}>;
}>;
};

export type IssueGateVerificationVerifyGatesV1Data = {
  body?: never;
  path: {
    id: string;
  };
  query?: never;
  url: '/v1/issue/{id}/verify-gates';
};

export type IssueGateVerificationVerifyGatesV1Responses = unknown;

export type IssueGateVerificationVerifyGatesV1Errors = unknown;

export type IssueGateVerificationReportGateResultsV1Data = {
  body: IssueGateVerificationReportGateResultsV1Body;
  path: {
    id: string;
  };
  query?: never;
  url: '/v1/issue/{id}/gate-results';
};

export type IssueGateVerificationReportGateResultsV1Responses = unknown;

export type IssueGateVerificationReportGateResultsV1Errors = unknown;

