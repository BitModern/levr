import { buildCommand } from '@stricli/core';

export const pushCommand = buildCommand({
  docs: {
    brief: 'Push test results to Levr',
    fullDescription: `Upload a test result file to Levr.

The backend auto-detects the file format (JUnit XML, Gherkin, Cucumber JSON, CTRF JSON).
In CI environments, the automation source name and CI metadata are auto-detected.

An automation source is required: a name (--source, LEVR_SOURCE, or CI
auto-detection; created on first use) or the UUID of an existing source
(--automation-source or LEVR_AUTOMATION_SOURCE_ID). The UUID wins if both are set.

Team ID is optional. When omitted, the server resolves the team from:
  1. The existing automation source's team (if --source matches a known source)
  2. The workspace's default team
With --automation-source the team is always that source's team.

Examples:
  levr push ./results.xml --source "backend-unit-tests"
  levr push ./results.xml --automation-source <uuid>
  levr push ./report.json --source e2e --team-id <uuid>   # explicit team
  levr push ./test-results.xml   # in CI: source auto-detected
  levr push e2e-report.xml -s e2e --artifacts e2e-reports --output-results results.json

--artifacts <dir> uploads the screenshots, traces and videos the report
references (JUnit [[ATTACHMENT|path]], CTRF attachments[]) to their results.
Paths resolve against <dir> (then the report's directory) and must stay
inside the working directory. Files over 50 MiB are skipped. An artifact
problem prints a summary and never changes the push exit code.

--output-results <file> writes every imported result (id, name, suite,
classname, status, test_key, attempts, attachments) as JSON, for
levr attach --manifest or later uploads.`,
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
          'UUID of an existing automation source (never creates one). Used instead of --source.',
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
        values: ['junit', 'gherkin', 'cucumber-json', 'ctrf-json'] as const,
        brief: 'File format (auto-detected if omitted)',
        optional: true,
      },
      // internal R3: --create-run dropped. Run creation is driven entirely by
      // file content (`parsed.hasResults`). The flag was a legacy escape
      // hatch with no real use case — manufacturing an empty Run row carries
      // no value.
      // internal: --parent-folder-id and --update-mode dropped too. Neither
      // had an effect since internal: automation results have no folder tree,
      // and tests are namespaced by source (use another --source for a fresh
      // set).
      // internal: --artifacts and --output-results (outputResults in the
      // handler) both ask the server for result.results (include_results).
      artifacts: {
        kind: 'parsed',
        parse: String,
        brief:
          'Upload the artifacts the report references, resolved against this directory',
        placeholder: 'dir',
        optional: true,
      },
      'output-results': {
        kind: 'parsed',
        parse: String,
        brief:
          'Write the imported results (ids, test_key, attachments) to a JSON file',
        placeholder: 'file',
        optional: true,
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
