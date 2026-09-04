import { buildCommand } from '@stricli/core';

export const importCommand = buildCommand({
  docs: {
    brief: 'Import test cases from CSV, Excel, JSON, or Google Sheets',
    fullDescription: `Two-phase test-case import: preview proposes a column mapping to the
Levr test-case schema (exact/fuzzy matching with an LLM assist), you review
and adjust it, then commit writes folders, tests, steps, and preconditions.

Interactive mode (default in a terminal) walks unmapped and low-confidence
columns with a picker. For scripts/CI use --yes and/or --map.

Required-field rule: a column must map to test_name or the commit is
rejected — interactive mode will ask; non-interactive runs exit 1.

Examples:
  levr import ./testrail-export.csv --team-key ENG
  levr import ./cases.xlsx --team-key ENG --map "Title=test_name"
  levr import --sheets-url "https://docs.google.com/spreadsheets/d/..." --team-key ENG --yes
  levr import ./cases.csv --team-id <uuid> --save-mapping mapping.json
  levr import ./cases.csv --team-id <uuid> --mapping-file mapping.json --yes   # CI replay`,
  },
  parameters: {
    positional: {
      kind: 'tuple',
      parameters: [
        {
          parse: String,
          brief: 'Path to the source file (.csv, .xlsx, .json)',
          placeholder: 'file',
          optional: true,
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
        brief:
          'Team doing the import, by UUID. Optional: use --team-key instead, or omit both when the workspace has one team',
        placeholder: 'uuid',
        optional: true,
      },
      'team-key': {
        kind: 'parsed',
        parse: String,
        brief:
          'Team doing the import, by key (e.g. ENG). Case-insensitive. Alternative to --team-id',
        placeholder: 'key',
        optional: true,
      },
      'sheets-url': {
        kind: 'parsed',
        parse: String,
        brief: 'Public Google Sheets URL (instead of a file)',
        placeholder: 'url',
        optional: true,
      },
      format: {
        kind: 'enum',
        values: ['csv', 'xlsx', 'json'] as const,
        brief: 'Source format (auto-detected from the filename if omitted)',
        optional: true,
      },
      map: {
        kind: 'parsed',
        parse: String,
        brief:
          'Column override (repeatable): "Column=target_field", "Column=" to drop, or "Column=labels:prefix"',
        placeholder: 'pair',
        variadic: true,
        optional: true,
      },
      'mapping-file': {
        kind: 'parsed',
        parse: String,
        brief: 'JSON file with a saved confirmed mapping (from --save-mapping)',
        placeholder: 'path',
        optional: true,
      },
      'save-mapping': {
        kind: 'parsed',
        parse: String,
        brief: 'Write the confirmed mapping to this JSON file for CI replay',
        placeholder: 'path',
        optional: true,
      },
      yes: {
        kind: 'boolean',
        default: false,
        brief: 'Accept the mapping without prompts (required for non-TTY runs)',
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
      k: 'team-key',
      f: 'format',
      m: 'map',
      y: 'yes',
      v: 'verbose',
    },
  },
  loader: async () => {
    const { importHandler } = await import('./importHandler.js');
    return importHandler;
  },
});
