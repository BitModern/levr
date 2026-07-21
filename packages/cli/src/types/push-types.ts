/**
 * Parsed flags for the `levr push` command.
 */
export interface PushCommandFlags {
  'workspace-id'?: string;
  'team-id'?: string;
  source?: string;
  /**
   * UUID of an existing automation_source. When set (or when env var
   * LEVR_AUTOMATION_SOURCE_ID is set), `levr push` routes to
   * POST /v1/automation-run/ingest (synchronous automation pipeline)
   * instead of the legacy POST /v1/imports queue.
   */
  'automation-source'?: string;
  'run-name'?: string;
  format?: 'junit' | 'gherkin' | 'cucumber-json';
  'parent-folder-id'?: string;
  'update-mode': 'update' | 'create_new';
  verbose: boolean;
}
