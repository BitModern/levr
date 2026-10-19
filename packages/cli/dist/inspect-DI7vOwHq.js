import { buildCommand } from "@stricli/core";
import { z } from "zod";
import * as fs from "node:fs";
import path from "node:path";

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
//#region src/commands/gates/migration-down-scope.ts
/**
* The `migration_revert_scope` check — ENG-5106 L3a.
*
* For every path given: find the migration's `down()` and report each
* statement in it that empties a table — a `DELETE FROM` with no `WHERE`, a
* `TRUNCATE` statement, `queryRunner.clearTable()`, or TypeORM's own:
* `.clear(X)` on an entity manager, `.clear()` on a repository (one got
* from `getRepository`, or named `…repo` / `…repository`), `.delete({})` /
* `manager.delete(X, {})`, or a query-builder `.delete()` with no
* `.where` in its chain. Logs one line per path and returns the exit code
* (0 = nothing unscoped, 1 = anything else).
*
* It reads the source the way JavaScript does, not as raw text:
* - EVERY `down` with a body is read (class method, arrow or function
*   property, `down: …`), not just the first, and so is every same-file
*   function, method or arrow — braced or expression-bodied, `q => …`
*   included — whose NAME a body mentions, transitively, however it is
*   reached: `this.wipe(q)`, `M.wipe(q)`, `H.wipe(q)`, `run(wipe(q))`,
*   `ids.forEach(wipe)`. Reading too much can only fail a file, never pass
*   one.
* - Bodies are found by matching braces, skipping strings, template
*   literals, comments and regex literals, so a `}` inside a SQL string (a
*   JSON value, say) cannot end one early, and indentation does not matter.
*   A `/` starts a regex after an operator, after a keyword such as
*   `return`, `in` or `void`, and after the `)` of an `if`/`while`/`for`
*   head; after `++`/`--` or any other `)` it is division.
* - SQL is read only from string and template literals inside those bodies,
*   with their JS escapes (`\n`, `\'`, `\x57`, `\u0020`) applied, so the
*   JS `delete` operator is never mistaken for SQL and a `where` in code cannot scope a DELETE.
*   Within a literal the SQL is scanned left to right: quoted values and
*   identifiers ('…' with '' escapes, E'…', "…") and comments (--, block)
*   are opaque, a dollar- or quote-delimited PL/pgSQL body ($$…$$,
*   $fn$…$fn$, DO '…') — and the string a PL/pgSQL
*   `EXECUTE` / `EXECUTE format(` runs — is checked as SQL of its own (a
*   TRUNCATE there may follow BEGIN / THEN / ELSE / LOOP / DO), and
*   a DELETE is judged at its own bracket depth up to its own `;` or
*   closing `)`, so a CTE's DELETE never borrows another statement's WHERE
*   and a subquery's WHERE never scopes the outer DELETE. Literals joined by
*   `+` (directly or around one identifier) are read as one.
* - A DELETE whose table is not a literal (`'DELETE FROM ' + t`, a template
*   `${t}`) is reported as `(dynamic)` rather than crashing.
*
* Known limits, which fail OPEN (ENG-6316): SQL held in a constant outside
* the bodies read; a helper reached only through an alias
* (`const c = wipe`) or a factory; and PL/pgSQL `EXECUTE` of a variable,
* a parenthesised string or an `E'…'` string.
*
* WHY IT IS ONE SELF-CONTAINED FUNCTION: the seeded gate template inlines its
* compiled source into `node -e` (see `inlineNodeCheck`), so the gate runs in
* any repository with Node and needs no file from this one (ENG-6290 is what
* a repo-local runner costs). It may therefore use nothing from outside its
* own body, and no line comments inside it (the source is joined onto one
* line); `inlineNodeCheck` refuses the latter at module load.
*/
function migrationRevertScopeCheck(fs$1, paths, log) {
	const SQ = 39;
	const DQ = 34;
	const BT = 96;
	const BS = 92;
	const SL = 47;
	const ST = 42;
	const NL = 10;
	const DOLLAR = 36;
	const OB = 123;
	const CB = 125;
	const NOT_A_HELPER = /^(break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|function|if|import|in|instanceof|let|new|return|super|switch|this|throw|try|typeof|var|void|while|with|yield|async|await|of|static|get|set|constructor|require|down)$/;
	function unescape(raw) {
		let text = "";
		for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) === BS && i + 1 < raw.length) {
			const n = raw[i + 1];
			const hex = n === "x" ? /^[0-9a-fA-F][0-9a-fA-F]/.exec(raw.slice(i + 2)) : n === "u" && raw.charCodeAt(i + 2) === OB ? /^.([0-9a-fA-F]+)./.exec(raw.slice(i + 2)) : n === "u" ? /^[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]/.exec(raw.slice(i + 2)) : null;
			if (hex) {
				text += String.fromCodePoint(parseInt(hex[1] || hex[0], 16));
				i += 1 + hex[0].length;
			} else {
				text += n === "n" ? "\n" : n === "t" ? "	" : n === "r" ? "\r" : n;
				i++;
			}
		} else text += raw[i];
		return text;
	}
	function lex(src) {
		const out = src.split("");
		const lits = [];
		const blank = (a, b) => {
			for (let k = a; k < b && k < out.length; k++) if (out[k] !== "\n") out[k] = " ";
		};
		const regexAllowed = (i) => {
			let k = i - 1;
			while (k >= 0 && /\s/.test(src[k])) k--;
			if (k < 0) return true;
			const c = src[k];
			if (/[\w$]/.test(c)) {
				let w = k;
				while (w >= 0 && /[\w$]/.test(src[w])) w--;
				return /^(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/.test(src.slice(w + 1, k + 1));
			}
			if (c === ")") {
				let depth = 0;
				let o = k;
				for (; o >= 0; o--) if (out[o] === ")") depth++;
				else if (out[o] === "(") {
					depth--;
					if (depth === 0) break;
				}
				let w = o - 1;
				while (w >= 0 && /\s/.test(src[w])) w--;
				let s = w;
				while (s >= 0 && /\w/.test(src[s])) s--;
				return /^(if|while|for|with)$/.test(src.slice(s + 1, w + 1));
			}
			if ((c === "+" || c === "-") && src[k - 1] === c) return false;
			return "(,=:[!&|?{};+-*%<>~^".includes(c);
		};
		const quoted = (i, q) => {
			let j = i + 1;
			while (j < src.length && src.charCodeAt(j) !== q && src.charCodeAt(j) !== NL) j += src.charCodeAt(j) === BS ? 2 : 1;
			lits.push({
				start: i,
				end: j + 1,
				text: unescape(src.slice(i + 1, j))
			});
			blank(i, j + 1);
			return j + 1;
		};
		const template = (i) => {
			let j = i + 1;
			let text = "";
			blank(i, i + 1);
			while (j < src.length && src.charCodeAt(j) !== BT) if (src.charCodeAt(j) === BS) {
				const kind = src[j + 1];
				const braced = /^.([0-9a-fA-F]+)./.exec(src.slice(j + 2, j + 12));
				let len = 2;
				if (kind === "x" && /^[0-9a-fA-F][0-9a-fA-F]/.test(src.slice(j + 2, j + 4))) len = 4;
				else if (kind === "u" && src.charCodeAt(j + 2) === OB && braced && braced[0].charCodeAt(braced[0].length - 1) === CB) len = 2 + braced[0].length;
				else if (kind === "u" && /^[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]/.test(src.slice(j + 2, j + 6))) len = 6;
				text += unescape(src.slice(j, j + len));
				blank(j, j + len);
				j += len;
			} else if (src.charCodeAt(j) === DOLLAR && src.charCodeAt(j + 1) === OB) {
				blank(j, j + 2);
				const close = code(j + 2, true);
				blank(close, close + 1);
				text += " ? ";
				j = close + 1;
			} else {
				text += src[j];
				blank(j, j + 1);
				j++;
			}
			blank(j, j + 1);
			lits.push({
				start: i,
				end: j + 1,
				text
			});
			return j + 1;
		};
		function code(i, stopAtBrace) {
			let depth = 0;
			let j = i;
			while (j < src.length) {
				const c = src.charCodeAt(j);
				const next = src.charCodeAt(j + 1);
				if (c === SL && next === SL) {
					let e = src.indexOf("\n", j);
					if (e < 0) e = src.length;
					blank(j, e);
					j = e;
				} else if (c === SL && next === ST) {
					let e = src.indexOf("*/", j + 2);
					e = e < 0 ? src.length : e + 2;
					blank(j, e);
					j = e;
				} else if (c === SL && regexAllowed(j)) {
					let e = j + 1;
					let inClass = false;
					while (e < src.length && src.charCodeAt(e) !== NL) {
						const d = src.charCodeAt(e);
						if (d === BS) {
							e += 2;
							continue;
						}
						if (d === 91) inClass = true;
						else if (d === 93) inClass = false;
						else if (d === SL && !inClass) break;
						e++;
					}
					blank(j, e + 1);
					j = e + 1;
				} else if (c === SQ || c === DQ) j = quoted(j, c);
				else if (c === BT) j = template(j);
				else {
					if (c === OB) depth++;
					else if (c === CB) {
						if (stopAtBrace && depth === 0) return j;
						depth--;
					}
					j++;
				}
			}
			return j;
		}
		code(0, false);
		lits.sort((a, b) => a.start - b.start);
		return {
			masked: out.join(""),
			lits
		};
	}
	function bodyAfter(m, from) {
		let j = from;
		while (j < m.length && /\s/.test(m[j])) j++;
		if (m[j] === ":") {
			j++;
			let depth$1 = 0;
			let typed = false;
			while (j < m.length) {
				const c = m[j];
				if (depth$1 === 0 && c === "=" && m[j + 1] === ">") break;
				if (depth$1 === 0 && c === ";") return null;
				if (depth$1 === 0 && c === "{" && typed) {
					let k = j - 1;
					while (k >= 0 && /\s/.test(m[k])) k--;
					if (!"|&:<,".includes(m[k])) break;
				}
				if (c === "<" || c === "{" || c === "(" || c === "[") depth$1++;
				else if (c === ">" && m[j - 1] !== "=" || c === "}" || c === ")" || c === "]") depth$1--;
				if (!/\s/.test(c)) typed = true;
				j++;
			}
		}
		if (m[j] === "=" && m[j + 1] === ">") {
			j += 2;
			while (j < m.length && /\s/.test(m[j])) j++;
			if (m.charCodeAt(j) !== OB) {
				let depth$1 = 0;
				let e = j;
				for (; e < m.length; e++) {
					const c = m[e];
					if (c === "(" || c === "[" || c === "{") depth$1++;
					else if (c === ")" || c === "]" || c === "}") {
						if (depth$1 === 0) break;
						depth$1--;
					} else if (depth$1 === 0 && (c === ";" || c === ",")) break;
				}
				return [j - 1, e];
			}
		}
		if (m.charCodeAt(j) !== OB) return null;
		let depth = 0;
		for (let e = j; e < m.length; e++) if (m.charCodeAt(e) === OB) depth++;
		else if (m.charCodeAt(e) === CB) {
			depth--;
			if (depth === 0) return [j, e];
		}
		return null;
	}
	function bodiesOf(m, name) {
		const safe = name.split("$").join("\\$");
		const re = new RegExp("(?:^|[^\\w$.])" + safe + "\\s*(?:=\\s*(?:async\\s*)?(?:function\\s*\\w*\\s*)?|:\\s*(?:async\\s*)?(?:function\\s*\\w*\\s*)?)?\\(", "g");
		const found = [];
		for (let hit = re.exec(m); hit; hit = re.exec(m)) {
			let j = hit.index + hit[0].length;
			let parens = 1;
			while (j < m.length && parens > 0) {
				if (m[j] === "(") parens++;
				else if (m[j] === ")") parens--;
				j++;
			}
			const body = bodyAfter(m, j);
			if (body) found.push(body);
		}
		const bare = new RegExp("(?:^|[^\\w$.])" + safe + "\\s*[=:]\\s*(?:async\\s+)?[A-Za-z_$][\\w$]*\\s*(?==>)", "g");
		for (let hit = bare.exec(m); hit; hit = bare.exec(m)) {
			const body = bodyAfter(m, hit.index + hit[0].length);
			if (body) found.push(body);
		}
		return found;
	}
	function sqlMask(sql, nested, inBlock) {
		let lastString = -1;
		let m = "";
		const depth = [];
		let d = 0;
		const blankTo = (from, to) => {
			for (let k = from; k < to; k++) {
				m += " ";
				depth.push(d);
			}
		};
		let i = 0;
		while (i < sql.length) {
			const c = sql.charCodeAt(i);
			const tag = c === DOLLAR ? /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(i)) : null;
			if (c === SQ || c === DQ) {
				const eString = c === SQ && i > 0 && /[eE]/.test(sql[i - 1]) && !(i > 1 && /\w/.test(sql[i - 2]));
				let e = i + 1;
				while (e < sql.length) {
					const d$1 = sql.charCodeAt(e);
					if (eString && d$1 === BS) e += 2;
					else if (d$1 === c && sql.charCodeAt(e + 1) === c) e += 2;
					else if (d$1 === c) break;
					else e++;
				}
				const end = Math.min(e + 1, sql.length);
				if (c === SQ && (inBlock || /\b(?:execute\s*(?:format\s*\(\s*)?[eE]?|do\s*(?:language\s+\w+\s*)?)(?![^])/i.test(sql.slice(0, i)))) {
					const body = sql.slice(i + 1, e).split(String.fromCharCode(SQ, SQ)).join(String.fromCharCode(SQ));
					if (lastString >= 0 && /^\s*\|\|\s*[eE]?(?![^])/.test(sql.slice(lastString, i))) nested[nested.length - 1] += body;
					else nested.push(body);
					lastString = end;
				}
				blankTo(i, end);
				i = end;
			} else if (tag) {
				const open = i + tag[0].length;
				const close = sql.indexOf(tag[0], open);
				const end = close < 0 ? sql.length : close + tag[0].length;
				nested.push(sql.slice(open, close < 0 ? sql.length : close));
				blankTo(i, end);
				i = end;
			} else if (c === 45 && sql.charCodeAt(i + 1) === 45) {
				let e = sql.indexOf("\n", i);
				if (e < 0) e = sql.length;
				blankTo(i, e);
				i = e;
			} else if (c === SL && sql.charCodeAt(i + 1) === ST) {
				let e = sql.indexOf("*/", i + 2);
				e = e < 0 ? sql.length : e + 2;
				blankTo(i, e);
				i = e;
			} else {
				if (c === 41 && d > 0) d--;
				m += sql[i];
				depth.push(d);
				if (c === 40) d++;
				i++;
			}
		}
		return {
			m,
			depth
		};
	}
	function unscopedIn(sql, inBlock) {
		const nested = [];
		const { m, depth } = sqlMask(sql, nested, inBlock);
		let found = [];
		const re = inBlock ? /\bdelete\s+from\b|(?:^|[;(]|\b(?:begin|then|else|loop|do)\b)\s*(truncate)\s/gi : /\bdelete\s+from\b|(?:^|[;(])\s*(truncate)\s/gi;
		for (let hit = re.exec(m); hit; hit = re.exec(m)) {
			const isTruncate = hit[1] !== void 0;
			if (!isTruncate) {
				const level = depth[hit.index];
				let scope = "";
				for (let e = hit.index + hit[0].length; e < m.length; e++) {
					if (depth[e] < level || m[e] === ";" && depth[e] === level) break;
					scope += depth[e] === level ? m[e] : " ";
				}
				if (/\bwhere\b/i.test(scope)) continue;
			}
			const name = (isTruncate ? /^\s*(?:table\s+)?(?:only\s+)?((?:"[^"]*"|[^\s,();"]+)+)/i : /^\s*(?:only\s+)?((?:"[^"]*"|[^\s,();"]+)+)/i).exec(sql.slice(hit.index + hit[0].length));
			let table = name ? name[1].split("").filter((ch) => ch.charCodeAt(0) !== DQ && ch.charCodeAt(0) !== BS).join("").trim() : "";
			if (table === "" || table === "?") table = "(dynamic)";
			found.push((isTruncate ? "TRUNCATE " : "DELETE FROM ") + table);
		}
		for (const inner of nested) found = found.concat(unscopedIn(inner, true));
		return found;
	}
	function check(p) {
		if (!fs$1.existsSync(p)) {
			log("no file matches: " + p);
			return false;
		}
		if (fs$1.statSync(p).isDirectory()) {
			log(p + " is a directory: name the migration file, or a glob that matches only files, such as dir/*AddFoo*.ts");
			return false;
		}
		const lexed = lex(String(fs$1.readFileSync(p, "utf-8")));
		const m = lexed.masked;
		const bodies = bodiesOf(m, "down");
		if (bodies.length === 0) {
			log(p + ": no down method");
			return false;
		}
		const seen = /* @__PURE__ */ new Set();
		for (let b = 0; b < bodies.length && b < 500; b++) {
			const text = m.slice(bodies[b][0], bodies[b][1]);
			const names = /[A-Za-z_$][\w$]*/g;
			for (let c = names.exec(text); c; c = names.exec(text)) {
				const name = c[0];
				if (seen.has(name) || NOT_A_HELPER.test(name)) continue;
				seen.add(name);
				for (const body of bodiesOf(m, name)) bodies.push(body);
			}
		}
		const repos = [];
		const repoDecl = /(?:\b(?:const|let|var)\s+|\bthis\s*\.\s*)([A-Za-z_$][\w$]*)\s*=\s*[^;]*?\bget(?:Tree)?Repository\s*\(/g;
		for (let d = repoDecl.exec(m); d; d = repoDecl.exec(m)) repos.push(d[1]);
		const inBody = (start, end) => bodies.some((b) => start > b[0] && end <= b[1]);
		const unscoped = [];
		for (const b of bodies) {
			const text = m.slice(b[0], b[1]);
			if (/\.clearTable\s*\(/.test(text)) unscoped.push("clearTable()");
			if (/\.\s*clear\s*\(\s*[^\s)]/.test(text) || /\b(?:manager|em|entityManager)\s*\.\s*clear\s*\(/.test(text) || /\w*(?:repo|repository)\s*\.\s*clear\s*\(/i.test(text) || /\bget(?:Tree)?Repository\s*\([^)]*\)\s*\.\s*clear\s*\(/.test(text) || repos.some((r) => (/* @__PURE__ */ new RegExp("(?:^|[^\\w$.])" + r.split("$").join("\\$") + "\\s*\\.\\s*clear\\s*\\(")).test(text))) unscoped.push("clear()");
			if (/\.\s*delete\s*\(\s*(?:[^,()]*,\s*)?\{\s*\}\s*,?\s*\)/.test(text)) unscoped.push("delete({})");
			if (/\.\s*delete\s*\(\s*\)(?!(?:\s*\.\s*[\w$]+\s*\([^()]*\))*\s*\.\s*(?:where|andWhere|orWhere|whereInIds)\s*\()/.test(text)) unscoped.push("delete() with no where");
		}
		const mine = lexed.lits.filter((lit) => inBody(lit.start, lit.end));
		const joined = /* @__PURE__ */ new Set();
		for (let a = 0; a < mine.length; a++) {
			let b = a;
			while (b + 1 < mine.length && /^\s*,\s*(?![^])/.test(m.slice(mine[b].end, mine[b + 1].start))) b++;
			if (b > a && /^\s*,?\s*\]\s*\.\s*join\s*\(/.test(m.slice(mine[b].end, mine[b].end + 80))) for (let k = a + 1; k <= b; k++) joined.add(mine[k]);
			a = b;
		}
		const sqls = [];
		let prev = null;
		for (const lit of mine) {
			const gap = prev ? m.slice(prev.end, lit.start) : "";
			if (joined.has(lit)) sqls[sqls.length - 1] += " " + lit.text;
			else if (prev && prev.end <= lit.start && /^\s*[+]\s*(?![^])/.test(gap)) sqls[sqls.length - 1] += lit.text;
			else if (prev && prev.end <= lit.start && /^\s*[+]\s*[\w.]+\s*[+]\s*(?![^])/.test(gap)) sqls[sqls.length - 1] += " ? " + lit.text;
			else sqls.push(lit.text);
			prev = lit;
		}
		for (const sql of sqls) for (const hit of unscopedIn(sql, false)) unscoped.push(hit);
		if (unscoped.length > 0) {
			log(p + ": unscoped " + unscoped.join(","));
			return false;
		}
		log(p + ": all scoped");
		return true;
	}
	if (paths.length === 0) {
		log("no file given");
		return 1;
	}
	let bad = 0;
	for (const p of paths) try {
		if (!check(p)) bad = 1;
	} catch (e) {
		log(p + ": could not be checked: " + (e instanceof Error ? e.message : String(e)));
		bad = 1;
	}
	return bad;
}

//#endregion
//#region src/commands/gates/builtins.ts
function finish(exitCode, stdout, stderr = "") {
	return {
		exitCode,
		stdout: stdout.length === 0 || stdout.endsWith("\n") ? stdout : `${stdout}\n`,
		stderr: stderr.length === 0 || stderr.endsWith("\n") ? stderr : `${stderr}\n`
	};
}
function isGlobPattern(value, glob) {
	if (glob === false) return false;
	if (glob === true) return true;
	return /[*?[]/.test(value);
}
function escapesRepo(value) {
	if (value.length === 0 || value.includes("\0")) return true;
	if (value.startsWith("/") || value.startsWith("~") || value.startsWith("\\\\") || value.startsWith("//") || /^[A-Za-z]:[\\/]/.test(value)) return true;
	return value.split(/[\\/]/).includes("..");
}
function segmentToRegExp(segment, bracketsLiteral = false) {
	let body = "";
	for (let i = 0; i < segment.length; i++) {
		const ch = segment[i] ?? "";
		if (ch === "*") body += "[^/]*";
		else if (ch === "?") body += "[^/]";
		else if (ch === "[" && !bracketsLiteral) {
			const end = segment.indexOf("]", i + 1);
			if (end === -1) body += "\\[";
			else {
				body += segment.slice(i, end + 1);
				i = end;
			}
		} else body += ch.replace(/[\\^$.|?*+(){}]/g, "\\$&");
	}
	return /* @__PURE__ */ new RegExp(`^${body}$`);
}
function listDir(abs) {
	if (!fs.existsSync(abs)) return [];
	if (!fs.statSync(abs).isDirectory()) return [];
	return fs.readdirSync(abs, { withFileTypes: true });
}
/**
* Expand a repo-relative glob. `**` crosses directories. Dotfiles match only a
* leading dot. With `bracketsLiteral`, `[` and `]` are name characters and only
* `*` / `?` are patterns: the names-first reading (TR-918 #5).
*/
function expandGlob(root, pattern, bracketsLiteral = false) {
	const wild = bracketsLiteral ? /[*?]/ : /[*?[]/;
	const segments = pattern.split(/[\\/]/).filter((segment) => segment.length > 0);
	const walk = (dirRel, index) => {
		if (index >= segments.length) return dirRel.length > 0 ? [dirRel] : [];
		const segment = segments[index] ?? "";
		const dirAbs = dirRel.length === 0 ? root : path.join(root, dirRel);
		if (segment === "**") {
			const here = walk(dirRel, index + 1);
			const nested = [];
			for (const entry of listDir(dirAbs)) {
				if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
				const child = dirRel.length === 0 ? entry.name : path.join(dirRel, entry.name);
				nested.push(...walk(child, index));
			}
			return here.concat(nested);
		}
		if (!wild.test(segment)) {
			const rel = dirRel.length === 0 ? segment : path.join(dirRel, segment);
			const abs = path.join(root, rel);
			if (!fs.existsSync(abs)) return [];
			if (index === segments.length - 1) return [rel];
			return fs.statSync(abs).isDirectory() ? walk(rel, index + 1) : [];
		}
		const re = segmentToRegExp(segment, bracketsLiteral);
		const hits = [];
		for (const entry of listDir(dirAbs)) {
			if (entry.name.startsWith(".") && !segment.startsWith(".")) continue;
			if (!re.test(entry.name)) continue;
			const rel = dirRel.length === 0 ? entry.name : path.join(dirRel, entry.name);
			if (index === segments.length - 1) hits.push(rel);
			else if (entry.isDirectory()) hits.push(...walk(rel, index + 1));
		}
		return hits;
	};
	return walk("", 0);
}
function realRoot(root) {
	try {
		return fs.realpathSync(root);
	} catch {
		return path.resolve(root);
	}
}
/**
* True when `rel`, with every symlink in it followed, stays inside `root`.
* A path that does not exist reads nothing, so it is inside.
*/
function staysInRepo(root, rel) {
	const abs = path.join(root, rel);
	let real;
	try {
		real = fs.realpathSync(abs);
	} catch {
		return !fs.existsSync(abs) && !isDanglingLink(abs);
	}
	const base = realRoot(root);
	return real === base || real.startsWith(base + path.sep);
}
function isDanglingLink(abs) {
	try {
		return fs.lstatSync(abs).isSymbolicLink();
	} catch {
		return false;
	}
}
function resolveFiles(root, check, params) {
	if (escapesRepo(params.path)) return {
		files: [],
		failure: finish(1, `path escapes the repo: ${params.path}`)
	};
	const literalExists = params.glob !== true && (fs.existsSync(path.join(root, params.path)) || isDanglingLink(path.join(root, params.path)));
	let files;
	if (literalExists || !isGlobPattern(params.path, params.glob)) files = [params.path];
	else {
		files = params.glob !== true && params.path.includes("[") ? expandGlob(root, params.path, true) : [];
		if (files.length === 0) files = expandGlob(root, params.path);
		if (files.length === 0) {
			if (check === "not_exists") return {
				files,
				failure: null
			};
			return {
				files: [],
				failure: finish(1, `no file matches: ${params.path}`)
			};
		}
	}
	for (const file of files) if (!staysInRepo(root, file)) return {
		files: [],
		failure: finish(1, `path escapes the repo: ${file}`)
	};
	return {
		files,
		failure: null
	};
}
function readText(root, rel) {
	return fs.readFileSync(path.join(root, rel), "utf8");
}
function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function compilePattern(source, flags) {
	const translated = translatePosixEre(source);
	if (typeof translated !== "string") return finish(2, `ERROR: unsupported pattern: ${translated.error}`);
	try {
		return new RegExp(translated, flags);
	} catch (err) {
		return finish(1, `ERROR: invalid pattern: ${err instanceof Error ? err.message : String(err)}`);
	}
}
function matcherFor(params, insensitive) {
	const keywords = params.keywords ?? [];
	const flags = insensitive ? "i" : "";
	if (keywords.length > 0) return new RegExp(keywords.map(escapeRegExp).join("|"), flags);
	if (params.pattern != null && params.pattern.length > 0) {
		if (params.literal) return new RegExp(escapeRegExp(params.pattern), flags);
		return compilePattern(params.pattern, flags);
	}
	return finish(1, "ERROR: pattern or keywords is required");
}
function countLines(text, re) {
	let count = 0;
	for (const line of text.split("\n")) if (re.test(line)) count += 1;
	return count;
}
const MAX_WALK_FILES = 1e5;
/**
* Files under `rel`, which may itself be a file. A directory is walked.
* `rel` itself has already been checked to stay inside the repo after its
* symlinks are followed (`resolveFiles`), so it is followed. A symlink met
* while walking is skipped, the way `grep -r` skips it: following it could
* leave the repo, and `node_modules/.bin` is full of them.
*/
function collectFiles(root, rel, acc, top = true) {
	if (acc.length > MAX_WALK_FILES) return finish(1, `path is too large to search: ${rel}`);
	const abs = path.join(root, rel);
	let stat;
	try {
		stat = top ? fs.statSync(abs) : fs.lstatSync(abs);
	} catch {
		return finish(1, `no file matches: ${rel}`);
	}
	if (stat.isSymbolicLink()) return null;
	if (stat.isDirectory()) {
		let entries;
		try {
			entries = fs.readdirSync(abs, { withFileTypes: true });
		} catch {
			return finish(1, `no file matches: ${rel}`);
		}
		for (const entry of entries) {
			const nested = collectFiles(root, rel.length === 0 ? entry.name : path.join(rel, entry.name), acc, false);
			if (nested) return nested;
		}
		return null;
	}
	if (stat.isFile()) {
		acc.push(rel);
		return null;
	}
	return null;
}
function countAcross(root, files, re) {
	const expanded = [];
	for (const file of files) {
		const walked = collectFiles(root, file, expanded);
		if (walked) return walked;
	}
	let total = 0;
	for (const file of expanded) total += countLines(readText(root, file), re);
	return total;
}
function doneCriteria(root, files, requirements) {
	let corpus = "";
	for (const file of files) {
		const abs = path.join(root, file);
		if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return finish(1, `no file matches: ${file}`);
		corpus += readText(root, file);
		corpus += "\n";
	}
	const lower = corpus.toLowerCase();
	const missing = [];
	for (const requirement of requirements) {
		if (typeof requirement === "string") {
			if (!lower.includes(requirement.toLowerCase())) missing.push(requirement);
			continue;
		}
		if (!requirement || typeof requirement.pattern !== "string") return finish(2, `ERROR: requirement must be a string or an object with a string pattern: ${JSON.stringify(requirement)}`);
		const re = compilePattern(requirement.pattern, "i");
		if (!(re instanceof RegExp)) return re;
		if (!re.test(corpus)) missing.push(requirement.label || requirement.pattern);
	}
	if (missing.length > 0) return finish(1, `MISSING: ${missing.join(", ")}`);
	return finish(0, "all met");
}
function jsonHasKey(root, file, key, object) {
	const abs = path.join(root, file);
	if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return finish(1, `no file matches: ${file}`);
	let parsed;
	try {
		parsed = JSON.parse(readText(root, file));
	} catch {
		return finish(1, `ERROR: invalid JSON in ${file}`);
	}
	const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
	const parent = object === void 0 ? record : record?.[object];
	const table = parent && typeof parent === "object" && !Array.isArray(parent) ? parent : null;
	if (!table || !Object.prototype.hasOwnProperty.call(table, key)) return finish(1, `MISSING: ${key} is not a key of ${object === void 0 ? "the document" : object} in ${file}`);
	return finish(0, "PASS");
}
function specColumns(root, file, required) {
	const abs = path.join(root, file);
	if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return finish(1, `no file matches: ${file}`);
	let parsed;
	try {
		parsed = JSON.parse(readText(root, file));
	} catch {
		return finish(1, `ERROR: invalid JSON in ${file}`);
	}
	const fields = parsed?.fields;
	if (!Array.isArray(fields)) return finish(1, `SPEC_SHAPE_ERROR: expected fields[] array, got ${fields === null ? "null" : typeof fields}`);
	const cols = fields.map((field) => field && typeof field === "object" && "name" in field ? field.name : void 0).filter((name) => typeof name === "string" && name.length > 0);
	const missing = (Array.isArray(required) ? required : required.split(",")).map((col) => col.trim()).filter((col) => !cols.includes(col));
	if (missing.length > 0) return finish(1, `MISSING: ${missing.join(",")}`);
	return finish(0, "all present");
}
const SINGLE_FILE_CHECKS = new Set([
	"done_criteria",
	"json_has_key",
	"spec_columns"
]);
function isRegularFile(root, rel) {
	try {
		return fs.statSync(path.join(root, rel)).isFile();
	} catch {
		return false;
	}
}
/** Run one inspect check. `root` is the repository root; paths are relative to it. */
function runBuiltin(request, root = process.cwd()) {
	const { files, failure } = resolveFiles(root, request.check, request.params);
	if (failure) return failure;
	if (SINGLE_FILE_CHECKS.has(request.check) && files.length > 1) return finish(1, `${request.params.path} does not resolve to exactly one file: ${files.join(", ")}`);
	if (request.check === "exists" || request.check === "not_exists") {
		if (request.check === "exists") {
			const regular = files.filter((file) => isRegularFile(root, file));
			if (regular.length > 0) return finish(0, `exists: ${regular.join(", ")}`);
			return finish(1, `MISSING: ${files[0] ?? request.params.path}`);
		}
		const present = files.filter((file) => fs.existsSync(path.join(root, file)));
		if (present.length === 0) return finish(0, `absent: ${request.params.path}`);
		return finish(1, `exists: ${present.join(", ")}`);
	}
	if (request.check === "contains" || request.check === "not_contains") {
		const matcher = matcherFor(request.params, request.check === "contains");
		if (!(matcher instanceof RegExp)) return matcher;
		const counted = countAcross(root, files, matcher);
		if (typeof counted !== "number") return counted;
		return finish((request.check === "contains" ? counted > 0 : counted === 0) ? 0 : 1, String(counted));
	}
	if (request.check === "done_criteria") {
		const requirements = request.params.requirements;
		if (!Array.isArray(requirements) || requirements.length === 0) return finish(2, "ERROR: requirements must be a non-empty array");
		return doneCriteria(root, files, requirements);
	}
	if (request.check === "json_has_key") {
		const key = request.params.key;
		if (!key) return finish(1, "ERROR: key is required");
		for (const file of files) {
			const one = jsonHasKey(root, file, key, request.params.object);
			if (one.exitCode !== 0) return one;
		}
		return finish(0, "PASS");
	}
	if (request.check === "spec_columns") {
		const required = request.params.required_columns;
		if (required == null || Array.isArray(required) && required.length === 0) return finish(1, "ERROR: required_columns is required");
		for (const file of files) {
			const one = specColumns(root, file, required);
			if (one.exitCode !== 0) return one;
		}
		return finish(0, "all present");
	}
	const lines = [];
	return finish(migrationRevertScopeCheck(fs, files.map((file) => path.resolve(root, file)), (line) => lines.push(line)), lines.join("\n"));
}

//#endregion
//#region src/commands/gates/inspect.ts
/**
* `levr gates inspect '<op json>'` (ENG-6179).
*
* Parses an inspect op with `GateOpSchema`, runs the builtin, and exits 0
* when the check passes or 1 when it fails. An op that does not parse, or
* that is not an inspect op, exits 2.
*/
function executeInspect(opJson, root = process.cwd()) {
	let raw;
	try {
		raw = JSON.parse(opJson);
	} catch {
		return {
			exitCode: 2,
			stdout: "",
			stderr: "gates inspect: op does not parse\n"
		};
	}
	const parsed = GateOpSchema.safeParse(raw);
	if (!parsed.success || parsed.data.op !== "inspect") return {
		exitCode: 2,
		stdout: "",
		stderr: "gates inspect: op does not parse\n"
	};
	return runBuiltin({
		check: parsed.data.check,
		params: parsed.data.params
	}, root);
}
function gatesInspectHandler(_flags, opJson) {
	const result = executeInspect(opJson);
	if (result.stdout.length > 0) this.process.stdout.write(result.stdout);
	if (result.stderr.length > 0) this.process.stderr.write(result.stderr);
	this.process.exitCode = result.exitCode;
}
const gatesInspectCommand = buildCommand({
	docs: {
		brief: "Run one inspect op and print its result",
		fullDescription: `Parse an inspect op JSON and run it in process. Exit 0 when the
check passes, 1 when it fails, and 2 when the op does not parse.

The op is the JSON object \`{ "op": "inspect", "check", "params" }\`. This is
the command a harness runs for an inspect gate.

Examples:
  levr gates inspect '{"op":"inspect","check":"exists","params":{"path":"package.json"}}'`
	},
	parameters: {
		positional: {
			kind: "tuple",
			parameters: [{
				parse: String,
				brief: "Inspect op as JSON",
				placeholder: "op-json",
				optional: false
			}]
		},
		flags: {}
	},
	loader: async () => {
		const { gatesInspectHandler: handler } = await import("./inspect-BJHoBVvi.js");
		return handler;
	}
});

//#endregion
export { executeInspect, gatesInspectCommand, gatesInspectHandler };