/**
 * Parsed flags for the `levr push` command.
 */
export interface PushCommandFlags {
  'workspace-id'?: string;
  'team-id'?: string;
  source?: string;
  /**
   * UUID of an existing automation_source. When set (or when env var
   * LEVR_AUTOMATION_SOURCE_ID is set), `levr push` sends it to
   * POST /v1/imports as `automation_source_id` instead of the source name
   * (internal).
   */
  'automation-source'?: string;
  'run-name'?: string;
  format?: 'junit' | 'gherkin' | 'cucumber-json' | 'ctrf-json';
  'parent-folder-id'?: string;
  'update-mode': 'update' | 'create_new';
  verbose: boolean;
}
