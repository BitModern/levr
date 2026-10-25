import { z } from "zod";

//#region ../shared/dist/runs/gate-pattern.js
/**
* POSIX ERE → JS `RegExp` translation for gate patterns (ENG-7246).
*
* Moved from the CLI's `gates inspect` builtins so the server and the seed
* specs read a pattern with the same parser the CLI runs: a pattern the CLI
* refuses is caught before it ships, not when a gate is verified.
*/
const POSIX_CLASSES = {
	alpha: "A-Za-z",
	digit: "0-9",
	alnum: "A-Za-z0-9",
	upper: "A-Z",
	lower: "a-z",
	space: " \\t\\n\\r\\f\\v",
	blank: " \\t",
	punct: "!-\\/:-@\\[-`{-~",
	xdigit: "0-9A-Fa-f",
	cntrl: "\\x00-\\x1f\\x7f",
	print: "\\x20-\\x7e",
	graph: "\\x21-\\x7e",
	word: "A-Za-z0-9_"
};
/**
* Translate a POSIX ERE (what `grep -E` read) into a JS `RegExp` source.
*
* Bracket classes become their JS ranges. Syntax that `grep` and JS read
* differently, and that has no faithful translation, is refused with a
* reason: GNU word anchors `\<` `\>`, buffer anchors, collating and
* equivalence classes, a backslash inside a bracket expression (literal to
* grep, an escape to JS), and a back-reference to a group that does not
* exist (an octal escape to JS). Refusing is the point: a `not_contains`
* whose pattern silently stopped matching is a false pass.
*/
function translatePosixEre(pattern) {
	let out = "";
	let groups = 0;
	for (let i = 0; i < pattern.length; i++) if (pattern[i] === "\\") i += 1;
	else if (pattern[i] === "(" && pattern[i + 1] !== "?") groups += 1;
	for (let i = 0; i < pattern.length; i++) {
		const ch = pattern[i] ?? "";
		if (ch === "\\") {
			const next = pattern[i + 1];
			if (next === void 0) return { error: "pattern ends with a backslash" };
			if (next === "<" || next === ">") return { error: `\\${next} is a GNU word anchor with no JS equivalent; use \\b` };
			if (next === "`" || next === "'") return { error: `\\${next} is a GNU buffer anchor; use ^ or $` };
			if (/[1-9]/.test(next) && Number(next) > groups) return { error: `back-reference \\${next} names a group the pattern does not have` };
			out += ch + next;
			i += 1;
			continue;
		}
		if (ch !== "[") {
			out += ch;
			continue;
		}
		let j = i + 1;
		let body = "";
		if (pattern[j] === "^") {
			body += "^";
			j += 1;
		}
		if (pattern[j] === "]") {
			body += "\\]";
			j += 1;
		}
		let closed = false;
		while (j < pattern.length) {
			const c = pattern[j] ?? "";
			if (c === "]") {
				closed = true;
				break;
			}
			if (c === "[" && (pattern[j + 1] === ":" || pattern[j + 1] === "=" || pattern[j + 1] === ".")) {
				const kind = pattern[j + 1];
				const end = pattern.indexOf(`${kind}]`, j + 2);
				if (end === -1) return { error: `unterminated [${kind} in a bracket expression` };
				const name = pattern.slice(j + 2, end);
				if (kind !== ":") return { error: `[${kind}${name}${kind}] has no JS equivalent` };
				const range = POSIX_CLASSES[name];
				if (range === void 0) return { error: `unknown class [:${name}:]` };
				body += range;
				j = end + 2;
				continue;
			}
			if (c === "\\") return { error: "a backslash inside [...] is literal to grep and an escape to JS; use a POSIX class or move it outside the brackets" };
			if (c === "[") body += "\\[";
			else body += c;
			j += 1;
		}
		if (!closed) return { error: "unterminated bracket expression" };
		out += `[${body}]`;
		i = j;
	}
	return out;
}

//#endregion
//#region ../shared/dist/runs/gate-op.js
const GATE_OP_CONTRACT_VERSION = 1;
const REPO_RELATIVE = "path must be repo-relative and must not contain ..";
/** Repo-relative, no `..` segment, not absolute, not home-relative. */
function isRepoRelative(value) {
	if (value.length === 0 || value.includes("\0")) return false;
	if (value.startsWith("/") || value.startsWith("~") || /^[A-Za-z]:[\\/]/.test(value)) return false;
	return !value.split(/[\\/]/).includes("..");
}
const RepoRelativeCwd = z.string().refine(isRepoRelative, REPO_RELATIVE);
const RepoRelativePath = z.string().refine(isRepoRelative, REPO_RELATIVE);
const SandboxProfileSchema = z.object({
	network_hosts: z.array(z.string()),
	ports: z.array(z.number().int().nonnegative()),
	read_paths: z.array(z.string()),
	write_paths: z.array(z.string()),
	env_allow: z.array(z.string()),
	loopback: z.boolean(),
	unsandboxed_on: z.array(z.enum(["linux", "wsl2"])).optional(),
	unsandboxed_reason: z.string().optional()
});
const InspectPathParams = z.object({
	path: RepoRelativePath,
	glob: z.boolean().optional()
}).strict();
const ContainsParams = z.object({
	path: RepoRelativePath,
	glob: z.boolean().optional(),
	pattern: z.string().optional(),
	keywords: z.array(z.string()).optional(),
	literal: z.boolean().optional()
}).strict().superRefine((params, ctx) => {
	const hasPattern = params.pattern != null && params.pattern.length > 0;
	const hasKeywords = (params.keywords?.length ?? 0) > 0;
	if (!hasPattern && !hasKeywords) ctx.addIssue({
		code: z.ZodIssueCode.custom,
		message: "contains needs a pattern or keywords"
	});
});
const DoneCriteriaParams = z.object({
	path: RepoRelativePath,
	glob: z.boolean().optional(),
	requirements: z.array(z.union([z.string(), z.object({
		pattern: z.string(),
		label: z.string().optional()
	}).strict()])).nonempty()
}).strict();
const JsonHasKeyParams = z.object({
	path: RepoRelativePath,
	glob: z.boolean().optional(),
	key: z.string().min(1),
	object: z.string().min(1).optional()
}).strict();
const SpecColumnsParams = z.object({
	path: RepoRelativePath,
	glob: z.boolean().optional(),
	required_columns: z.union([z.string().min(1), z.array(z.string()).nonempty()])
}).strict();
const ArgvOpSchema = z.object({
	op: z.literal("argv"),
	cwd: RepoRelativeCwd,
	argv: z.array(z.string()).nonempty()
}).strict();
const InspectOpSchema = z.discriminatedUnion("check", [
	z.object({
		op: z.literal("inspect"),
		check: z.literal("exists"),
		params: InspectPathParams
	}).strict(),
	z.object({
		op: z.literal("inspect"),
		check: z.literal("not_exists"),
		params: InspectPathParams
	}).strict(),
	z.object({
		op: z.literal("inspect"),
		check: z.literal("contains"),
		params: ContainsParams
	}).strict(),
	z.object({
		op: z.literal("inspect"),
		check: z.literal("not_contains"),
		params: ContainsParams
	}).strict(),
	z.object({
		op: z.literal("inspect"),
		check: z.literal("done_criteria"),
		params: DoneCriteriaParams
	}).strict(),
	z.object({
		op: z.literal("inspect"),
		check: z.literal("json_has_key"),
		params: JsonHasKeyParams
	}).strict(),
	z.object({
		op: z.literal("inspect"),
		check: z.literal("spec_columns"),
		params: SpecColumnsParams
	}).strict(),
	z.object({
		op: z.literal("inspect"),
		check: z.literal("migration_down_scope"),
		params: InspectPathParams
	}).strict()
]);
const JudgeOpSchema = z.object({
	op: z.literal("judge"),
	path: RepoRelativePath,
	rubric: z.string(),
	output_schema: z.string(),
	judge_prompt: z.string(),
	model: z.string().min(1),
	runner: z.literal("agy"),
	max_input_bytes: z.number().int().positive()
}).strict();
const GateOpSchema = z.union([
	ArgvOpSchema,
	InspectOpSchema,
	JudgeOpSchema
]);
const AuthoringSourceSchema = z.object({
	kind: z.enum(["binding", "definition"]),
	id: z.string().uuid(),
	workspace_id: z.string().uuid()
}).strict();
/**
* fail_closed: both `op` and `legacy_command`, or neither, is refused.
* A legacy carrier also keeps its authored `legacy_template` when the
* converter could not turn the template into argv.
*/
const GateOpEnvelopeSchema = z.object({
	contract_version: z.literal(GATE_OP_CONTRACT_VERSION),
	op: GateOpSchema.optional(),
	legacy_command: z.string().min(1).optional(),
	legacy_template: z.string().optional(),
	link_id: z.string().uuid(),
	step_id: z.string().optional(),
	rule_hash: z.string().optional(),
	expected: z.string(),
	provenance: z.enum([
		"seeded",
		"binding",
		"workspace_template",
		"legacy",
		"replicated"
	]),
	authored_digest: z.string().min(1),
	content_digest: z.string().min(1),
	authoring_source: AuthoringSourceSchema.optional(),
	approval: z.enum([
		"server_approved",
		"confirm",
		"denied"
	]),
	approval_basis: z.enum([
		"kind",
		"default_list",
		"workspace_list"
	]).optional(),
	matched_pattern: z.string().optional(),
	suggested_pattern: z.string().optional(),
	sandbox: z.object({
		mode: z.enum(["on", "off-by-gate"]),
		profile: SandboxProfileSchema
	}).strict(),
	untested: z.boolean().optional(),
	display: z.object({
		posix: z.string(),
		powershell: z.string()
	}).strict()
}).strict().superRefine((value, ctx) => {
	if (value.op !== void 0 === (value.legacy_command !== void 0)) ctx.addIssue({
		code: z.ZodIssueCode.custom,
		message: "fail_closed: envelope must carry exactly one of op and legacy_command"
	});
});

//#endregion
export { GateOpSchema, translatePosixEre };