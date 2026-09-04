/**
 * Pure mapping-review helpers for `levr import` (internal) — separated
 * from the handler so the override/required logic is unit-testable
 * without a TTY.
 */
import type { PreviewImportResponseDto } from '@levr/sdk';

export type MappingEntry = PreviewImportResponseDto['proposed_mapping'][number];

export type ImportTarget = NonNullable<MappingEntry['targetProperty']>;

/**
 * Every import target the CLI will accept for `--map`.
 *
 * internal shipped a `teams` target on the server and in the web client, and
 * this list was left behind — so `levr import --map "Team=teams"` threw
 * "Invalid --map target" and team ownership was simply unreachable from the
 * CLI. Nothing caught it: this is the THIRD hand-maintained copy of the
 * target list (backend `IMPORT_TARGET_PROPERTIES`, client
 * `TEST_CASE_KNOWN_PROPERTIES`, here), and while the ELEMENT type is derived
 * from the SDK, TypeScript cannot see that an array literal omits a member of
 * a union — `ImportTarget[]` is satisfied by any subset, including `[]`.
 *
 * So the literal is `as const` and the exhaustiveness assertions below turn a
 * missing target into a COMPILE error naming it, rather than a runtime
 * rejection the user discovers. Adding a target server-side now breaks this
 * build until it is listed here.
 *
 * Caveat worth knowing: `@levr/sdk` resolves to `dist/`, so the union this
 * is checked against is only as fresh as the last SDK build. A regenerated
 * but unbuilt SDK delays detection to the next build — it does not restore
 * the old failure, where the omission was invisible indefinitely.
 */
const IMPORT_TARGET_LIST = [
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
  'teams',
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
] as const;

export const IMPORT_TARGETS: readonly ImportTarget[] = IMPORT_TARGET_LIST;

/**
 * Compile-time drift guards. `Assert<T>` only accepts `never`, so each alias
 * below fails to compile — naming the offending target in the error — when
 * the two sets diverge in either direction.
 */
type Assert<T extends never> = T;

/** A target the SDK knows about that this list omits. The internal failure. */
type _NoMissingTargets = Assert<
  Exclude<ImportTarget, (typeof IMPORT_TARGET_LIST)[number]>
>;

/** A target listed here that the SDK no longer has — a removal left behind. */
type _NoUnknownTargets = Assert<
  Exclude<(typeof IMPORT_TARGET_LIST)[number], ImportTarget>
>;

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
