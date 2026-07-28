/**
 * Pure mapping-review helpers for `levr import` (internal) — separated
 * from the handler so the override/required logic is unit-testable
 * without a TTY.
 */
import type { PreviewImportResponseDto } from '@levr/sdk';

export type MappingEntry = PreviewImportResponseDto['proposed_mapping'][number];

export type ImportTarget = NonNullable<MappingEntry['targetProperty']>;

export const IMPORT_TARGETS: ImportTarget[] = [
  'row_type',
  'test_id',
  'test_key',
  'folder_id',
  'folder_path',
  'folder_name',
  'test_name',
  'test_description',
  'test_type',
  'case_type_id',
  'case_type_name',
  'test_priority',
  'estimate',
  'is_automated',
  'assignee_email',
  'labels',
  'attachment_filenames',
  'data_set_names',
  'sequence',
  'item_id',
  'method',
  'expected_result',
  'keyword',
  'shared_step_id',
  'shared_precondition_id',
  'data_table',
  'steps',
  'preconditions',
];

export const REQUIRED_TARGETS: ImportTarget[] = ['test_name'];

/**
 * Parse a --map value: "Source Column=target", "Source Column=" (drop),
 * or "Source Column=labels:prefix" (import-as-labels: each value becomes
 * the label "prefix:value", preserving the column's provenance).
 */
export function parseMapFlag(pair: string): {
  column: string;
  target: ImportTarget | null;
  labelPrefix?: string;
} {
  const separator = pair.indexOf('=');
  if (separator <= 0) {
    throw new Error(
      `Invalid --map "${pair}" — expected "Source Column=target_field" (or "Source Column=" to drop, or "Source Column=labels:prefix" to import values as prefixed labels).`,
    );
  }
  const column = pair.slice(0, separator).trim();
  const raw = pair.slice(separator + 1).trim();
  if (raw === '') return { column, target: null };
  if (raw.startsWith('labels:')) {
    const labelPrefix = raw.slice('labels:'.length).trim();
    if (!labelPrefix) {
      throw new Error(
        `Invalid --map "${pair}" — "labels:" needs a prefix (e.g. "State=labels:state").`,
      );
    }
    return { column, target: 'labels', labelPrefix };
  }
  const target = IMPORT_TARGETS.find((t) => t === raw);
  if (!target) {
    throw new Error(
      `Invalid --map target "${raw}". Valid targets: ${IMPORT_TARGETS.join(', ')} (labels also accepts "labels:prefix")`,
    );
  }
  return { column, target };
}

/** Apply overrides (from --map / --mapping-file) onto the proposed mapping. */
export function applyOverrides(
  mapping: MappingEntry[],
  overrides: Array<{
    column: string;
    target: ImportTarget | null;
    labelPrefix?: string;
  }>,
): MappingEntry[] {
  const result = mapping.map((entry) => ({ ...entry }));
  for (const override of overrides) {
    const entry = result.find((m) => m.originalName === override.column);
    if (!entry) {
      throw new Error(
        `--map column "${override.column}" not found in the file. Columns: ${result
          .map((m) => m.originalName)
          .join(', ')}`,
      );
    }
    entry.targetProperty = override.target;
    // 'manual' = user-asserted (--map/--mapping-file), distinct from the
    // mapper's automatic 'exact' tier — same convention as the client UI.
    entry.matchType = override.target ? 'manual' : 'unmapped';
    entry.confidence = override.target ? 1 : 0;
    entry.labelPrefix = override.labelPrefix;
  }
  return result;
}

/** Required targets not covered by any mapped column. */
export function missingRequired(mapping: MappingEntry[]): ImportTarget[] {
  const covered = new Set(mapping.map((m) => m.targetProperty).filter(Boolean));
  return REQUIRED_TARGETS.filter((t) => !covered.has(t));
}

/** Columns worth walking interactively: unmapped, or LLM guesses < 0.7. */
export function columnsNeedingReview(mapping: MappingEntry[]): MappingEntry[] {
  return mapping.filter(
    (m) =>
      m.targetProperty === null ||
      (m.matchType === 'llm' && m.confidence < 0.7),
  );
}
