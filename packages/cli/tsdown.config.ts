import { defineConfig } from 'tsdown';

/**
 * Public-publish brand scrub (D4 / internal).
 *
 * The bundled `@levr/sdk` is generated code (`yarn gen:sdk`) — it cannot be
 * hand-edited (it would be overwritten on the next regen), and the proper
 * spec-level fixes are deferred to internal. So we scrub the internal-brand
 * string literals that survive bundling out of every emitted chunk at build
 * time. These are all schema `.describe()` examples / dead-code webhook schema
 * identifiers the CLI never invokes — replacing the strings is metadata-only
 * and does not change any runtime behavior the CLI relies on.
 *
 * Order matters: longer / more-specific patterns run before their substrings.
 */
const SCRUB: [RegExp, string][] = [
  [/BitModern\/tq-llm-eval/g, 'owner/repo'],
  [/tq-llm-eval/g, 'levr'],
  [/TestQuality/g, 'Levr'],
  [/testquality\.com/g, 'levr.one'],
  [/testquality/g, 'levr'],
  // NOTE: no `api.levr.now → api.levr.one` (or auth./ai. equivalents) rules.
  // Earlier revisions had them for SDK describe-string prose (now emptied
  // wholesale by DESCRIBE_STRIP), but the blanket rewrite corrupted the
  // KNOWN_AUTH_HOSTS / KNOWN_MCP_URLS derivation maps in the shipped bundle —
  // both staging entries collapsed onto the production pair, so the published
  // 0.2.0 binary could not derive staging URLs from LEVR_URL (internal).
  // Staging hostnames shipping in the public artifact is accepted precedent
  // (@levr-one/auth PRESETS).
  [/TQ_LLM_EVAL_MCP_ACCESS_TOKEN/g, 'LEVR_TOKEN'],
  [/TQ_WORKSPACE_ID/g, 'LEVR_WORKSPACE_ID'],
  [/TQ_PAT/g, 'LEVR_TOKEN'],
  [/@testlm\//g, '@levr/'],
  // Stopgap for the residual internal-codename leak (audit F1): the bundled SDK
  // ships DTO/RPC *identifier* names for internal agent domains the CLI never
  // invokes (e.g. `zQineticRcaConfigDto`), exposing the product codenames
  // themselves. describe-strip already removed the prose; these blanket-rename
  // the codenames out of the identifiers. Each maps to a DISTINCT token that is
  // absent from the bundle, so no two identifiers collapse into a duplicate
  // top-level `const` (verified: the build stays valid JS). This is a denylist,
  // not a structural fix — a NEW internal codename in a future SDK regen would
  // leak again; the durable answer (tree-shakeable SDK / minimal client) is
  // internal.
  [/Qinetic/g, 'Internal'],
  [/Prometheus/g, 'Reserved'],
  [/Steward/g, 'Omitted'],
];

// zod `.describe("…")` calls are pure documentation metadata (no validation or
// runtime effect). The bundled generated SDK barrels its ENTIRE API surface
// (rolldown can't tree-shake it by usage), so those describe strings carry a
// large amount of internal prose — table names, ticket refs, agent codenames —
// into the public bundle. Empty them structurally (one rule, not a denylist):
// this removes the internal-info leak and drops ~470 kB / ~30% of the bundle.
// The `(?:\\.|[^q\\])*` bodies match across escaped quotes. The generated SDK
// emits double-quoted single-line describe strings today, but we match all
// three JS string-literal forms — double, single, and backtick — so a change in
// the code generator's or a formatter's quote style can't silently defeat the
// strip and re-leak internal prose (PR #2431 review). Only string-literal
// arguments are touched (a `.describe(someVar)` form, which the generated code
// does not use, is deliberately left alone). (D4 / internal, audit finding F1.)
const DESCRIBE_STRIP =
  /\.describe\(\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)\s*\)/g;

const brandScrubPlugin = {
  name: 'levr-brand-scrub',
  renderChunk(code: string) {
    let out = code.replace(DESCRIBE_STRIP, '.describe("")');
    for (const [pattern, replacement] of SCRUB) {
      out = out.replace(pattern, replacement);
    }
    return out === code ? null : { code: out, map: null };
  },
};

export default defineConfig({
  entry: ['src/bin/cli.ts'],
  format: 'esm',
  // Public build: no source maps. Maps would repack original TS source strings,
  // full monorepo file paths, and internal brand names into the published
  // tarball (files: ["dist", ...]) — the brand-leak gates only grep cli.js, so
  // a shipped .map would smuggle the leaks past them (D4 / review R1 H1).
  sourcemap: false,
  // Bundle the internal generated SDK + ci-env into the binary so the published
  // package is self-contained (no @levr/* runtime deps, no dangling .d.ts).
  // Everything else (@stricli/*, chalk, open, ora, zod) stays external and
  // resolves from the public npm registry (D2 decision / D4).
  // Regex, not exact names: mcp-harnesses is imported via its `/node` SUBPATH,
  // which an exact-string noExternal match misses — the specifier then stays
  // external and the brand scrub mangles it into an unresolvable runtime dep.
  noExternal: [/^@testlm\//],
  // Single-file entry, no shared-chunk splitting.
  splitting: false,
  outdir: 'dist',
  clean: true,
  tsconfig: './tsconfig.json',
  plugins: [brandScrubPlugin],
});
