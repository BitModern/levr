import { buildCommand } from '@stricli/core';

export const pushCommand = buildCommand({
  docs: {
    brief: 'Push test results to Levr',
    fullDescription: `Upload a test result file to Levr.

The backend auto-detects the file format (JUnit XML, Gherkin, Cucumber JSON).
In CI environments, the automation source name and CI metadata are auto-detected.

Team ID is optional. When omitted, the server resolves the team from:
  1. The existing automation source's team (if --source matches a known source)
  2. The workspace's default team

Examples:
  levr push ./test-results.xml
  levr push ./results.xml --source "backend-unit-tests"
  levr push ./report.json --team-id <uuid>   # explicit team
  levr push ./report.json   # uses LEVR_TOKEN env var, default team`,
  },
  parameters: {
    positional: {
      kind: 'tuple',
      parameters: [
        {
          parse: String,
          brief: 'Path to test result file (.xml, .feature, .json)',
          placeholder: 'file',
          optional: false,
        },
      ] as const,
    },
    flags: {
      'workspace-id': {
        kind: 'parsed',
        parse: String,
        brief: 'Workspace ID (required for multi-workspace JWT auth)',
        placeholder: 'uuid',
        optional: true,
      },
      'team-id': {
        kind: 'parsed',
        parse: String,
        brief: 'Team ID (optional; server resolves default if omitted)',
        placeholder: 'uuid',
        optional: true,
      },
      source: {
        kind: 'parsed',
        parse: String,
        brief: 'Automation source name (auto-detected in CI)',
        placeholder: 'name',
        optional: true,
      },
      'automation-source': {
        kind: 'parsed',
        parse: String,
        brief:
          'Automation source UUID. When set, routes to POST /v1/automation-run/ingest (synchronous, bypasses ImportJob queue) instead of POST /v1/imports.',
        placeholder: 'uuid',
        optional: true,
      },
      'run-name': {
        kind: 'parsed',
        parse: String,
        brief: 'Name for the test run',
        placeholder: 'name',
        optional: true,
      },
      format: {
        kind: 'enum',
        values: ['junit', 'gherkin', 'cucumber-json'] as const,
        brief: 'File format (auto-detected if omitted)',
        optional: true,
      },
      'parent-folder-id': {
        kind: 'parsed',
        parse: String,
        brief: 'Destination folder ID',
        placeholder: 'uuid',
        optional: true,
      },
      // internal R3: --create-run dropped. Run creation is driven entirely by
      // file content (`parsed.hasResults`). The flag was a legacy escape
      // hatch with no real use case — manufacturing an empty Run row carries
      // no value.
      'update-mode': {
        kind: 'enum',
        values: ['update', 'create_new'] as const,
        default: 'update',
        brief: 'How to handle existing tests',
      },
      verbose: {
        kind: 'boolean',
        default: false,
        brief: 'Show detailed output',
      },
    },
    aliases: {
      w: 'workspace-id',
      t: 'team-id',
      s: 'source',
      a: 'automation-source',
      r: 'run-name',
      f: 'format',
      v: 'verbose',
    },
  },
  loader: async () => {
    const { pushHandler } = await import('./pushHandler.js');
    return pushHandler;
  },
});
