import "./gate-op-BINrIT2l.js";
import { client, configureClient } from "./sdk-client-CSy2LOEh.js";
import "./token-refresh-cvAydkok.js";
import "./env-Cv-anxJA.js";
import { resolveToken } from "./resolve-token-BeX-Xegl.js";
import "./workspace-store-BJyB_WEG.js";
import { resolveWorkspaceFor } from "./resolve-workspace-CJN1plpd.js";
import { z } from "zod";
import * as fs from "node:fs";
import * as path$1 from "node:path";

//#region ../sdk-public/dist/gen/gate-binding-transfer/functions.js
/** GET /v1/gate/bindings/export */
const gateBindingTransferExportConfigV1 = (options) => {
	return (options?.client ?? client).get({
		security: [{
			scheme: "bearer",
			type: "http"
		}],
		url: "/v1/gate/bindings/export",
		...options
	});
};
/** POST /v1/gate/bindings/import */
const gateBindingTransferImportConfigV1 = (options) => {
	return (options?.client ?? client).post({
		security: [{
			scheme: "bearer",
			type: "http"
		}],
		url: "/v1/gate/bindings/import",
		...options
	});
};

//#endregion
//#region ../shared/dist/constants/related-type.constants.js
/**
* Related type constants for polymorphic entities (attachments, label assignments, etc.)
*
* These are the normalized short-form related_type values used in the database.
* The old Levr PHP format ('App\\Models\\Test') has been replaced with simple strings ('test').
*/
/**
* Map of entity names to their related_type database values.
* Use RELATED_TYPE_MAP.Test instead of hardcoding 'test'.
*/
const RELATED_TYPE_MAP = {
	Test: "test",
	Step: "step",
	Folder: "folder",
	Plan: "plan",
	Defect: "defect",
	Requirement: "requirement",
	RunResult: "run_result",
	RunResultStep: "run_result_step",
	ImportJob: "import_job",
	Run: "run",
	Issue: "issue",
	Project: "project",
	Initiative: "initiative",
	Cycle: "cycle",
	Staged: "staged",
	DataSet: "data_set",
	RunResultVariant: "run_result_variant",
	ResearchStep: "research_step",
	ProjectUpdate: "project_update",
	AutomationRunResult: "automation_run_result",
	Unlinked: "unlinked"
};
/**
* Array of allowed related type values (for validation/enum)
*/
const RELATED_TYPES = Object.values(RELATED_TYPE_MAP);

//#endregion
//#region ../shared/dist/constants/file-upload.constants.js
/** Maximum file size in bytes (50 MB) */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

//#endregion
//#region ../shared/dist/constants/provider-type.constants.js
/**
* LLM provider type enum + display-name map.
*
* Single source of truth shared between `apps/backender` (provider/profile
* services, seeds) and `apps/client` (profile form dropdowns, synced-profile
* provider-name display). The backender re-exports these from
* `provider-type.enum.ts` for backward compatibility; the client imports them
* from `@levr/shared` directly.
*
* NOTE: `ProviderTypeApiBaseUrl` is intentionally NOT moved here — it is
* backend-only (no client needs default provider base URLs) and stays local to
* `apps/backender/src/provider/provider-type.enum.ts`.
*/
var ProviderType;
(function(ProviderType$1) {
	ProviderType$1[ProviderType$1["OpenAI"] = 1] = "OpenAI";
	ProviderType$1[ProviderType$1["Anthropic"] = 2] = "Anthropic";
	ProviderType$1[ProviderType$1["Groq"] = 3] = "Groq";
	ProviderType$1[ProviderType$1["Gemini"] = 4] = "Gemini";
	ProviderType$1[ProviderType$1["FireworksAI"] = 5] = "FireworksAI";
	ProviderType$1[ProviderType$1["MistralAI"] = 6] = "MistralAI";
	ProviderType$1[ProviderType$1["OpenRouter"] = 7] = "OpenRouter";
})(ProviderType || (ProviderType = {}));
const ProviderTypeNames = {
	[ProviderType.OpenAI]: "OpenAI",
	[ProviderType.Anthropic]: "Anthropic",
	[ProviderType.Groq]: "Groq",
	[ProviderType.Gemini]: "Gemini",
	[ProviderType.FireworksAI]: "FireworksAI",
	[ProviderType.MistralAI]: "MistralAI",
	[ProviderType.OpenRouter]: "OpenRouter"
};

//#endregion
//#region ../shared/dist/constants/browser-capture-kinds.js
/**
* Levr Browser capture kinds (ENG-7189 D1): the one place that says what each
* kind of browser capture is — its stored and wire types, file name, size
* cap, label and viewer. The router's reserve/finalise, the MCP "not saved"
* note, the gateway attach binding and the web client's Captures list all
* read this registry; none of them branches on a tool name.
*
* A capture tool names its kind on its `@levr/browser-protocol` spec
* (`captureKind`, a plain string: the extension never imports this package).
* Backender's `browser-captures.spec.ts` checks both sides list the same
* tools.
*
* Pure data, browser-safe, no imports.
*/
const MIB = 1024 * 1024;
const OCTET_STREAM = "application/octet-stream";
/**
* The slowest uplink a full-size capture upload is given time for: about
* 1.4 Mbit/s, so a 50 MiB recording gets 300 s (ENG-7189 D5, R1-C6).
*/
const CAPTURE_MIN_UPLINK_BITS_PER_SECOND = 14e5;
/** How long `maxBytes` takes at the minimum uplink, in whole seconds (ms). */
function uploadTimeoutFor(maxBytes) {
	return Math.ceil(maxBytes * 8 / CAPTURE_MIN_UPLINK_BITS_PER_SECOND) * 1e3;
}
const CAPTURE_KINDS = Object.freeze({
	screenshot: {
		id: "screenshot",
		labelKey: "browserCaptures.kindScreenshot",
		label: "Screenshot",
		noun: "screenshot",
		tools: ["browser_screenshot", "browser_screenshot_focused_tab"],
		mime: "image/png",
		uploadMime: "image/png",
		ext: "png",
		filenamePrefix: "screenshot",
		maxBytes: 50 * MIB,
		viewer: "image",
		formats: { jpeg: {
			mime: "image/jpeg",
			uploadMime: "image/jpeg",
			ext: "jpg"
		} },
		toolLabels: { browser_screenshot_focused_tab: {
			labelKey: "browserCaptures.kindFocusedTab",
			label: "Screenshot of the focused tab"
		} }
	},
	trace: {
		id: "trace",
		labelKey: "browserCaptures.kindTrace",
		label: "Performance trace",
		noun: "trace",
		tools: ["browser_stop_performance_trace"],
		mime: "application/json",
		uploadMime: OCTET_STREAM,
		ext: "json",
		filenamePrefix: "trace",
		maxBytes: 50 * MIB,
		uploadTimeoutMs: uploadTimeoutFor(50 * MIB),
		viewer: "trace"
	},
	console: {
		id: "console",
		labelKey: "browserCaptures.kindConsole",
		label: "Console log",
		noun: "console log",
		tools: ["browser_save_console_logs"],
		mime: "application/json",
		uploadMime: OCTET_STREAM,
		ext: "json",
		filenamePrefix: "console",
		maxBytes: 5 * MIB,
		viewer: "console"
	},
	har: {
		id: "har",
		labelKey: "browserCaptures.kindHar",
		label: "Network log",
		noun: "network log",
		tools: ["browser_save_har"],
		mime: "application/json",
		uploadMime: OCTET_STREAM,
		ext: "har",
		filenamePrefix: "network",
		maxBytes: 25 * MIB,
		uploadTimeoutMs: uploadTimeoutFor(25 * MIB),
		viewer: "har"
	},
	screencast: {
		id: "screencast",
		labelKey: "browserCaptures.kindRecording",
		label: "Recording",
		noun: "recording",
		tools: ["browser_stop_recording"],
		mime: "video/webm",
		uploadMime: "video/webm",
		ext: "webm",
		filenamePrefix: "recording",
		maxBytes: 50 * MIB,
		uploadTimeoutMs: uploadTimeoutFor(50 * MIB),
		viewer: "video"
	}
});
/** Every tool of every kind. */
const CAPTURE_KIND_TOOLS = Object.freeze(Object.values(CAPTURE_KINDS).flatMap((kind) => kind.tools));
/** Every wire Content-Type a capture upload may carry. */
const CAPTURE_UPLOAD_MIMES = Object.freeze([...new Set(Object.values(CAPTURE_KINDS).flatMap((kind) => [kind.uploadMime, ...Object.values(kind.formats ?? {}).map((f) => f.uploadMime)]))]);

//#endregion
//#region ../shared/dist/constants/first-task-nudge.constants.js
/**
* The day-after first-task nudge email's opt-out (ENG-6396, plan ENG-6341
* D13 — user decision 2026-10-12).
*
* The nudge is a one-time getting-started email, not a notification: it is
* sent by DEFAULT and is independent of `notification_preference` (whose
* email channel stays opt-in). A person stops it with
* `user_preference.first_task_nudge_email = false`, from Settings >
* Notifications or the one-click link in the email itself. The server job
* and the web client read the column through `wantsFirstTaskNudge`, and the
* email's link is built from `FIRST_TASK_NUDGE_OPT_OUT_PATH`, which the
* settings page recognises.
*/
/** The settings section that holds the toggle. */
const FIRST_TASK_NUDGE_SETTINGS_SECTION = "notifications";
/** Query parameter the email's opt-out link carries. */
const FIRST_TASK_NUDGE_OPT_OUT_PARAM = "opt-out";
/** The value of `FIRST_TASK_NUDGE_OPT_OUT_PARAM` that turns the nudge off. */
const FIRST_TASK_NUDGE_OPT_OUT_VALUE = "first-task-email";
/**
* Workspace-relative path of the email's one-click opt-out link (append it to
* `<client>/w/<url_key>`). Opening it turns the nudge off for the signed-in
* person and shows the setting, where it can be turned back on.
*/
const FIRST_TASK_NUDGE_OPT_OUT_PATH = `/settings/${FIRST_TASK_NUDGE_SETTINGS_SECTION}?${FIRST_TASK_NUDGE_OPT_OUT_PARAM}=${FIRST_TASK_NUDGE_OPT_OUT_VALUE}`;

//#endregion
//#region ../shared/dist/estimates/estimate-scale.js
/**
* T-shirt stored integer → label. 0 is the allow-zero tier.
*
* The gaps (no 4, 6, 7, …) are the point: these are Fibonacci values, not
* positions. `intToLabel` falls back to the raw number for anything absent, so
* a legacy ordinal that escaped the migration renders as "4" rather than
* silently masquerading as a size.
*/
const TSHIRT_LABEL_BY_INT = {
	0: "-",
	1: "XS",
	2: "S",
	3: "M",
	5: "L",
	8: "XL",
	13: "XXL",
	21: "XXXL"
};
const TSHIRT_INT_BY_LABEL = Object.fromEntries(Object.entries(TSHIRT_LABEL_BY_INT).map(([int, label]) => [label, Number(int)]));

//#endregion
//#region ../shared/dist/cycles/status-fixtures.js
/** Offset applied to fixture numbers so they cannot collide with real cycles. */
const ORDERING_NUMBER_BASE = 8100;
const ORDERING_FIXTURES = [
	{
		key: "renumbered",
		start_date: "2026-05-01",
		end_date: "2026-05-14",
		number: ORDERING_NUMBER_BASE + 5,
		because: "oldest start_date but the HIGHEST number — a back-dated create, a reassigned number, or an import. `number` ordering wrongly puts it first"
	},
	{
		key: "oldest",
		start_date: "2026-06-01",
		end_date: "2026-06-14",
		number: ORDERING_NUMBER_BASE + 1,
		because: "falls outside a window of 3 under the canonical ordering"
	},
	{
		key: "mid",
		start_date: "2026-06-15",
		end_date: "2026-06-28",
		number: ORDERING_NUMBER_BASE + 2,
		because: "the third and last member of the canonical window"
	},
	{
		key: "tied-early",
		start_date: "2026-07-01",
		end_date: "2026-07-14",
		number: ORDERING_NUMBER_BASE + 3,
		because: "shares a start_date with `tied-late`; the LOWER number, so it sorts second of the pair under DESC"
	},
	{
		key: "tied-late",
		start_date: "2026-07-01",
		end_date: "2026-07-14",
		number: ORDERING_NUMBER_BASE + 4,
		because: "shares a start_date with `tied-early`; the HIGHER number, so the tiebreaker must place it first"
	}
];

//#endregion
//#region ../shared/dist/runs/gate-command-pattern.js
/** Package managers, fetchers, interpreters, shells, and wrappers. */
const PATTERN_WRAPPER_PROGRAMS = [
	"yarn",
	"npm",
	"pnpm",
	"bun",
	"npx",
	"node",
	"deno",
	"tsx",
	"ts-node",
	"python",
	"python3",
	"ruby",
	"perl",
	"sh",
	"bash",
	"zsh",
	"pwsh",
	"env",
	"sudo",
	"timeout",
	"nice",
	"xargs"
];
/**
* Sub-fetchers and inline-code flags. A wrapper whose first fixed positional
* is one of these, or another wrapper, is too broad unless a later fixed
* positional is a real argument. Inline-code flags refuse even then.
*/
const PATTERN_SUB_FETCHERS = [
	"dlx",
	"exec",
	"x",
	"node",
	"run-script",
	"eval"
];
const PATTERN_INLINE_CODE_FLAGS = [
	"-e",
	"-c",
	"-p",
	"--eval",
	"--print",
	"--input-type"
];
/** git subcommands that do not modify the repository. */
const GIT_READ_ONLY_SUBCOMMANDS = [
	"status",
	"diff",
	"log",
	"show",
	"rev-parse",
	"ls-files",
	"blame",
	"grep",
	"describe",
	"shortlog",
	"name-rev",
	"cat-file",
	"rev-list",
	"version",
	"help",
	"annotate",
	"for-each-ref",
	"merge-base",
	"check-ignore",
	"check-attr",
	"count-objects",
	"var",
	"interpret-trailers"
];
const WRAPPERS = new Set(PATTERN_WRAPPER_PROGRAMS);
const SUB_FETCHERS = new Set(PATTERN_SUB_FETCHERS);
const INLINE_FLAGS = new Set(PATTERN_INLINE_CODE_FLAGS);
const GIT_READ_ONLY = new Set(GIT_READ_ONLY_SUBCOMMANDS);

//#endregion
//#region ../shared/dist/runs/evidence-utilities.js
/**
* Evidence Utilities — shared logic for creating issue_test_evidence records
* when execution results change status.
*
* Used by the backend (tq/run/run-result-variant.service.ts) after rollup
* to automatically record evidence. Can also be used by the client for
* optimistic evidence creation.
*/
/**
* The evidence vocabulary — the TypeScript source of truth (ENG-4257 D1).
*
* Mirrors BOTH per-table Postgres enums (`issue_test_evidence_evidence_type_enum`
* and `issue_automation_test_evidence_evidence_type_enum`), which are extended
* SEPARATELY — per-table enums are the codebase convention and the generator
* mints `{table}_{column}_enum`. The three-way agreement spec in
* `apps/backender/src/tq/evidence/evidence-vocabulary-agreement.spec.ts`
* asserts this tuple set-equals `Object.values` of both generated enums, so a
* value added to the specs without running codegen, or to one enum and not the
* other, fails a test instead of diverging silently.
*
* `superseded` is a RETRACTION, not an observation: a previously recorded
* verdict has been withdrawn (result reset to Retest/Pending, or its run
* deleted). The ledger is append-only and never mutates history — a retraction
* is a newer row that outranks the verdict it withdraws. (The one exception
* is a REWORDING, never a new observation: the ENG-5030 data migration
* retypes `pending` rows written for blocked results to `blocked` in place,
* because appending would stamp a fresh recorded_at and falsely outrank a
* later verdict.)
*
* `override` and `not_applicable` are EXCUSES, not observations either
* (ENG-4187): a human accepted the link's state and authorized completion
* anyway (`override`), or declared that the test cannot apply to this issue
* (`not_applicable`). Both carry a required `reason`, assert nothing about
* execution, and stand until newer evidence supersedes them. They classify to
* the `waived` verdict in link-verification.ts — never to `verified`, so the
* coverage widget does not count a waived link as covered.
*
* `pending` is an OBLIGATION, and the newest member. A run exists for this
* link and has not answered yet. It is what separates "queued, waiting" from
* "never run", which had no separate word before the vocabulary alignment —
* both read `unverified` and the projection could not tell a user which one
* they were looking at.
*
* It is written where every other verdict is written: run creation and a
* retest append a row, and the real verdict supersedes it by recency. The
* projection never queries `run_result` — `verified` and `failing` do not, and
* `pending` earns its place by working the same way.
*
* `blocked` is the other obligation (ENG-5030). The tester could not run the
* test — something external stopped it — so nothing was observed and an
* answer is still owed, exactly as with `pending`; what the word adds is WHY.
* ENG-5027 wrote `pending` for a Blocked result while Blocked had no storage
* type of its own; with the type real, the ledger says the honest thing.
* Classifies to `blocked` in link-verification.ts: blocks Done like
* `pending`, is not coverage, and never asserts a failure.
*/
const EVIDENCE_TYPES = [
	"detection",
	"pass",
	"fail",
	"regression",
	"verification",
	"flaky",
	"superseded",
	"override",
	"not_applicable",
	"pending",
	"skipped",
	"blocked"
];
/**
* [issue:ENG-6034] Which evidence kinds record an EXECUTION. The rest record a
* DECISION: nobody ran anything, so no executor may be attributed to them. A
* waiver (`override`, legacy `not_applicable`) and a retraction
* (`superseded`) are acts about the obligation; `pending` says an answer is
* owed; `skipped` is an abstention that reads as waived.
*
* `issue_test_evidence.executor_type` is NULL for decision rows. Every writer
* reads this one table — the client-write stamp in
* IssueTestEvidenceService.create, the server writer in
* RunResultVariantService, and the client's display helper
* (`evidenceExecutorType`) — so none can disagree about which rows had an
* executor.
*
* A `Record` over the whole union rather than a list of exceptions: adding a
* kind to `EVIDENCE_TYPES` without deciding here is a compile error, instead
* of the new kind silently defaulting to "an execution" and being stamped.
*/
const IS_EXECUTION = {
	detection: true,
	pass: true,
	fail: true,
	regression: true,
	verification: true,
	flaky: true,
	blocked: true,
	superseded: false,
	override: false,
	not_applicable: false,
	pending: false,
	skipped: false
};
const NOT_EXECUTED_EVIDENCE_TYPES = EVIDENCE_TYPES.filter((t) => !IS_EXECUTION[t]);

//#endregion
//#region ../shared/dist/runs/automation-failure.js
/**
* What counts as an automation FAILURE — defined once (ENG-6017, absorbs
* ENG-6141).
*
* An automation result is a failure when its status is `failed`, `errored`,
* `timed_out` or `interrupted`. Run-level surfaces always agreed on that; the
* test-level signals (health fail rate, worst offenders, suite ranking, flip
* rate, recent-results strip, PR comment) read `failed` alone, so a test that
* only errored, timed out or was interrupted looked healthy. Every consumer
* reads this module instead of keeping its own list:
*
* - backender `RED_AUTOMATION_RESULT_STATUS_TYPES` (gen automation-run-result
*   service) is built from `AUTOMATION_FAILURE_STATUS_TYPES`;
* - `AutomationBuilderService.tallyResult` and the rollup `errored_count` arm
*   (`rollup-aggregate.util.ts`) bucket `AUTOMATION_ERRORED_BUCKET_STATUS_TYPES`;
* - `TestHealthService` (transition and readout) and the client suite widget
*   compute the rate through `automationFailRate`;
* - widget-queries `automationFailRateExpr` is the SQL twin of
*   `automationFailRate` (drift-tested in `dialect-portability.test.ts`);
* - the flip-rate scorer, the recent-results strip and the PR comment list
*   filter on `AUTOMATION_FAILURE_STATUS_TYPES`;
* - the client status pill and the run-detail failed filter.
*
* Pure and browser-safe: no imports.
*/
/** Every automation result status that is a failure. */
const AUTOMATION_FAILURE_STATUS_TYPES = [
	"failed",
	"errored",
	"timed_out",
	"interrupted"
];
const FAILURE_SET = new Set(AUTOMATION_FAILURE_STATUS_TYPES);

//#endregion
//#region ../shared/dist/runs/link-verification.js
/** Latest-evidence types that satisfy a verifies/accepts link. */
const PASSING_EVIDENCE_TYPES = ["pass", "verification"];
/**
* The complement of PASSING_EVIDENCE_TYPES over the full vocabulary (ENG-4257
* D2) — DERIVED, never hand-written, so the coverage widget's inverted SQL
* predicate (D5) is built from the same list the classifier below is total
* over and cannot disagree with it. The partition test in
* link-verification.test.ts pins PASSING ∪ NON_PASSING = EVIDENCE_TYPES and
* PASSING ∩ NON_PASSING = ∅.
*/
const NON_PASSING_EVIDENCE_TYPES = EVIDENCE_TYPES.filter((t) => !PASSING_EVIDENCE_TYPES.includes(t));

//#endregion
//#region ../shared/dist/runs/gate-command-validation.js
/** Plain file and text inspection — the presence and pattern checks. */
const INSPECTION_BINARIES = [
	"grep",
	"test",
	"[",
	"[[",
	"wc",
	"cat",
	"head",
	"tail",
	"awk",
	"sed",
	"sort",
	"uniq",
	"echo",
	"printf",
	"tr",
	"cut",
	"diff",
	"find",
	"ls",
	"xargs",
	"cd",
	"timeout",
	"rg",
	"tee",
	"shellcheck",
	"actionlint",
	"jq",
	"cmp"
];
/**
* Arguments a binary may never be given — second R4 follow-up. `jq` (1.7.1,
* checked) has no in-place option; `-i` / `--in-place` are refused anyway so
* a jq build or wrapper that grew one (as `yq -i` and `sed -i` have) can
* never rewrite a file from a gate. A short-flag cluster holding `i` counts.
*/
const FORBIDDEN_ARGS = new Map([["jq", /(?:^|\s)(?:-[A-Za-z]*i[A-Za-z]*|--in-place)(?:=|\s|$)/]]);
/**
* A short option anywhere in a cluster, attached value or not: `-r x`,
* `-rx`, `-vr x`. A cluster is read only up to the first letter that takes a
* value (`valueLetters`): in `-cfoo.yml` the `c` takes `foo.yml`, so its `o`
* is part of a path, not a flag.
*/
function shortFlagArg(letter, valueLetters) {
	return /* @__PURE__ */ new RegExp(`(?:^|[\\s<>|;&(])-(?:(?![${valueLetters}])[A-Za-z])*${letter}`);
}
/**
* One argument flag, alone, with an attached `=value`, or run into a shell
* operator (`--report-path>x`): anything but another flag-name character
* ends it.
*/
function flagArg(flag) {
	return /* @__PURE__ */ new RegExp(`(?:^|[\\s<>|;&(])${flag.replace(/-/g, "\\-")}(?![A-Za-z0-9_-])`);
}
/**
* The words the shell would pass, split at whitespace AND at the operators
* that end a word (`--config=auto>/tmp/log` passes `--config=auto`), with
* one layer of surrounding quotes removed. A `#` that starts a word begins a
* comment, and a redirection's target (`>--metrics=off`, `2> x`) is a file,
* so neither is an argument.
*/
function argWords(rest) {
	return rest.replace(/(^|\s)#.*$/s, "").replace(/(?:(?<=^|[\s<>|;&()])\d+)?(?:<<?|>>?)&?\s*[^\s<>|;&()]*/g, " ").split(/[\s<>|;&()]+/).filter((word) => word.length > 0).map((word) => word.replace(/^(['"])(.*)\1$/, "$2"));
}
/**
* [issue:ENG-7618 D3.2] A config semgrep fetches from the network: a URL,
* `auto`, or a registry ruleset (`p/…`, `r/…`, `s/…`). Registry rules are
* downloaded at run time and are under the Semgrep Rules License.
*/
function isRemoteSemgrepConfig(value) {
	return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//") || value === "auto" || /^[prs]\//.test(value);
}
/**
* [issue:ENG-7618 D3.2] `semgrep scan` / `opengrep scan` must name a LOCAL
* rule set and turn telemetry off. Without an explicit `--config` semgrep
* picks one from its own default source (`SEMGREP_RULES`, or the registry
* depending on version) and sends metrics. Every spelling is read: `--config
* X`, `--config=X`, `-c X`, `-cX`, `-c=X`, `-f X`, `-fX` and `-f=X` for the
* config, and
* `--metrics X` / `--metrics=X` for metrics, of which the LAST one counts (so
* a trailing `--metrics=on` undoes an earlier `off`).
*/
/**
* semgrep's short options that take a value: `-c`/`-f` config, `-e`
* pattern, `-l` language, `-o` output, `-j` jobs.
*/
const SEMGREP_VALUE_LETTERS = /[cfeloj]/;
/** semgrep's long options that take the next word as their value. */
const SEMGREP_LONG_VALUE_FLAGS = new Set([
	"--pattern",
	"--lang",
	"--output",
	"--jobs",
	"--include",
	"--exclude",
	"--exclude-rule",
	"--severity",
	"--timeout",
	"--timeout-threshold",
	"--max-memory",
	"--max-target-bytes",
	"--max-chars-per-line",
	"--max-lines-per-finding",
	"--baseline-commit",
	"--project-root",
	"--replacement",
	"--sarif-output",
	"--json-output",
	"--text-output",
	"--emacs-output",
	"--vim-output",
	"--gitlab-sast-output",
	"--gitlab-secrets-output",
	"--junit-xml-output"
]);
function semgrepRequiredArgs(rest) {
	const words = argWords(rest);
	const configs = [];
	let metrics;
	for (let i = 0; i < words.length; i++) {
		const word = words[i] ?? "";
		const next = words[i + 1];
		let m;
		if (word === "--") break;
		if (word === "--config") {
			if (next !== void 0) configs.push(next);
			i++;
		} else if (m = /^--config=(.*)$/.exec(word)) configs.push(m[1] ?? "");
		else if (m = /^-([A-Za-z]+)(=?)(.*)$/.exec(word)) {
			const letters = m[1] ?? "";
			const at = letters.search(SEMGREP_VALUE_LETTERS);
			if (at === -1) continue;
			const attached = letters.slice(at + 1) + (m[2] ?? "") + (m[3] ?? "");
			const value = attached.replace(/^=/, "");
			const isConfig = letters[at] === "c" || letters[at] === "f";
			if (attached.length > 0) {
				if (isConfig) configs.push(value);
			} else if (next !== void 0) {
				if (isConfig) configs.push(next);
				i++;
			}
		} else if (word === "--metrics") {
			metrics = next;
			i++;
		} else if (m = /^--metrics=(.*)$/.exec(word)) metrics = m[1];
		else if (SEMGREP_LONG_VALUE_FLAGS.has(word)) i++;
	}
	const named = configs.filter((value) => value.length > 0);
	if (named.length === 0) return "must name a local rule set with --config <path>";
	const globbed = named.find((value) => /[*?[\]{}]/.test(value));
	if (globbed !== void 0) return `may not use the glob config "${globbed}": name the rule set's path`;
	const remote = named.find(isRemoteSemgrepConfig);
	if (remote !== void 0) return `may not use the remote config "${remote}" (a URL, auto, or a p/ r/ s/ registry ruleset); point --config at a local path`;
	if (metrics !== "off") return `must turn telemetry off with --metrics=off (the last --metrics value counts); found ${metrics === void 0 ? "no --metrics argument" : `--metrics=${metrics}`}`;
	return null;
}
const SEMGREP_RULE = {
	globals: /^/,
	allowed: new Set(["scan"]),
	refuseUncheckable: true,
	forbiddenArgs: [
		{
			pattern: flagArg("--output"),
			name: "--output"
		},
		{
			pattern: shortFlagArg("o", "cfelj"),
			name: "-o"
		},
		{
			pattern: /(?:^|[\s<>|;&(])--[a-z0-9-]+-output(?![A-Za-z0-9_-])/,
			name: "--<format>-output"
		},
		{
			pattern: flagArg("--autofix"),
			name: "--autofix"
		},
		{
			pattern: flagArg("--fix"),
			name: "--fix"
		}
	],
	requiredArgs: semgrepRequiredArgs
};
const SUBCOMMAND_ALLOWLISTS = new Map([
	["git", {
		globals: /^(?:(?:-C\s+\S+|--no-pager|--no-optional-locks)\s+)*/,
		allowed: new Set([
			"diff",
			"diff-tree",
			"diff-index",
			"diff-files",
			"log",
			"shortlog",
			"show",
			"show-ref",
			"status",
			"ls-files",
			"ls-tree",
			"ls-remote",
			"grep",
			"rev-parse",
			"rev-list",
			"merge-base",
			"cat-file",
			"blame",
			"for-each-ref",
			"describe",
			"name-rev",
			"check-ignore",
			"check-attr"
		]),
		forbiddenArgs: [{
			pattern: flagArg("--output"),
			name: "--output (it writes a file)"
		}]
	}],
	["helm", {
		globals: /^/,
		allowed: new Set(["lint", "template"])
	}],
	["gitleaks", {
		globals: /^/,
		allowed: new Set(["dir", "detect"]),
		refuseUncheckable: true,
		forbiddenArgs: [
			{
				pattern: flagArg("--report-path"),
				name: "--report-path"
			},
			{
				pattern: flagArg("--diagnostics"),
				name: "--diagnostics"
			},
			{
				pattern: flagArg("--diagnostics-dir"),
				name: "--diagnostics-dir"
			},
			{
				pattern: shortFlagArg("r", "cibfls"),
				name: "-r"
			}
		]
	}],
	["semgrep", SEMGREP_RULE],
	["opengrep", SEMGREP_RULE],
	["trivy", {
		globals: /^/,
		allowed: new Set(["fs", "config"]),
		refuseUncheckable: true,
		forbiddenArgs: [
			{
				pattern: flagArg("--output"),
				name: "--output"
			},
			{
				pattern: shortFlagArg("o", "cfst"),
				name: "-o"
			},
			{
				pattern: flagArg("--download-db-only"),
				name: "--download-db-only"
			},
			{
				pattern: flagArg("--download-java-db-only"),
				name: "--download-java-db-only"
			},
			{
				pattern: flagArg("--server"),
				name: "--server"
			},
			{
				pattern: flagArg("--cache-dir"),
				name: "--cache-dir"
			},
			{
				pattern: flagArg("--module-dir"),
				name: "--module-dir"
			},
			{
				pattern: flagArg("--db-repository"),
				name: "--db-repository"
			},
			{
				pattern: flagArg("--java-db-repository"),
				name: "--java-db-repository"
			},
			{
				pattern: flagArg("--checks-bundle-repository"),
				name: "--checks-bundle-repository"
			},
			{
				pattern: flagArg("--cache-backend"),
				name: "--cache-backend"
			},
			{
				pattern: /(?:^|[\s<>|;&(])--redis-[a-z-]+(?![A-Za-z0-9_-])/,
				name: "--redis-*"
			},
			{
				pattern: flagArg("--rekor-url"),
				name: "--rekor-url"
			},
			{
				pattern: flagArg("--sbom-sources"),
				name: "--sbom-sources"
			},
			{
				pattern: flagArg("server"),
				name: "server"
			}
		]
	}]
]);
/**
* ENG-5106 L1 review round 3 F-003 — the utility `xargs` runs: the first word
* after its options, skipping each option's VALUE (`-n 1`, `-I {}`,
* `--max-args 1`; attached forms `-n1`, `--max-args=1` carry their own).
* A prefix regex let `xargs -n 1 test -n` through as a non-`test` command.
*/
const XARGS_SHORT_WITH_VALUE = new Set([
	"a",
	"d",
	"E",
	"I",
	"L",
	"n",
	"P",
	"s"
]);
const XARGS_LONG_WITH_VALUE = new Set([
	"--arg-file",
	"--delimiter",
	"--max-args",
	"--max-procs",
	"--max-chars",
	"--process-slot-var"
]);
/**
* Review round 4 F-004 / F-009 — what `xargs` may run: read-only utilities.
* Parsing every way to reach `test` (bundled `-rn 1`, quoted `'test'`,
* `timeout 5 test`, `env test`, `sh -c 'test …'`) was a losing game; live
* gates use `grep` alone. Anything else is refused.
*/
const XARGS_UTILITIES = new Set([
	"grep",
	"egrep",
	"fgrep",
	"rg",
	"wc",
	"cat",
	"head",
	"tail",
	"ls",
	"basename",
	"dirname",
	"stat",
	"file",
	"echo",
	"printf",
	"sort",
	"uniq",
	"cut",
	"tr",
	"jq"
]);
/**
* The utility `xargs` runs and that utility's own arguments. Quoted words
* arrive already masked to `""` by `scanShellCommand`, so a quoted utility
* is the empty string here — and is refused like any other.
*/
function xargsUtility(args) {
	const words = args.trim().split(/\s+/).filter(Boolean);
	const at = (k) => k < words.length ? {
		utility: words[k],
		rest: words.slice(k + 1).join(" ")
	} : null;
	for (let k = 0; k < words.length; k++) {
		const w = words[k];
		if (w === "--") return at(k + 1);
		if (w.startsWith("--")) {
			if (!w.includes("=") && XARGS_LONG_WITH_VALUE.has(w)) k++;
			continue;
		}
		if (w.startsWith("-") && w.length > 1) {
			for (let j = 1; j < w.length; j++) if (XARGS_SHORT_WITH_VALUE.has(w[j])) {
				if (j === w.length - 1) k++;
				break;
			}
			continue;
		}
		return at(k);
	}
	return null;
}
const baseName = (word) => word.slice(word.lastIndexOf("/") + 1);
function isTestUtility(word) {
	if (word === null) return false;
	const base = baseName(word);
	return base === "test" || base === "[";
}
/**
* The refusal for a subcommand-restricted binary, or null when this use is
* allowed (or the binary is not restricted).
*/
function subcommandRefusal(token, args) {
	const xargsRuns = token === "xargs" ? xargsUtility(args) : null;
	if (xargsRuns !== null && isTestUtility(xargsRuns.utility)) return "\"xargs test\" passes on empty input, so this check cannot fail (ENG-4761). Redeploy the gate: current templates test the search result with test -n \"$(…)\"";
	if (xargsRuns !== null) {
		const utility = baseName(xargsRuns.utility);
		if (!XARGS_UTILITIES.has(utility)) return `"xargs" may only run a read-only utility (${[...XARGS_UTILITIES].join(", ")}), not ` + (utility === "\"\"" || utility === "" ? "a quoted word" : `"${utility}"`);
		return subcommandRefusal(utility, xargsRuns.rest);
	}
	if (FORBIDDEN_ARGS.get(token)?.test(args)) return `"${token}" may not edit a file in place (-i / --in-place)`;
	const rule = SUBCOMMAND_ALLOWLISTS.get(token);
	if (!rule) return null;
	const rest = args.replace(rule.globals, "");
	const sub = rest.split(/\s+/)[0] ?? "";
	if (!rule.allowed.has(sub)) return `"${token} ${sub || "(no subcommand)"}" is not allowed; ${token} may only run ${[...rule.allowed].join(", ")}`;
	const words = rest.split(/\s+/).filter(Boolean);
	const uncheckable = rule.refuseUncheckable ? words.find((w) => {
		if (w.includes("\"\"") || w.includes("\\") || w.includes("$")) return true;
		if (/\{[^{}]*(?:,|\.\.)[^{}]*\}/.test(w)) return true;
		return /[*?[]/.test(w);
	}) : void 0;
	if (uncheckable !== void 0) return `"${token} ${sub}" may not quote, escape or expand an argument (${uncheckable}): the word the shell runs could not be checked`;
	const refusedArg = rule.forbiddenArgs?.find(({ pattern }) => pattern.test(rest));
	if (refusedArg) return `"${token} ${sub}" may not use ${refusedArg.name}`;
	const missing = rule.requiredArgs?.(rest);
	if (missing) return `"${token} ${sub}" ${missing}`;
	return null;
}
/** Interpreters and shells the seeded templates and L3/L4 gates use. */
const INTERPRETER_BINARIES = [
	"node",
	"python3",
	"python",
	"bash",
	"sh",
	"perl",
	"ruby",
	"php"
];
/**
* Package managers, build tools and test runners a command binding may
* supply — review R4-01. Every toolchain the binding docs and specs name
* (`running-gates.mdx`, `gate-bindings.tool.spec.ts`,
* `gate-type-resolver-command-slots.spec.ts`, the toolchain migration).
*/
const GATE_TOOLCHAIN_BINARIES = [
	"yarn",
	"npx",
	"npm",
	"pnpm",
	"bun",
	"bunx",
	"deno",
	"tsc",
	"tsgo",
	"go",
	"cargo",
	"pytest",
	"uv",
	"poetry",
	"pipenv",
	"hatch",
	"tox",
	"phpunit",
	"pest",
	"composer",
	"bundle",
	"rspec",
	"rake",
	"mvn",
	"gradle",
	"dotnet",
	"swift",
	"mix",
	"make"
];
/** Semantic judges (L4), invoked directly or piped into. */
const GATE_JUDGE_BINARIES = [
	"agy",
	"codex",
	"gemini"
];
/**
* Every binary a gate command may start a command with, in one list — what a
* refusal message names.
*/
const GATE_COMMAND_BINARIES = [
	...INSPECTION_BINARIES,
	...INTERPRETER_BINARIES,
	...GATE_TOOLCHAIN_BINARIES,
	...GATE_JUDGE_BINARIES
];
const ALLOWED_BINARIES = new Set(GATE_COMMAND_BINARIES);
/**
* Shell builtins a command may be. `exit`/`true`/`false` end real gates
* (`…; exit $?`); `set -e`/`set -o pipefail` and `read` are common in
* multi-line checks; `:` is the no-op. `export` is handled separately (it
* must only assign).
*/
const ALLOWED_BUILTINS = new Set([
	"exit",
	"true",
	"false",
	"set",
	"read",
	":"
]);
/**
* Runners a project installs locally and invokes by path — review R4-01
* (`./vendor/bin/phpunit` on prod ENG-113..115, `node_modules/.bin/vitest`).
*/
const PROJECT_LOCAL_RUNNERS = new Set([
	"phpunit",
	"pest",
	"paratest",
	"phpstan",
	"psalm",
	"rspec",
	"rake",
	"vitest",
	"jest",
	"playwright",
	"mocha",
	"tsc",
	"tsx",
	"eslint",
	"pytest"
]);
/**
* Is `token` a project-local runner (`./vendor/bin/phpunit`,
* `vendor/bin/pest`, `./node_modules/.bin/vitest`, `bin/rspec`) or a build
* wrapper checked into the repo (`./gradlew`, `./mvnw`)?
*/
function isProjectLocalTool(token) {
	if (token === "./gradlew" || token === "./mvnw") return true;
	const m = /^(?:\.\/)?(?:vendor\/bin|node_modules\/\.bin|bin)\/([\w.-]+)$/.exec(token);
	return m !== null && PROJECT_LOCAL_RUNNERS.has(m[1]);
}
/** Binaries `!` may negate — review R4-03. */
const NEGATABLE_BINARIES = new Set([
	"grep",
	"test",
	"[",
	"[["
]);
function isAllowedBinary(token) {
	return ALLOWED_BINARIES.has(token) || ALLOWED_BUILTINS.has(token) || token.endsWith("/grep") || isProjectLocalTool(token);
}
/**
* Words after which the next word is again in command position: compound
* openers and `!`. Review round 4 F-001 added `if`, `while`, `until` and `!`
* (`if case x in x) touch M ;; esac; then …` slipped past without them).
*/
const COMMAND_OPENERS = new Set([
	"then",
	"do",
	"else",
	"elif",
	"if",
	"while",
	"until",
	"{",
	"!"
]);
/**
* Is `s[i]` at the start of a word in COMMAND position — the start of the
* text (`from`), or after `;` `|` `&` `(` `)` a newline, or after an opener
* word that is itself in command position? A loop, not recursion (review
* round 4 F-013: 40 KB of `then ` overflowed the stack).
*/
function isInCommandPosition(s, i, from) {
	let at = i;
	for (;;) {
		let p = at - 1;
		while (p >= from && (s[p] === " " || s[p] === "	")) p--;
		if (p < from) return true;
		if (";|&()\n".includes(s[p])) return true;
		let q = p;
		while (q >= from && /[a-z{!]/.test(s[q])) q--;
		const word = s.slice(q + 1, p + 1);
		if (!(q < from || /[\s;|&()]/.test(s[q])) || !COMMAND_OPENERS.has(word)) return false;
		if (q < from) return true;
		at = q + 1;
	}
}
/**
* Review round 4 (root cause A) — what this scanner does NOT model, it
* REFUSES rather than guesses. Each of these makes bash read the text
* differently from `scanShellCommand`, and every one was reproduced
* running a command the validator never saw:
*
*  - `$'…'` anywhere (ANSI-C quoting: `\'` does not end it);
*  - a heredoc `<<` anywhere (its body is data to bash, commands to us);
*  - inside a `$( … )`, `<( … )` or `>( … )`: a word-start `#` (a comment
*    can hide the `)`), a `${` (`${x/)/y}` ends the substitution early for
*    us), or `case` in command position (its pattern `)`s).
*
* Review round 6 F-001: process substitutions are bodies bash runs exactly
* like `$( )`, so they are read the same way — `grep x <(echo #)` followed
* by a newline and `touch p` ran the `touch` while this looked only at `$(`.
*
* Measured against every live gate step on staging (10,643; 6,217
* accepted today): none uses any of these.
*/
function unmodelledConstruct(t, inSubstitution = false) {
	let quote = null;
	for (let i = 0; i < t.length; i++) {
		const c = t[i];
		if (quote === "'") {
			if (c === "'") quote = null;
			continue;
		}
		if (c === "\\") {
			i++;
			continue;
		}
		if (c === "$" && t[i + 1] === "(") {
			const close = closeOfParen(t, i + 2);
			if (close === -1) return null;
			const inner = unmodelledConstruct(t.slice(i + 2, close - 1), true);
			if (inner) return inner;
			i = close - 1;
			continue;
		}
		if (quote === "\"") {
			if (c === "\"") quote = null;
			else if (inSubstitution && c === "$" && t[i + 1] === "{") return "`${` inside a substitution";
			continue;
		}
		if ((c === "<" || c === ">") && t[i + 1] === "(") {
			const close = closeOfParen(t, i + 2);
			if (close === -1) return null;
			const inner = unmodelledConstruct(t.slice(i + 2, close - 1), true);
			if (inner) return inner;
			i = close - 1;
			continue;
		}
		if (c === "'" || c === "\"") {
			if (c === "'" && t[i - 1] === "$") return "`$'…'` quoting";
			quote = c;
			continue;
		}
		if (c === "<" && t[i + 1] === "<" && t[i + 2] !== "<" && t[i - 1] !== "<") return "a heredoc (`<<`)";
		if (!inSubstitution) continue;
		if (c === "#" && (i === 0 || /[\s;|&(]/.test(t[i - 1]))) return "a `#` comment inside a substitution";
		if (c === "$" && t[i + 1] === "{") return "`${` inside a substitution";
		if (c === "c" && t.startsWith("case", i) && /^(?:\s|$)/.test(t.slice(i + 4, i + 5)) && (i === 0 || /[\s;|&()]/.test(t[i - 1])) && isInCommandPosition(t, i, 0)) return "`case` inside a substitution";
	}
	return null;
}
/**
* Index just past the `)` that closes a `(` whose body starts at `from`, or
* -1. Quote-aware: a `)` inside quotes does not close it.
*
* Exported for `splitRespectingQuotes` (ENG-5106 L1 review F-017): the
* splitter that decides what the executor RUNS must read a substitution
* exactly as this validator does, so there is one copy.
*/
function closeOfParen(s, from) {
	let depth = 1;
	let quote = null;
	const cases = [];
	const wordAt = (i, word) => s.startsWith(word, i) && /^(?:[\s;|&)]|$)/.test(s.slice(i + word.length, i + word.length + 1)) && isInCommandPosition(s, i, from);
	for (let i = from; i < s.length; i++) {
		const c = s[i];
		if (quote === "'") {
			if (c === "'") quote = null;
			continue;
		}
		if (c === "\\") {
			i++;
			continue;
		}
		if (quote === "\"") {
			if (c === "\"") quote = null;
			continue;
		}
		if (c === "'" || c === "\"") quote = c;
		else if (c === "c" && wordAt(i, "case")) {
			cases.push(depth);
			i += 3;
		} else if (c === "e" && wordAt(i, "esac") && cases.at(-1) === depth) {
			cases.pop();
			i += 3;
		} else if (c === "(") depth++;
		else if (c === ")") {
			if (cases.at(-1) === depth) continue;
			if (--depth === 0) return i + 1;
		}
	}
	return -1;
}
/**
* Split a command at every top-level shell separator, and collect every
* substitution the shell would EXECUTE — ENG-5967 F-008, review R4-09.
*
* Single quotes are the one context the shell does not look inside, so a
* `$(` there is literal (the L4 templates' `bash -c '…'` body) and is not
* collected; in double quotes and bare text it runs, and is. A process
* substitution (`<( )`, `>( )`) runs only unquoted. `$(( … ))` is arithmetic,
* not a command: only the substitutions inside it are collected.
*/
function scanShellCommand(s) {
	const segments = [];
	const substitutions = [];
	let backtick = false;
	let unbalanced = false;
	let cur = "";
	let quote = null;
	const cut = (sepAfter) => {
		segments.push({
			text: cur,
			sepAfter
		});
		cur = "";
	};
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (quote === "'") {
			if (c === "'") quote = null;
			continue;
		}
		if (c === "\\") {
			if (quote === null) cur += s.slice(i, i + 2);
			i++;
			continue;
		}
		if (c === "`") {
			backtick = true;
			continue;
		}
		if (c === "$" && s[i + 1] === "(") {
			const arithmetic = s[i + 2] === "(";
			const close = closeOfParen(s, i + 2);
			if (close === -1) {
				unbalanced = true;
				break;
			}
			const body = s.slice(i + 2, close - 1);
			if (arithmetic) {
				const inner = scanShellCommand(body.slice(1, -1));
				substitutions.push(...inner.substitutions);
				backtick ||= inner.backtick;
				unbalanced ||= inner.unbalanced;
			} else substitutions.push(body);
			if (quote === null) cur += "\"\"";
			i = close - 1;
			continue;
		}
		if (quote === "\"") {
			if (c === "\"") quote = null;
			continue;
		}
		if ((c === "<" || c === ">") && s[i + 1] === "(") {
			const close = closeOfParen(s, i + 2);
			if (close === -1) {
				unbalanced = true;
				break;
			}
			substitutions.push(s.slice(i + 2, close - 1));
			cur += "\"\"";
			i = close - 1;
			continue;
		}
		if (c === "'" || c === "\"") {
			quote = c;
			cur += "\"\"";
			continue;
		}
		if (c === ";" || c === "\n") {
			cut(";");
			continue;
		}
		if (c === "|") {
			if (s[i + 1] === "|") {
				i++;
				cut("||");
			} else cut("|");
			continue;
		}
		if (c === "&") {
			const prev = s[i - 1];
			if (prev === ">" || prev === "<" || s[i + 1] === ">") {
				cur += c;
				continue;
			}
			if (s[i + 1] === "&") {
				i++;
				cut("&&");
			} else cut("&");
			continue;
		}
		cur += c;
	}
	if (quote !== null) unbalanced = true;
	cut(null);
	return {
		segments,
		substitutions,
		backtick,
		unbalanced
	};
}
/** Reserved words that OPEN or CONTINUE a compound command before a command. */
const LEADING_RESERVED = /^(?:if|then|elif|else|do|while|until)(?=\s|$)\s*/;
/** Words that CLOSE a compound command; nothing runs from them. */
const CLOSING_WORDS = /^(?:fi|done|esac|\}|\)+)(?=\s|$|\)|;)/;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=\S*(?:\s+|$)/;
/**
* [issue:ENG-7618 review N1] A scanner reads every option it has from an
* environment variable too (`TRIVY_OUTPUT`, `TRIVY_CACHE_DIR`,
* `TRIVY_DB_REPOSITORY`, …), so a gate setting one reaches each option the
* scanner rules refuse without ever typing the flag. A gate command may not
* set any variable in a scanner's namespace, by assignment, `export` or `env`.
*/
const SCANNER_ENV_NAME = /^(?:TRIVY|SEMGREP|GITLEAKS)_/;
const SCANNER_ENV_REFUSAL = "may not set a scanner's environment variables (TRIVY_*, SEMGREP_*, GITLEAKS_*): each reaches an option the scanner rules refuse";
const SCANNER_TOKENS = new Set([
	"trivy",
	"semgrep",
	"opengrep",
	"gitleaks"
]);
/** A scanner's config and ignore files, which a gate must not write. */
const SCANNER_CONFIG_FILE = /(?:^|\/)(?:trivy\.ya?ml|\.trivy[^\s/]*|\.gitleaks[^\s/]*|\.semgrep[^\s/]*)$/;
/**
* [issue:ENG-7618 review round 3] Checks for a command that runs a scanner,
* over the routes that reach a refused option without typing its flag. They
* are DEFENCE IN DEPTH, not the boundary: a command slot is supplied only by
* an Owner or Admin (the gate-impl capability, GateImplPolicyService), and a
* text checker cannot model everything bash can do. What is refused:
* - `set -a` / `set -o allexport`, under which `read` and `printf -v`
*   export what they assign (F1); and `read` / `printf -v` into a scanner
*   variable anywhere (F1);
* - writing a scanner config or ignore file by redirect or `tee`: trivy loads
*   `trivy.yaml` from the working directory unasked (F2);
* - a `--config` / `-c` that is absolute or climbs out with `..` (F2);
* - setting HOME, TMPDIR, XDG_* or a proxy variable, which move trivy's cache
*   and route its downloads (F3).
*/
function scannerCommandRefusal(command) {
	const words = command.split(/[\s;&|()]+/).filter(Boolean);
	if (/(?:^|[\s;&|(])(?:read|printf)\b[^;&|]*?\b(?:TRIVY|SEMGREP|GITLEAKS)_/.test(command)) {
		if (/(?:^|[\s;&|(])read\s(?:[^;&|]*\s)?(?:TRIVY|SEMGREP|GITLEAKS)_\w*/.test(command) || /(?:^|[\s;&|(])printf\s+(?:-\S+\s+)*-v\s*(?:TRIVY|SEMGREP|GITLEAKS)_/.test(command)) return SCANNER_ENV_REFUSAL;
	}
	if (!words.some((w) => SCANNER_TOKENS.has(w))) return null;
	if (/(?:^|[\s;&|(])set\s+(?:-o\s+allexport\b|(?:\S+\s+)*-[A-Za-z]*a[A-Za-z]*(?:\s|$))/.test(command) || /(?:^|[\s;&|(])set\s+(?:\S+\s+)*-o\s+allexport\b/.test(command)) return "may not turn on `set -a` / `set -o allexport` in a command that runs a scanner: what it assigns reaches the scanner as environment variables";
	const redirected = [...command.matchAll(/>{1,2}\|?\s*(['"]?)([^\s;&|<>'"]+)\1/g)].map((m) => m[2]);
	const teed = [...command.matchAll(/(?:^|[\s;&|(])tee\s+((?:-\S+\s+)*)([^\s;&|<>]+)/g)].map((m) => m[2]);
	const written = [...redirected, ...teed].find((t) => SCANNER_CONFIG_FILE.test(t));
	if (written) return `may not write the scanner config file ${written}: a scanner reads it as its options`;
	for (const m of command.matchAll(/(?:^|[\s;&|(])(?:--config(?:=|\s+)|-c\s*=?\s*)(['"]?)([^\s;&|<>'"]+)\1/g)) {
		const value = m[2];
		if (value.startsWith("//") || value.includes("://")) continue;
		if (value.startsWith("/") || value.startsWith("~") || /(?:^|\/)\.\.(?:\/|$)/.test(value)) return `a scanner --config must be a path inside the repository (no leading /, ~ or ..); got ${value}`;
	}
	if (/(?:^|[\s;&|(])(?:export\s+(?:\S+\s+)*|env\s+(?:\S+\s+)*)?(?:HOME|TMPDIR|XDG_[A-Z_]+|(?:HTTPS?|ALL|NO|FTP)_PROXY|(?:https?|all|no|ftp)_proxy)\+?=/.test(command)) return "may not set HOME, TMPDIR, XDG_* or a proxy variable in a command that runs a scanner: they move its cache and route its downloads";
	return null;
}
const ENV_WRAPPER = /^env(?:\s+(?:-i|-0|--ignore-environment|--null|-u\s+\S+|--unset=\S+|[A-Za-z_][A-Za-z0-9_]*=\S*))*\s+(?=\S)/;
const FUNCTION_DEF = /^(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\s*\)\s*/;
/**
* Read one top-level segment: strip the shell grammar in front of its command
* and say which binary it runs (or that it runs nothing).
*/
function readSegment(segment, state) {
	let p = segment.trim();
	let negated = false;
	for (let guard = 0; guard < 64; guard++) {
		if (!p) return { kind: "skip" };
		if (state.inCase) {
			if (/^esac(?=\s|$|;|\))/.test(p)) {
				state.inCase = false;
				p = p.slice(4).trim();
				continue;
			}
			const arm = /^\(?[^\s()]*\)\s*/.exec(p);
			if (arm) {
				p = p.slice(arm[0].length);
				continue;
			}
			if (/^[^\s()]+$/.test(p)) return { kind: "skip" };
		}
		const caseHead = /^case\s+\S+\s+in(?=\s|$)\s*/.exec(p);
		if (caseHead) {
			state.inCase = true;
			p = p.slice(caseHead[0].length);
			continue;
		}
		if (/^for(?=\s|\(\()/.test(p)) return { kind: "skip" };
		if (CLOSING_WORDS.test(p)) return { kind: "skip" };
		const reserved = LEADING_RESERVED.exec(p);
		if (reserved) {
			p = p.slice(reserved[0].length);
			continue;
		}
		if (p.startsWith("{") && (p.length === 1 || /\s/.test(p[1]))) {
			p = p.slice(1).trim();
			continue;
		}
		if (p.startsWith("(") && !p.startsWith("((")) {
			p = p.slice(1).trim();
			continue;
		}
		if (p.startsWith("((")) return { kind: "skip" };
		if (/^!(?=\s|$)/.test(p)) {
			negated = true;
			p = p.slice(1).trim();
			if (!p) return {
				kind: "invalid",
				reason: "a bare `!` negates nothing"
			};
			continue;
		}
		const fn = FUNCTION_DEF.exec(p);
		if (fn) {
			state.functions.add(fn[1]);
			p = p.slice(fn[0].length);
			continue;
		}
		const assignment = ASSIGNMENT.exec(p);
		if (assignment) {
			if (SCANNER_ENV_NAME.test(assignment[0])) return {
				kind: "invalid",
				reason: SCANNER_ENV_REFUSAL
			};
			p = p.slice(assignment[0].length);
			if (!p) return { kind: "skip" };
			continue;
		}
		const env = ENV_WRAPPER.exec(p);
		if (env) {
			if (env[0].split(/\s+/).some((w) => w.includes("=") && SCANNER_ENV_NAME.test(w))) return {
				kind: "invalid",
				reason: SCANNER_ENV_REFUSAL
			};
			p = p.slice(env[0].length);
			continue;
		}
		break;
	}
	if (!p) return { kind: "skip" };
	const token = p.split(/\s+/)[0].replace(/\)+$/, "");
	if (!token) return { kind: "skip" };
	if (token === "export") {
		const args$1 = p.split(/\s+/).slice(1);
		if (!args$1.every((a) => /^[A-Za-z_][A-Za-z0-9_]*(?:=\S*)?$/.test(a))) return {
			kind: "invalid",
			reason: "`export` may only name or assign variables"
		};
		if (args$1.some((a) => SCANNER_ENV_NAME.test(a))) return {
			kind: "invalid",
			reason: SCANNER_ENV_REFUSAL
		};
		return { kind: "skip" };
	}
	const args = p.slice(p.split(/\s+/)[0].length).trim();
	if (token === "timeout") {
		const wrapped = timeoutCommand(args);
		if (wrapped === null) return {
			kind: "invalid",
			reason: "`timeout` must name the command it runs"
		};
		const inner = readSegment(wrapped, state);
		return inner.kind === "command" ? {
			...inner,
			negated
		} : inner;
	}
	return {
		kind: "command",
		token,
		negated,
		args
	};
}
/**
* The command `timeout` runs: what follows its options and its DURATION
* (GNU and BSD `timeout`: `-s SIG`, `-k DUR`, `--signal=SIG`,
* `--kill-after=DUR`, `--preserve-status`, `--foreground`, `-v`), or null
* when there is none.
*/
function timeoutCommand(args) {
	const words = args.split(/\s+/).filter(Boolean);
	let k = 0;
	while (k < words.length) {
		const w = words[k];
		if (w === "--") {
			k++;
			break;
		}
		if (w === "-s" || w === "-k" || w === "--signal" || w === "--kill-after") {
			k += 2;
			continue;
		}
		if (w.startsWith("-")) {
			k++;
			continue;
		}
		break;
	}
	const rest = words.slice(k + 1);
	return rest.length > 0 ? rest.join(" ") : null;
}
/**
* Validates that a gate command is well-constructed. Returns null when it may
* be handed out and run, or the reason it may not.
*/
function validateGateCommand(command, technique) {
	const who = technique ? `${technique} command` : "Gate command";
	const trimmed = command.trim();
	if (trimmed.startsWith("@api:")) return null;
	if (!trimmed) return null;
	const unmodelled = unmodelledConstruct(trimmed);
	if (unmodelled) return `${who} uses ${unmodelled}, which this checker cannot read the way bash does; rewrite it without`;
	const scanned = scanShellCommand(trimmed);
	if (scanned.backtick) return `${who} uses a backtick command substitution; write $( … ) so its command can be checked`;
	if (scanned.unbalanced) return `${who} has an unterminated quote or substitution`;
	const scannerRefusal = scannerCommandRefusal(trimmed);
	if (scannerRefusal) return `${who}: ${scannerRefusal}`;
	const state = {
		inCase: false,
		functions: /* @__PURE__ */ new Set()
	};
	const reads = scanned.segments.map((segment) => segment.text.trim().startsWith("@api:") ? { kind: "skip" } : readSegment(segment.text, state));
	for (let i = 0; i < reads.length; i++) {
		const read = reads[i];
		if (read.kind === "skip") continue;
		if (read.kind === "invalid") return `${who}: ${read.reason}`;
		const { token, negated } = read;
		const refusedUse = subcommandRefusal(token, read.args);
		if (refusedUse !== null) return `${who}: ${refusedUse}`;
		if (!isAllowedBinary(token) && !SUBCOMMAND_ALLOWLISTS.has(token) && !state.functions.has(token)) return `${who} uses disallowed binary "${token}". Allowed: ${GATE_COMMAND_BINARIES.join(", ")}; and with read-only subcommands only: ${[...SUBCOMMAND_ALLOWLISTS.keys()].join(", ")}`;
		if (negated) {
			let last = i;
			while (scanned.segments[last].sepAfter === "|" && last + 1 < reads.length) last++;
			const tail = reads[last];
			const tailToken = tail.kind === "command" ? tail.token : token;
			if (!NEGATABLE_BINARIES.has(tailToken) && !tailToken.endsWith("/grep")) return `${who} negates "${tailToken}" with \`!\`; only grep and test may be negated — a negated test runner or typecheck turns a failure into exit 0`;
		}
	}
	for (const inner of scanned.substitutions) {
		if (!inner.trim()) return `${who} has an empty substitution`;
		const problem = validateGateCommand(inner, technique);
		if (problem) return `${problem} (inside a $( ), <( ) or >( ) substitution)`;
	}
	return null;
}

//#endregion
//#region ../shared/dist/runs/gate-verdict.js
/**
* Wrapper commands that run the command after them — ENG-5967 review R3-03.
* `time yarn test`, `env CI=1 yarn test`, `nice -n 5 yarn test`,
* `exec yarn test`, `timeout 60 yarn test`, `… | xargs yarn test` all RUN
* `yarn test`; matched before stripping, a runner behind one was plain shell
* output and a run that ran nothing passed.
*/
const WRAPPER_PREFIX_RE = /* @__PURE__ */ new RegExp("^(?:" + [
	String.raw`timeout(?:\s+(?:-[sk]\s*\S+|--\S+|-[A-Za-z]+))*(?:\s+\d+(?:\.\d+)?[smhd]?)?`,
	String.raw`time(?:\s+-p)?`,
	String.raw`(?:(?:\/usr)?\/bin\/)?env(?:\s+(?:-i|-u\s*\S+|--ignore-environment|--unset=\S+|-))*`,
	String.raw`command`,
	String.raw`stdbuf(?:\s+-[ioe]\s*\S+)*`,
	String.raw`nice(?:\s+(?:-n\s*-?\d+|-\d+|--adjustment=-?\d+))?`,
	String.raw`exec(?:\s+-[cl]+)*`,
	String.raw`nohup`,
	String.raw`xargs(?:\s+(?:-[ILnPsdE]\s*\S+|--\S+|-[A-Za-z0-9]+))*`
].join("|") + String.raw`)\s+`);
/**
* Any `test*` script counts, not a fixed alternation — `test:behavioral`,
* `test:integration`, `test:cov` and future names must all be authoritative.
* Also covers the workspace-dispatch forms (`yarn workspace <pkg> <script>`,
* `yarn --cwd <dir> <script>`) and the npm/npx equivalents.
*/
const TEST_RUNNER_RE = new RegExp([
	String.raw`^yarn(?:\s+(?:-s|--silent|--verbose|--offline|--frozen-lockfile|--immutable|workspace\s+\S+|--cwd\s+\S+))*\s+(?:run\s+)?(?:test(?::[\w-]+)?\b|vitest\b|jest\b)`,
	String.raw`^yarn\s+workspaces\s+foreach(?:\s+(?:--(?:include|exclude|from|jobs)(?:=|\s+)\S+|-j\s+\S+|-[A-Za-z]+|--[\w-]+(?:=\S+)?))*\s+(?:run\s+)?test(?::[\w-]+)?\b`,
	String.raw`^npm\s+(?:run\s+)?test(?::[\w-]+)?\b`,
	String.raw`^pnpm\s+(?:(?:--filter|-F|--dir|-C)\s+\S+\s+|(?:-r|--recursive)\s+)*(?:run\s+)?test(?::[\w-]+)?\b`,
	String.raw`^pnpm\s+(?:exec\s+|dlx\s+)?(?:vitest|jest|playwright)\b`,
	String.raw`^npx\s+(?:(?:--yes|-y|--no-install|--no|--quiet|-q|-p\s+\S+|--package(?:=|\s+)\S+)\s+)*(?:vitest|jest|playwright)\b`,
	String.raw`^node\s+(?:-\S+\s+)*\S*\b(?:vitest|jest|playwright|mocha|_mocha)\b\S*(?:\s|$)`,
	String.raw`^(?:(?:\.\/)?node_modules\/\.bin\/)?(?:vitest|jest|playwright)(?:\s|$)`,
	String.raw`^(?:php\s+(?:-d\s*\S+\s+)*)?(?:\.\/)?(?:vendor\/bin\/|bin\/)?(?:phpunit|pest|paratest)(?:\s|$)`,
	String.raw`^php\s+artisan\s+test(?:\s|$)`,
	String.raw`^composer\s+(?:run(?:-script)?\s+)?test(?:[:-][\w-]+)?(?:\s|$)`,
	String.raw`^(?:(?:uv|poetry|pipenv|hatch)\s+run\s+)?(?:python[\d.]*\s+-m\s+)?(?:py\.test|pytest)(?:\s|$)`,
	String.raw`^go\s+test(?:\s|$)`,
	String.raw`^cargo\s+(?:\+\S+\s+)?(?:test|nextest)(?:\s|$)`,
	String.raw`^(?:\.\/)?mvnw?(?:\s+\S+)*?\s+(?:test|verify|integration-test)(?:\s|$)`,
	String.raw`^(?:\.\/)?gradlew?(?:\s+\S+)*?\s+(?:\S*:)?(?:test|check)(?:\s|$)`,
	String.raw`^dotnet\s+test(?:\s|$)`,
	String.raw`^(?:bundle\s+exec\s+)?(?:bin\/)?rspec(?:\s|$)`,
	String.raw`^(?:npx\s+(?:(?:--yes|-y|--no-install|--no|-p\s+\S+|--package(?:=|\s+)\S+)\s+)*|yarn\s+(?:run\s+)?|pnpm\s+(?:exec\s+)?|(?:\.\/)?node_modules\/\.bin\/)?mocha(?:\s|$)`,
	String.raw`^yarn\s+playwright\s+test(?:\s|$)`
].join("|"));
/**
* The CLIs whose answer IS a gate's verdict. One list feeds both regexes
* below, so a judge recognised on the non-zero branch is also read on exit 0.
* ENG-7698: grok was missing, so a grok `{"result": "pass", …}` whose reason
* said "fail closed" went to the generic shell scan and recorded a fail.
*/
const JUDGE_BINARIES = "agy|codex|gemini|grok";
/**
* Semantic judges, matched anywhere in the segment — L4 templates invoke them
* after a pipe (`echo "..." | agy -p`) or inside a wrapper
* (`timeout 120 bash -c '... | agy ...'`), so an anchored test would miss them.
*/
const SEMANTIC_RUNNER_RE = /* @__PURE__ */ new RegExp(`(?:^|[\\s|;&(])(?:${JUDGE_BINARIES})(?:\\s|$)`);
/**
* A judge INVOKED in command position — `agy …`, `| agy …`, `$(agy …`,
* `timeout 120 agy …`, `bash -c '… $(agy …) …'` — ENG-5967 B.
*
* Narrower than `isSemanticVerdictAuthoritative` on purpose. That one decides
* what a NON-zero exit means, where a false positive only costs a soft-pass
* nobody should have had. This one decides that an EXIT-0 step's verdict is
* the judge's stated answer, overriding the expectation — so `grep gemini
* src/x.ts`, which mentions a judge without running one, must not match.
*
* Review R3-07: decided on the command's STRUCTURE, never on its text. A
* regex over the raw string matched `grep -Fc '$(agy --model' template.ts`
* — single-quoted, so `$(` is literal and nothing runs — and a green
* presence check on a judge template read `SEMANTIC_UNKNOWN`. Every command
* the shell would run (each list command and pipe stage, every `$( … )` /
* backtick body outside single quotes, the script of `bash|sh -c`, behind
* any wrapper) is a candidate; a judge is one whose FIRST word is the binary.
*/
const JUDGE_COMMAND_RE = /* @__PURE__ */ new RegExp(`^(?:${JUDGE_BINARIES})(?:\\s|$)`);

//#endregion
//#region ../shared/dist/runs/gate-binding-config.js
/**
* Gate binding config validation (ENG-7284 D4). Pure: no framework imports.
*
* The one validator for a `gate_binding.config`, shared by the server
* (`GateBindingService`, which turns a `GateBindingConfigError` into a 400)
* and by local tooling that writes bindings (the D7 apply script), so a config
* refused by one is refused by the other with the same message.
*
* A config is a plain object. Three roots are read:
*
* - `cmd` and `impl`: slot trees that bottom out in a non-empty command
*   string, an argv leaf `{ cwd, argv }`, a `{ legacy }` leaf, or a
*   path-prefix map of those.
* - `params`: per-gate-type param defaults, `params.<gate_key>.<param>`, with
*   string leaves only (e.g. `params.ast_pattern.language: "Rust"`). Only the
*   params a resolver reads (BINDING_PARAM_DEFAULTS) are accepted, and, when
*   the binding's gate key is known, only under that key: the resolver reads
*   `params.<gate_key>` from that gate type's own bindings and nowhere else.
*
* Any other top-level key — a typo (`cdm`), or the flat `cmd.typecheck` form —
* is refused (review M4). It would be stored, never read, and its commands
* would bypass every check.
*
* A wrong shape here is a gate that quietly resolves `unconfigured` forever
* with nothing pointing at the typo, so it is refused at write.
*/
/**
* The binding param defaults each RESOLVER reads, from
* `params.<the binding's gate key>`. A param not listed here would be stored
* and ignored, so it is refused at write.
*/
const BINDING_PARAM_DEFAULTS = {
	ast_pattern: ["language"],
	symbol_referenced: ["language"]
};
const CONFIG_ROOTS = new Set([
	"cmd",
	"impl",
	"params"
]);
/** A malformed binding config. `path` names the offending node. */
var GateBindingConfigError = class extends Error {
	path;
	constructor(message, path$2 = null) {
		super(message);
		this.name = "GateBindingConfigError";
		this.path = path$2;
	}
};
/** An object with an `argv` array is one slot leaf, not a path-prefix map. */
function isArgvLeaf(value) {
	if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
	return Array.isArray(value.argv);
}
/** `{ legacy: command }` is one slot leaf. */
function isLegacyLeaf(value) {
	if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
	return typeof value.legacy === "string";
}
function isPlainObject$1(value) {
	return value != null && typeof value === "object" && !Array.isArray(value);
}
/**
* Throws `GateBindingConfigError` when `config` is not a well-formed gate
* binding config. `null`/`undefined` is "no config" and passes.
*/
function assertWellFormedGateBindingConfig(config, gateKey, resolver) {
	if (config == null) return;
	if (!isPlainObject$1(config)) throw new GateBindingConfigError("config must be a JSON object.");
	for (const root of Object.keys(config)) {
		if (CONFIG_ROOTS.has(root)) continue;
		const dotted = /^(cmd|impl|params)\./.exec(root);
		throw new GateBindingConfigError(dotted ? `config key "${root}" is the flat form; nest it instead ({ "${dotted[1]}": { ... } }). A flat key is never read.` : `config key "${root}" is not a binding root; use cmd, impl or params.`, root);
	}
	for (const slotRoot of ["cmd", "impl"]) {
		const tree = config[slotRoot];
		if (tree === void 0) continue;
		assertSlotTree(tree, slotRoot);
	}
	if (config.params !== void 0) assertParamsRoot(config.params, gateKey, resolver);
}
function assertSlotTree(node, pathSoFar) {
	if (typeof node === "string") {
		if (node.trim().length === 0) throw new GateBindingConfigError(`config slot "${pathSoFar}" is a blank string — an empty command is treated as unbound; omit it instead.`, pathSoFar);
		return;
	}
	if (isArgvLeaf(node)) {
		assertArgvLeaf(node, pathSoFar);
		return;
	}
	if (isLegacyLeaf(node)) {
		assertLegacyLeaf(node, pathSoFar);
		return;
	}
	if (isPlainObject$1(node)) {
		for (const [key, child] of Object.entries(node)) {
			if (key === "argv" || key === "cwd") throw new GateBindingConfigError(`config slot "${pathSoFar}.${key}" uses "${key}" as a path-prefix key. Those names are argv-leaf fields; put the command in { cwd, argv }.`, `${pathSoFar}.${key}`);
			assertSlotTree(child, `${pathSoFar}.${key}`);
		}
		return;
	}
	throw new GateBindingConfigError(`config slot "${pathSoFar}" must be a command string, an argv leaf { cwd, argv }, a { legacy } command, or a nested object of them (got ${Array.isArray(node) ? "array" : typeof node}).`, pathSoFar);
}
function assertArgvLeaf(node, pathSoFar) {
	const extra = Object.keys(node).filter((key) => key !== "cwd" && key !== "argv");
	if (extra.length > 0) throw new GateBindingConfigError(`config slot "${pathSoFar}" is an argv leaf with extra keys (${extra.join(", ")}). An argv leaf is only { cwd, argv }.`, pathSoFar);
	if (node.argv.length === 0) throw new GateBindingConfigError(`config slot "${pathSoFar}" has an empty argv — an empty command is treated as unbound; omit it instead.`, pathSoFar);
	if (node.argv.some((element) => typeof element !== "string" || element.length === 0)) throw new GateBindingConfigError(`config slot "${pathSoFar}" argv must be non-empty strings.`, pathSoFar);
	if (node.cwd !== void 0 && (typeof node.cwd !== "string" || node.cwd.length === 0)) throw new GateBindingConfigError(`config slot "${pathSoFar}" cwd must be a non-empty string.`, pathSoFar);
}
function assertLegacyLeaf(node, pathSoFar) {
	const extra = Object.keys(node).filter((key) => key !== "legacy");
	if (extra.length > 0) throw new GateBindingConfigError(`config slot "${pathSoFar}" is a legacy leaf with extra keys (${extra.join(", ")}).`, pathSoFar);
	if (node.legacy.trim().length === 0) throw new GateBindingConfigError(`config slot "${pathSoFar}" is a blank legacy command — an empty command is treated as unbound; omit it instead.`, pathSoFar);
}
/**
* `params.<gate_key>.<param>`: exactly two levels of objects, then a
* non-blank string. No slot maps and no argv leaves — a param default is a
* value the resolver substitutes, never a command.
*/
function assertParamsRoot(node, bindingGateKey, resolver) {
	if (!isPlainObject$1(node)) throw new GateBindingConfigError(`config "params" must be an object of gate keys (got ${Array.isArray(node) ? "array" : typeof node}).`, "params");
	for (const [gateKey, perGate] of Object.entries(node)) {
		const gatePath = `params.${gateKey}`;
		if (bindingGateKey !== void 0 && gateKey !== bindingGateKey) throw new GateBindingConfigError(`config "${gatePath}" is on a "${bindingGateKey}" binding; params for "${gateKey}" are read only from a "${gateKey}" binding.`, gatePath);
		const readable = resolver === void 0 ? BINDING_PARAM_DEFAULTS[gateKey] : resolver ? BINDING_PARAM_DEFAULTS[resolver] : void 0;
		if (!readable) throw new GateBindingConfigError(`config "${gatePath}": "${gateKey}" reads no binding params (resolvers that do: ${Object.keys(BINDING_PARAM_DEFAULTS).join(", ")}).`, gatePath);
		if (!isPlainObject$1(perGate)) throw new GateBindingConfigError(`config "${gatePath}" must be an object of param defaults (got ${Array.isArray(perGate) ? "array" : typeof perGate}).`, gatePath);
		for (const [param, value] of Object.entries(perGate)) {
			const paramPath = `${gatePath}.${param}`;
			if (!readable.includes(param)) throw new GateBindingConfigError(`config "${paramPath}": "${gateKey}" reads only ${readable.join(", ")} from a binding.`, paramPath);
			if (typeof value !== "string") throw new GateBindingConfigError(`config "${paramPath}" must be a string (got ${Array.isArray(value) ? "array" : value === null ? "null" : typeof value}).`, paramPath);
			if (value.trim().length === 0) throw new GateBindingConfigError(`config "${paramPath}" is a blank string; omit it instead.`, paramPath);
		}
	}
}

//#endregion
//#region ../shared/dist/runs/binding-command-migration.js
/** An object with an `argv` array is one slot leaf, not a path-prefix map. */
function isArgvSlotValue(value) {
	if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
	return Array.isArray(value.argv);
}
/** `{ legacy: command }` is one slot leaf. */
function isLegacySlotValue(value) {
	if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
	return typeof value.legacy === "string";
}
/** Shell text of a resolved slot, placeholders left unquoted. */
function resolvedSlotText(slot) {
	if (slot.kind === "legacy") return slot.command ?? "";
	const argv = (slot.argv ?? []).join(" ");
	if (!slot.cwd || slot.cwd === ".") return argv;
	return `cd ${slot.cwd} && ${argv}`;
}

//#endregion
//#region ../shared/dist/runs/gate-command-authoring.js
/**
* Write-time validation of a rendered gate command (ENG-6176).
*
* Pure domain: no NestJS and no database. Callers turn a refusal into a
* 400 `GATE_COMMAND_REFUSED` and write nothing.
*
* `fail_closed`: a command the validator refuses is never written, deployed,
* or issued. An unknown placeholder type gets a generic sample and is
* validated. It is never skipped.
*/
const GATE_COMMAND_REFUSED = "GATE_COMMAND_REFUSED";
const PLACEHOLDER = /\{([^{}]+)\}/g;
/**
* One sample per `{placeholder}` in `template`.
*
* Named samples win over the declared type: `{workspace_dir}` is
* `apps/sample` and `{test_file}` is `src/sample.spec.ts`. A declared
* `path` is `src/sample.ts` and a declared `string` is `sample`. Anything
* else, including a placeholder with no declaration, is the generic
* `sample` (`fail_closed`).
*/
function samplePlaceholderValues(template, paramSchema = {}) {
	const values = {};
	for (const match of template.matchAll(PLACEHOLDER)) {
		const name = match[1];
		if (!name || values[name] !== void 0) continue;
		values[name] = sampleFor(name, paramSchema[name]?.type);
	}
	return values;
}
function sampleFor(name, declaredType) {
	if (name === "workspace_dir") return "apps/sample";
	if (name === "test_file") return "src/sample.spec.ts";
	if (declaredType === "path") return "src/sample.ts";
	if (declaredType === "string") return "sample";
	return "sample";
}
function renderGateCommandTemplate(template, values) {
	return template.replace(PLACEHOLDER, (whole, name) => Object.prototype.hasOwnProperty.call(values, name) ? values[name] : whole);
}
/**
* Every command under `config.cmd` and `config.impl`.
*
* A path-prefix map is a command per prefix. An argv leaf is one command:
* its unquoted `cd <cwd> && argv` text, so the allowlist sees the same
* shape a string slot used to store. A `{ legacy }` leaf is that string.
* The slot key is the path (`cmd.typecheck`, or `cmd.test.unit.scripts/`
* for a map). `sandbox_policy` is not a command template.
*/
function commandSlotsInBindingConfig(config) {
	if (config == null || typeof config !== "object" || Array.isArray(config)) return [];
	const record = config;
	const slots = [];
	collectCommandStrings(record.cmd, "cmd", slots);
	collectCommandStrings(record.impl, "impl", slots);
	return slots;
}
/**
* `resolver_template.template`, when the payload sets one.
* Slot key is `resolver_template.template`. Declared param types drive samples.
*/
function commandSlotInResolverTemplate(resolverTemplate) {
	if (resolverTemplate == null || typeof resolverTemplate !== "object" || Array.isArray(resolverTemplate)) return null;
	const record = resolverTemplate;
	if (typeof record.template !== "string") return null;
	const template = record.template.trim();
	if (template.length === 0) return null;
	return {
		slotKey: "resolver_template.template",
		template,
		paramSchema: paramSchemaOf(record.param_schema)
	};
}
/**
* Every command a `resolver_template` carries: its shell `template` and an
* argv `op_template` (ENG-6180 review). The op_template is what the renderer
* issues, so it is validated at write time exactly like the template string,
* as its unquoted `cd <cwd> && argv` text. Slot keys are
* `resolver_template.template` and `resolver_template.op_template`.
*/
function commandSlotsInResolverTemplate(resolverTemplate) {
	const slots = [];
	const templateSlot = commandSlotInResolverTemplate(resolverTemplate);
	if (templateSlot) slots.push(templateSlot);
	if (resolverTemplate == null || typeof resolverTemplate !== "object" || Array.isArray(resolverTemplate)) return slots;
	const record = resolverTemplate;
	const op = record.op_template;
	if (op == null || typeof op !== "object" || Array.isArray(op)) return slots;
	const opRecord = op;
	if (opRecord.op !== "argv") return slots;
	const argv = opRecord.argv;
	if (!Array.isArray(argv) || argv.length === 0 || argv.some((element) => typeof element !== "string" || element.length === 0)) {
		slots.push({
			slotKey: "resolver_template.op_template",
			template: "",
			paramSchema: paramSchemaOf(record.param_schema)
		});
		return slots;
	}
	const cwdRaw = opRecord.cwd;
	const cwd = typeof cwdRaw === "string" && cwdRaw.length > 0 ? cwdRaw : ".";
	slots.push({
		slotKey: "resolver_template.op_template",
		template: resolvedSlotText({
			kind: "argv",
			cwd,
			argv
		}),
		paramSchema: paramSchemaOf(record.param_schema)
	});
	return slots;
}
function collectCommandStrings(value, path$2, slots) {
	if (typeof value === "string") {
		const template = value.trim();
		if (template.length > 0) slots.push({
			slotKey: path$2,
			template
		});
		return;
	}
	if (isArgvSlotValue(value)) {
		if (value.argv.length === 0 || value.argv.some((element) => typeof element !== "string")) return;
		const cwdRaw = value.cwd;
		const template = resolvedSlotText({
			kind: "argv",
			cwd: typeof cwdRaw === "string" && cwdRaw.length > 0 ? cwdRaw : ".",
			argv: value.argv
		});
		if (template.trim().length > 0) slots.push({
			slotKey: path$2,
			template
		});
		return;
	}
	if (isLegacySlotValue(value)) {
		if (value.legacy.trim().length > 0) slots.push({
			slotKey: path$2,
			template: value.legacy
		});
		return;
	}
	if (value != null && typeof value === "object" && !Array.isArray(value)) for (const [key, child] of Object.entries(value)) collectCommandStrings(child, `${path$2}.${key}`, slots);
}
function paramSchemaOf(value) {
	if (value == null || typeof value !== "object" || Array.isArray(value)) return;
	const schema = {};
	for (const [key, decl] of Object.entries(value)) if (decl != null && typeof decl === "object" && !Array.isArray(decl)) {
		const type = decl.type;
		schema[key] = { type: typeof type === "string" ? type : void 0 };
	}
	return schema;
}
/**
* Render `template` with real values when they were given, otherwise with
* typed samples, then run `validate`. A refusal names the slot, the rendered
* command, and the validator's reason.
*/
function validateRenderedSlotCommand(input) {
	const values = input.paramValues ?? samplePlaceholderValues(input.template, input.paramSchema ?? {});
	const rendered = renderGateCommandTemplate(input.template, values);
	const reason = rendered.trim().length === 0 ? "fail_closed: the command is empty" : input.validate(rendered);
	if (reason == null) return {
		ok: true,
		rendered
	};
	return {
		ok: false,
		code: GATE_COMMAND_REFUSED,
		rendered,
		reason: `${GATE_COMMAND_REFUSED}: slot ${input.slotKey} rendered \`${rendered}\`: ${reason}`
	};
}

//#endregion
//#region ../shared/dist/runs/verification-technique.js
/**
* The six techniques, in DISPLAY order. The order is not a ranking: a
* Semantic check is not "deeper" than a Presence check, and no code may treat
* a later entry as stronger than an earlier one.
*/
const VERIFICATION_TECHNIQUES = [
	"presence",
	"pattern",
	"structure",
	"semantic",
	"execution",
	"state"
];
const VerificationTechniqueSchema = z.enum(VERIFICATION_TECHNIQUES);
function isVerificationTechnique(value) {
	return typeof value === "string" && VERIFICATION_TECHNIQUES.includes(value);
}
/**
* Profiles as explicit technique sets. `full` is the only profile that
* verifies everything; `quick` and `standard` are fix-loop aids. A gate's
* profile follows its DEFINITION's technique, never a step's label.
*/
const PROFILE_TECHNIQUES = {
	quick: new Set([
		"presence",
		"pattern",
		"state"
	]),
	standard: new Set([
		"presence",
		"pattern",
		"state",
		"structure"
	]),
	full: new Set(VERIFICATION_TECHNIQUES)
};

//#endregion
//#region ../shared/dist/runs/gate-bindings-payload.js
/** A file, binding, config or command the import refuses. */
var PayloadError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "PayloadError";
	}
};
const TOP_KEYS = new Set([
	"description",
	"definitions",
	"bindings"
]);
const BINDING_KEYS = new Set([
	"gate_key",
	"repo_key",
	"path_prefix",
	"enabled",
	"config",
	"note",
	"delete"
]);
const DELETE_ENTRY_KEYS = new Set([
	"gate_key",
	"repo_key",
	"path_prefix",
	"note",
	"delete"
]);
const DEFINITION_KEYS = new Set([
	"key",
	"name",
	"description",
	"technique",
	"category",
	"resolver_template"
]);
const DEFINITION_KEY_RE = /^[a-z0-9_]+$/;
function isPlainObject(value) {
	return value != null && typeof value === "object" && !Array.isArray(value);
}
function optionalTierValue(entry, field, at) {
	const value = entry[field];
	if (value === void 0 || value === null) return null;
	if (typeof value !== "string" || value.trim() === "") throw new PayloadError(`${at}.${field} must be a non-empty string or null`);
	return value;
}
/** The key a binding's tier is matched on. */
function bindingTierKey(b) {
	return JSON.stringify([
		b.gate_key,
		b.repo_key ?? null,
		b.path_prefix ?? null
	]);
}
function parseBinding(entry, at) {
	if (!isPlainObject(entry)) throw new PayloadError(`${at} is not an object`);
	for (const key of Object.keys(entry)) if (!BINDING_KEYS.has(key)) throw new PayloadError(`${at}: unknown field "${key}"`);
	const gateKey = entry.gate_key;
	if (typeof gateKey !== "string" || gateKey.trim() === "") throw new PayloadError(`${at}.gate_key must be a non-empty string`);
	if (entry.note !== void 0 && typeof entry.note !== "string") throw new PayloadError(`${at}.note must be a string`);
	if (entry.delete !== void 0 && typeof entry.delete !== "boolean") throw new PayloadError(`${at}.delete must be a boolean`);
	const tier = {
		gate_key: gateKey,
		repo_key: optionalTierValue(entry, "repo_key", at),
		path_prefix: optionalTierValue(entry, "path_prefix", at)
	};
	const note = entry.note ? { note: entry.note } : {};
	if (entry.delete === true) {
		for (const key of Object.keys(entry)) if (!DELETE_ENTRY_KEYS.has(key)) throw new PayloadError(`${at}: a "delete": true entry names the binding to delete and nothing else; remove "${key}"`);
		return {
			...tier,
			enabled: false,
			config: {},
			...note,
			delete: true
		};
	}
	const config = entry.config ?? {};
	if (!isPlainObject(config)) throw new PayloadError(`${at}.config must be an object`);
	if (entry.enabled !== void 0 && typeof entry.enabled !== "boolean") throw new PayloadError(`${at}.enabled must be a boolean`);
	return {
		...tier,
		enabled: entry.enabled !== false,
		config,
		...note
	};
}
function parseDefinition(entry, at) {
	if (!isPlainObject(entry)) throw new PayloadError(`${at} is not an object`);
	if ("delete" in entry) throw new PayloadError(`${at}: a definition cannot be deleted by import (that removes every gate of the type); delete it on purpose instead`);
	for (const key$1 of Object.keys(entry)) if (!DEFINITION_KEYS.has(key$1)) throw new PayloadError(`${at}: unknown field "${key$1}"`);
	const key = entry.key;
	if (typeof key !== "string" || !DEFINITION_KEY_RE.test(key)) throw new PayloadError(`${at}.key must be lowercase snake_case`);
	if (typeof entry.name !== "string" || entry.name.trim() === "") throw new PayloadError(`${at}.name must be a non-empty string`);
	for (const field of ["description", "category"]) {
		const v = entry[field];
		if (v !== void 0 && v !== null && typeof v !== "string") throw new PayloadError(`${at}.${field} must be a string or null`);
	}
	if (entry.technique !== void 0 && !isVerificationTechnique(entry.technique)) throw new PayloadError(`${at}.technique "${String(entry.technique)}" is not a verification technique`);
	const template = entry.resolver_template;
	if (template !== void 0 && template !== null && !isPlainObject(template)) throw new PayloadError(`${at}.resolver_template must be an object or null`);
	const def = {
		key,
		name: entry.name
	};
	if (entry.description !== void 0) def.description = entry.description;
	if (entry.technique !== void 0) def.technique = entry.technique;
	if (entry.category !== void 0) def.category = entry.category;
	if (template !== void 0) def.resolver_template = template;
	return def;
}
/** Parse and shape-check a gate configuration file. Throws `PayloadError`. */
function parsePayload(raw) {
	if (!isPlainObject(raw) || !Array.isArray(raw.bindings)) throw new PayloadError("the file must be an object with a \"bindings\" array");
	for (const key of Object.keys(raw)) if (!TOP_KEYS.has(key)) throw new PayloadError(`unknown field "${key}"`);
	if (raw.description !== void 0 && typeof raw.description !== "string") throw new PayloadError("\"description\" must be a string");
	if (raw.definitions !== void 0 && !Array.isArray(raw.definitions)) throw new PayloadError("\"definitions\" must be an array");
	const seenTier = /* @__PURE__ */ new Set();
	const bindings = raw.bindings.map((entry, i) => {
		const b = parseBinding(entry, `bindings[${i}]`);
		const tier = bindingTierKey(b);
		if (seenTier.has(tier)) throw new PayloadError(`bindings[${i}]: the tier (gate_key "${b.gate_key}", repo_key ${b.repo_key ?? "null"}, path_prefix ${b.path_prefix ?? "null"}) appears twice`);
		seenTier.add(tier);
		return b;
	});
	const seenKey = /* @__PURE__ */ new Set();
	const definitions = (raw.definitions ?? []).map((entry, i) => {
		const d = parseDefinition(entry, `definitions[${i}]`);
		if (seenKey.has(d.key)) throw new PayloadError(`definitions[${i}]: key "${d.key}" appears twice`);
		seenKey.add(d.key);
		return d;
	});
	return {
		...typeof raw.description === "string" ? { description: raw.description } : {},
		definitions,
		bindings
	};
}
/** Every command a config issues, with the slot path it sits at. */
function commandLeaves(config) {
	const out = [];
	const walk = (node, at, key) => {
		if (typeof node === "string") {
			out.push({
				path: at,
				command: node,
				...key ? { key } : {}
			});
			return;
		}
		if (!isPlainObject(node)) return;
		if (Array.isArray(node.argv)) {
			out.push({
				path: at,
				command: node.argv.map(String).join(" "),
				...key ? { key } : {}
			});
			return;
		}
		if (typeof node.legacy === "string") {
			out.push({
				path: at,
				command: node.legacy,
				...key ? { key } : {}
			});
			return;
		}
		for (const [k, child] of Object.entries(node)) walk(child, `${at}.${k}`, k);
	};
	for (const root of ["cmd", "impl"]) if (config[root] !== void 0) walk(config[root], root);
	return out;
}
/**
* Every check that needs no network or database: each binding config's shape
* and each command slot, rendered with typed samples and run through the
* gate command allowlist exactly as the server checks it at write time; and
* each definition's resolver template commands. Throws `PayloadError` naming
* the entry. Delete entries carry no config and are not checked.
*
* Which `params` a binding may carry depends on its definition's resolver.
* Locally that is known for a definition in the file and for the system gate
* types (the key is the resolver); for any other key the `params` subtree is
* left to the server, which checks every row against the stored definition,
* so a valid file is never refused here. The server passes
* `{ configShape: false }` and runs that per-row check itself.
*/
function validatePayload(payload, opts = {}) {
	const fileResolver = new Map(payload.definitions.map((d) => {
		const r = d.resolver_template?.resolver;
		return [d.key, typeof r === "string" ? r : null];
	}));
	for (const def of payload.definitions) for (const slot of commandSlotsInResolverTemplate(def.resolver_template ?? null)) {
		const result = validateRenderedSlotCommand({
			slotKey: slot.slotKey,
			template: slot.template,
			paramSchema: slot.paramSchema,
			validate: validateGateCommand
		});
		if (!result.ok) throw new PayloadError(`definition ${def.key}: ${result.reason}`);
	}
	for (const binding of payload.bindings) {
		if (binding.delete) continue;
		try {
			if (opts.configShape !== false) {
				const key = binding.gate_key;
				if (fileResolver.has(key)) assertWellFormedGateBindingConfig(binding.config, key, fileResolver.get(key));
				else if (Object.prototype.hasOwnProperty.call(BINDING_PARAM_DEFAULTS, key)) assertWellFormedGateBindingConfig(binding.config, key);
				else {
					const { params: _left,...rest } = binding.config;
					assertWellFormedGateBindingConfig(rest, key);
				}
			}
		} catch (e) {
			if (e instanceof GateBindingConfigError) throw new PayloadError(`${binding.gate_key}: ${e.message}`);
			throw e;
		}
		for (const slot of commandSlotsInBindingConfig(binding.config)) {
			const result = validateRenderedSlotCommand({
				slotKey: slot.slotKey,
				template: slot.template,
				paramSchema: slot.paramSchema,
				validate: validateGateCommand
			});
			if (!result.ok) throw new PayloadError(`${binding.gate_key}: ${result.reason}`);
		}
	}
}
/**
* The files a file's lanes name, repository-relative: script paths in a
* command, `tests/<name>.rs` for each `--test <name>`, and path-prefix keys
* that name a file. Placeholders (`{path}`) are not files.
*/
function namedFiles(payload) {
	const files = /* @__PURE__ */ new Set();
	for (const binding of payload.bindings) for (const leaf of commandLeaves(binding.config)) {
		const words = leaf.command.split(/\s+/);
		words.forEach((word, i) => {
			if (word === "--test" && words[i + 1] && !words[i + 1].includes("{")) files.add(`tests/${words[i + 1]}.rs`);
			else if (/^[\w.-]+(?:\/[\w.-]+)+\.[A-Za-z0-9]+$/.test(word) && !word.startsWith("@")) files.add(word);
		});
		if (leaf.key && /\.[A-Za-z0-9]+$/.test(leaf.key) && leaf.key.includes("/")) files.add(leaf.key);
	}
	return [...files].sort();
}
/** `namedFiles` for which `exists(relativePath)` is false. */
function missingFiles(payload, exists) {
	return namedFiles(payload).filter((f) => !exists(f));
}

//#endregion
//#region ../shared/dist/runs/gate-expectations.js
/** The branch names a positive grep count may be judged by. */
const POSITIVE_COUNT = [
	"count OP N",
	">= N",
	">= N each",
	"both >= N",
	"PASS"
];
/** The branch names a NEGATIVE grep count may be judged by. */
const NEGATIVE_COUNT = ["zero", "count OP N"];
const expect = (defaultExpected, accepts) => ({
	defaultExpected,
	verdictSource: "expectation",
	...accepts ? { accepts } : {}
});
const RUNNER = {
	defaultExpected: null,
	verdictSource: "runner"
};
const JUDGE = {
	defaultExpected: null,
	verdictSource: "judge"
};
/**
* Every system gate type's expectation contract — ENG-5967 A.
*
* The user-decided defaults (binding): `file_exists` EXISTS, `file_not_exists`
* NOT_EXISTS, `file_contains`/`module_imports` `>= 1`, `file_not_contains`/
* `no_stubs` `0`, `done_criteria_check` `all met`, `shell` `exit 0`. The rest
* follow the same reading of their own templates: a grep count asks `>= 1`
* (or `0` when it is a prohibition), a script whose exit code is its verdict
* asks `exit 0`, and a check that prints one token asks for that token.
*
* `seed_data_count` deliberately has NO default: "there should be exactly N"
* has no N anyone but the author knows, so deploy refuses it without one.
*/
const GATE_TYPE_EXPECTATIONS = {
	file_exists: expect("EXISTS", [
		"EXISTS",
		"exit 0",
		"contains:"
	]),
	entity_generated: expect("EXISTS", [
		"EXISTS",
		"exit 0",
		"contains:"
	]),
	file_not_exists: expect("NOT_EXISTS", [
		"NOT_EXISTS",
		"exit 0",
		"contains:"
	]),
	file_contains: expect(">= 1", POSITIVE_COUNT),
	module_imports: expect(">= 1", POSITIVE_COUNT),
	schema_has_field: expect(">= 1", POSITIVE_COUNT),
	entity_has_column: expect(">= 1", POSITIVE_COUNT),
	service_has_method: expect(">= 1", POSITIVE_COUNT),
	assertion_floor: expect(">= 1", POSITIVE_COUNT),
	seed_data_count: {
		defaultExpected: null,
		verdictSource: "expectation",
		accepts: POSITIVE_COUNT.concat(["zero"])
	},
	file_not_contains: expect("0", NEGATIVE_COUNT),
	no_stubs: expect("0", NEGATIVE_COUNT),
	symbol_removed: expect("0", NEGATIVE_COUNT),
	done_criteria_check: expect("all met", [
		"all met",
		"exit 0",
		"contains:"
	]),
	schema_registered: expect("PASS", ["PASS", "contains:"]),
	shell: expect("exit 0"),
	typecheck: expect("exit 0"),
	lint: expect("exit 0"),
	changed_line_coverage: expect("exit 0"),
	secret_scan: expect("exit 0"),
	security_testing: expect("exit 0"),
	iac_misconfig: expect("exit 0"),
	dependency_audit: expect("exit 0"),
	symbol_referenced: expect("exit 0"),
	ast_pattern: expect("exit 0"),
	schema_column_set: expect("exit 0"),
	migration_revert_scope: expect("exit 0"),
	migration_contains: expect("exit 0"),
	unit_test_pass: RUNNER,
	e2e_test_pass: RUNNER,
	spec_conformance: JUDGE,
	behavioral_intent: JUDGE,
	edge_case_coverage: JUDGE,
	guided: {
		defaultExpected: null,
		verdictSource: "observation"
	}
};

//#endregion
//#region ../shared/dist/schemas/test-data.zod.js
const GherkinKeywordSchema = z.enum([
	"Given",
	"When",
	"Then",
	"And",
	"But",
	"*"
]);
const DataTableDataSchema = z.object({ rows: z.array(z.array(z.string())).describe("") }).describe("");
/**
* A GUIDED step — plan ENG-4825 D-F / R7.1, R7.2, R7.8.
*
* A gate a human *or an agent* performs: an instruction and what should be
* true afterwards. It is the third step shape, alongside the legacy shell
* (`method`) and the declarative (`type` + `params`) forms.
*
* ## Why `guided` and not `manual`
*
* Seven real manual tests in the corpus already carry `type: 'manual'` on
* their steps. Reusing that marker would retroactively turn them into gates an
* agent is expected to perform and record per-step results for, which is not
* what their authors wrote. A new word costs nothing and cannot collide.
*
* ## Why the field is `step` and not `method`
*
* `method` means "a shell command to run". A guided step is an instruction to
* follow, and calling it `method` would invite every executor that shells out
* on `method` to try. The normaliser must NOT rename it — see
* `test.service.ts`.
*
* ## Ordering matters — this arm goes FIRST in every union
*
* The competitor is the DECLARATIVE arm, which accepts any `type` string and
* has no `step` field: under `.strict()` it rejects, but under `.passthrough()`
* a guided step matching it would keep `step` only by accident of the
* passthrough, and a later `.strict()` consumer would silently drop the
* instruction. First place makes the match deterministic instead.
*/
const GuidedStepItemSchema = z.object({
	id: z.string().uuid().optional(),
	type: z.literal("guided"),
	step: z.string().describe(""),
	expected_result: z.string().optional().describe(""),
	result: z.string().optional().describe(""),
	technique: VerificationTechniqueSchema.optional().describe("")
});
const StepItemSchema = z.object({
	id: z.string().uuid().optional(),
	method: z.string(),
	expected_result: z.string().optional(),
	shared_step_id: z.string().uuid().optional(),
	keyword: GherkinKeywordSchema.optional(),
	data_table: DataTableDataSchema.optional().describe(""),
	technique: VerificationTechniqueSchema.optional().describe("")
});
const PreconditionItemSchema = z.object({
	id: z.string().uuid().optional(),
	condition: z.string(),
	shared_precondition_id: z.string().uuid().optional(),
	keyword: GherkinKeywordSchema.optional(),
	data_table: DataTableDataSchema.optional().describe("")
});
/**
* Strict test data schema for MCP tools.
* Rejects unknown fields so LLMs receive clear schema guidance.
*/
const TestDataSchemaStrict = z.object({
	description: z.string().optional().describe(""),
	shared_precondition_id: z.string().uuid().nullable().optional().describe(""),
	preconditions: z.array(PreconditionItemSchema).optional().describe(""),
	steps: z.array(z.union([GuidedStepItemSchema, StepItemSchema])).optional().describe("")
}).strict().describe("");

//#endregion
//#region ../shared/dist/schemas/review-loop-events.zod.js
/**
* ENG-3822 (D17 of ENG-3320) — wire format for review-loop escape events
* published by `apps/github-app` to the JetStream subject
* `jobs.backender.review_loop.event` (BACKENDER_RX stream) and consumed
* by backender's `ReviewLoopEventConsumer`, which feeds the existing
* `ReviewLoopEscapeService` (D13). Replaces the retired
* `POST /v1/internal/github/review-loop/event` internal HTTP endpoint.
*
* This is the SINGLE source of truth for the payload shape — both sides
* parse/build through these schemas; never hand-roll the type on either
* side (the jira `@levr/jira-shared` payload-schema precedent).
*
* ## What the event carries — and deliberately does NOT (dedupe vs DB)
*
* github-app persists webhook data to the shared DB BEFORE these events
* are published (`webhook.service.ts` awaits the persistence handlers
* first), so the event only carries what the DB does **not** already
* reliably hold at consume time:
*
* - PR `body` / `head_sha` / `merged_at`: NOT carried. Reliably present on
*   `github_pull_request` (upserted by `PullRequestService.upsertFromWebhook`
*   before publish; the publisher gates on the same repo-linked +
*   `pr_sync_enabled` conditions as the upsert). The consumer hydrates them
*   from the DB row.
* - PR changed filenames: CARRIED. Nothing persists them; github-app fetches
*   them (metadata only, never contents) at publish time.
* - `merge_commit_sha`: CARRIED. `github_pull_request` has no such column.
* - push commit `{sha, message}` pairs: CARRIED. `github_commit` persistence
*   is best-effort — capped at 50 commits per push and fail-soft per row
*   (`CommitService.processCommit` returns null on save failure), so the DB
*   is NOT a reliable source for the exact commit set of this push.
*
* The `event` discriminator values intentionally match the
* `REVIEW_LOOP_PUSH_EVENT` / `REVIEW_LOOP_PR_MERGED_EVENT` constants in
* backender's `review-loop-escape.service.ts` (the D13 HTTP contract this
* transport replaces) so the consumer's event→DTO mapping is 1:1.
*/
const REVIEW_LOOP_EVENT_PUSH = "push";
const REVIEW_LOOP_EVENT_PR_MERGED = "pull_request_merged";
/** A pushed commit — message is required for `This reverts commit <sha>` detection. */
const ReviewLoopCommitSchema = z.object({
	sha: z.string().min(1),
	message: z.string()
});
const ReviewLoopPushEventSchema = z.object({
	event: z.literal(REVIEW_LOOP_EVENT_PUSH),
	workspace_id: z.string().uuid(),
	github_repository_id: z.string().uuid(),
	repo_full_name: z.string(),
	ref: z.string(),
	commits: z.array(ReviewLoopCommitSchema).min(1),
	producer_id: z.string()
});
const ReviewLoopPrMergedEventSchema = z.object({
	event: z.literal(REVIEW_LOOP_EVENT_PR_MERGED),
	workspace_id: z.string().uuid(),
	github_repository_id: z.string().uuid(),
	repo_full_name: z.string(),
	installation_id: z.number().int(),
	pr_number: z.number().int().positive(),
	merge_commit_sha: z.string().nullable(),
	changed_files: z.array(z.string()),
	changed_files_truncated: z.boolean(),
	producer_id: z.string()
});
/**
* Discriminated union over `event`. An unknown `event` value fails parse —
* the consumer must treat that as an explicit reject (loud log + term),
* never a silent ack (the webhook default-throw rule, transposed).
*/
const ReviewLoopEventSchema = z.discriminatedUnion("event", [ReviewLoopPushEventSchema, ReviewLoopPrMergedEventSchema]);

//#endregion
//#region ../shared/dist/first-task/first-task-prompt.js
/**
* The framing of a first-task prompt — plan ENG-6341 D4 rev 3.1 (ENG-6763).
*
* The client builds the prompts the user pastes into their coding agent from
* these constants (the first-task card, the own-feature dialog), and the
* backender strips the same framing from the request before choosing a recipe
* and titling the Plan and the task (`extractFirstTaskRequest`). One source,
* so client and server cannot drift.
*
* Pure and browser-safe: no imports.
*/
/** The product name the app's prompts carry (the email words its own brand). */
const FIRST_TASK_PROMPT_BRAND = "Levr";
/**
* The opening of a first-task prompt for a brand: `Use <brand> to hold you to
* this task: `. Review F-061: the nudge email builds its prompt with the
* brand it is sent under, so the backender strips this framing for ANY
* single-word brand, not only the literal "Levr".
*/
function firstTaskPromptPrefix(brandName) {
	return `Use ${brandName} to hold you to this task: `;
}
/** Opens every first-task prompt; an instruction to the agent, never the task. */
const FIRST_TASK_PROMPT_PREFIX = firstTaskPromptPrefix(FIRST_TASK_PROMPT_BRAND);
/**
* The fixed todo-starter task, in the first-task card's words (plan ENG-6341
* D4, the `todo-starter` recipe). Code review F-007 (ENG-7148): ONE source for
* the card the user copies from and the `get_context` example the agent reads.
*/
const FIRST_TASK_TODO_TASK = "build a tiny TypeScript todo app with tests: add, complete, delete; reject empty or whitespace-only titles; completing a todo twice is a no-op.";
/**
* The todo-starter prompt: what the first-task card copies and what
* `get_context` offers an owner's agent as `first_task.example_prompt`.
*/
const FIRST_TASK_TODO_PROMPT = `${FIRST_TASK_PROMPT_PREFIX}in this empty folder, ${FIRST_TASK_TODO_TASK}`;

//#endregion
//#region ../shared/dist/ai-pricing/rate-card.js
const PER_TOKEN = 1 / 1e6;

//#endregion
//#region ../shared/dist/schemas/ai-usage-batch.zod.js
const AI_USAGE_BATCH_VERSION = 1;
const AiUsageBatchEntrySchema = z.object({
	workspace_id: z.string().uuid().nullable(),
	provider: z.string().min(1).max(64),
	model: z.string().min(1).max(128),
	calls: z.number().int().positive().max(1e7),
	input_tokens: z.number().int().nonnegative().max(0xe8d4a51000).nullable(),
	latency_ms: z.number().int().nonnegative().max(0xe8d4a51000)
});
const AiUsageBatchSchema = z.object({
	v: z.literal(AI_USAGE_BATCH_VERSION),
	batch_id: z.string().min(1).max(64),
	flushed_at: z.string().datetime(),
	entries: z.array(AiUsageBatchEntrySchema).min(1).max(5e3)
});

//#endregion
//#region src/commands/gates/bindingsHandler.ts
function fail(code, cmd, message) {
	return {
		exitCode: code,
		stdout: "",
		stderr: `gates bindings ${cmd}: ${message}\n`
	};
}
/** The server's own message for a refusal (Nest puts it in `message`). */
function serverMessage(body, status) {
	if (body && typeof body === "object") {
		const m = body.message;
		if (typeof m === "string") return m;
		if (Array.isArray(m)) return m.map(String).join("; ");
	}
	if (typeof body === "string" && body.trim()) return body.trim();
	return `HTTP ${status}`;
}
function tierLabel(b) {
	if (b.repo_key == null) return "workspace-wide";
	return b.path_prefix ? `${b.repo_key}:${b.path_prefix}` : b.repo_key;
}
/** `export`: the file on stdout, or written to `--out`. */
async function executeBindingsExport(flags, deps) {
	let reply;
	try {
		reply = await deps.exportConfig();
	} catch (err) {
		return fail(1, "export", `request failed: ${err instanceof Error ? err.message : String(err)}`);
	}
	if (reply.status !== 200) return fail(1, "export", serverMessage(reply.body, reply.status));
	const text = `${JSON.stringify(reply.body, null, 2)}\n`;
	if (!flags.out) return {
		exitCode: 0,
		stdout: text,
		stderr: ""
	};
	try {
		deps.writeFile(flags.out, text);
	} catch (err) {
		return fail(2, "export", `cannot write ${flags.out}: ${err instanceof Error ? err.message : String(err)}`);
	}
	const body = reply.body;
	return {
		exitCode: 0,
		stdout: "",
		stderr: `Wrote ${flags.out}: ${body.bindings?.length ?? 0} binding(s), ${body.definitions?.length ?? 0} definition(s).\n`
	};
}
/** `import <file>`: check locally, then apply (or preview with --dry-run). */
async function executeBindingsImport(flags, file, deps) {
	let raw;
	try {
		raw = JSON.parse(deps.readFile(file));
	} catch (err) {
		return fail(2, "import", `cannot read ${file} as JSON: ${err instanceof Error ? err.message : String(err)}`);
	}
	let payload;
	try {
		payload = parsePayload(raw);
		validatePayload(payload);
	} catch (err) {
		if (err instanceof PayloadError) return fail(2, "import", `${file} refused, nothing sent: ${err.message}`);
		throw err;
	}
	const out = [];
	if (flags["repo-root"]) {
		const root = flags["repo-root"];
		const missing = missingFiles(payload, (rel) => deps.exists(root, rel));
		for (const f of namedFiles(payload)) out.push(`${missing.includes(f) ? "MISSING" : "present"}  ${f}`);
		if (missing.length > 0) return {
			exitCode: 1,
			stdout: `${out.join("\n")}\n`,
			stderr: `gates bindings import: ${missing.length} file(s) the lanes name are missing under ${root}; nothing sent\n`
		};
	}
	let reply;
	try {
		reply = await deps.importConfig(raw, flags["dry-run"]);
	} catch (err) {
		return fail(1, "import", `request failed: ${err instanceof Error ? err.message : String(err)}` + (flags["dry-run"] ? "" : " (the import may or may not have been applied; run it with --dry-run to see)"));
	}
	if (reply.status !== 200) return fail(1, "import", serverMessage(reply.body, reply.status));
	const result = reply.body;
	for (const d of result.definitions ?? []) out.push(`${d.action.padEnd(8)} definition ${d.key}`);
	for (const b of result.bindings ?? []) {
		const differs$1 = b.action === "differs" ? "  (NOT applied: the stored row differs)" : "";
		const note = b.note ? `  # ${b.note}` : "";
		out.push(`${b.action.padEnd(8)} ${b.gate_key} [${tierLabel(b)}]${differs$1}${note}`);
	}
	const rows = [...result.definitions ?? [], ...result.bindings ?? []];
	const written = rows.filter((r) => r.applied).length;
	out.push(result.dry_run ? "# Dry run: nothing written. Run again without --dry-run to apply." : `# Applied: ${written} row(s) written.`);
	const differs = rows.filter((r) => r.action === "differs").length;
	return {
		exitCode: differs > 0 ? 1 : 0,
		stdout: `${out.join("\n")}\n`,
		stderr: differs > 0 ? `gates bindings import: ${differs} row(s) differ from what the workspace stores and were not applied; change them in the workspace on purpose, or delete them and import again.\n` : ""
	};
}
/** The real dependencies: the logged-in backend (the public SDK), the disk. */
async function liveDeps(workspaceFlag) {
	let auth;
	try {
		auth = await resolveToken();
	} catch (err) {
		return fail(1, "auth", err instanceof Error ? err.message : "Authentication failed.");
	}
	configureClient(auth);
	try {
		const ws = await resolveWorkspaceFor(auth, workspaceFlag);
		if (ws) client.setConfig({
			...client.getConfig(),
			workspaceId: ws.workspaceId
		});
	} catch (err) {
		return fail(1, "workspace", err instanceof Error ? err.message : "Workspace resolution failed.");
	}
	const reply = (r) => ({
		status: r.response.status,
		body: r.ok ? r.data : r.error
	});
	return {
		exportConfig: async () => reply(await gateBindingTransferExportConfigV1()),
		importConfig: async (file, dryRun) => reply(await gateBindingTransferImportConfigV1({
			body: file,
			...dryRun ? { query: { dry_run: "true" } } : {}
		})),
		readFile: (file) => fs.readFileSync(file, "utf8"),
		writeFile: (file, content) => fs.writeFileSync(file, content),
		exists: (root, rel) => fs.existsSync(path$1.join(root, rel))
	};
}
function emit(ctx, outcome) {
	if (outcome.stdout) ctx.process.stdout.write(outcome.stdout);
	if (outcome.stderr) ctx.process.stderr.write(outcome.stderr);
	ctx.process.exitCode = outcome.exitCode;
}
async function gatesBindingsExportHandler(flags) {
	const deps = await liveDeps(flags["workspace-id"]);
	if ("exitCode" in deps) return emit(this, deps);
	emit(this, await executeBindingsExport(flags, deps));
}
async function gatesBindingsImportHandler(flags, file) {
	let preflight = null;
	try {
		validatePayload(parsePayload(JSON.parse(fs.readFileSync(file, "utf8"))));
	} catch (err) {
		preflight = fail(2, "import", err instanceof PayloadError ? `${file} refused, nothing sent: ${err.message}` : `cannot read ${file} as JSON: ${err instanceof Error ? err.message : String(err)}`);
	}
	if (preflight) return emit(this, preflight);
	const deps = await liveDeps(flags["workspace-id"]);
	if ("exitCode" in deps) return emit(this, deps);
	emit(this, await executeBindingsImport(flags, file, deps));
}

//#endregion
export { gatesBindingsExportHandler, gatesBindingsImportHandler };