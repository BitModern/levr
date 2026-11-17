import { DEFAULT_SERVER_NAME, HARNESSES, collidingScope, defaultEnv, defaultScope, detectSignalsFor, entryPathFor, entryUrl, expandConfigPath, getAtPath, projectKeyFor, readTextOrNull, renderTomlBodyLines, renderTomlKey, resolveConfigPath, resolveProjectRoot, signalMatches } from "./paths-BWrY8EUd.js";
import { existsSync } from "node:fs";
import { applyEdits, modify, parse, printParseErrorCode } from "jsonc-parser";
import { TomlError, parse as parse$1 } from "smol-toml";

//#region ../mcp-harnesses/dist/node/format/port.js
/**
* Outbound port: a config DOCUMENT the installer can read a value out of and
* surgically edit, without the domain knowing what syntax the file is in.
*
* `installHarnessSync` / `removeHarnessSync` (`../install.ts`) and detection
* (`../detect.ts`) speak only this interface; each concrete format lives in a
* sibling adapter and is selected by the DECLARATIVE `configFormat` field on
* the catalog entry (`adapterFor`, `./index.ts`). No harness id, and no format
* name, ever reaches the domain — plan ENG-5264 §2.
*
* ## The failure channel is part of the contract (review F-002)
*
* A read has THREE outcomes, not two. `absent` is the state the domain answers
* by writing a fresh entry into an empty document; `unsupported` is the state
* it must REFUSE on — a non-empty file that does not parse, or a document in
* which our key sits in a shape the adapter cannot edit in place. Collapsing
* the two (returning `undefined` for both) is how a real user config gets
* treated as empty and overwritten. That is why `readAt` returns a tagged
* union rather than `unknown`, and why the mutators throw a typed error
* instead of best-effort restructuring a document they did not understand.
*/
/**
* Thrown by {@link ConfigDocumentAdapter.setAt} / `removeAt` when the edit
* cannot be made without restructuring content the adapter does not fully
* understand. The domain catches it and refuses the install — fail closed.
*/
var UnsupportedConfigShapeError = class extends Error {
	detail;
	constructor(detail) {
		super(detail);
		this.detail = detail;
		this.name = "UnsupportedConfigShapeError";
	}
};

//#endregion
//#region ../mcp-harnesses/dist/node/format/jsonc.js
const FORMAT = {
	insertSpaces: true,
	tabSize: 2,
	eol: "\n"
};
/**
* Parse strictly enough to be safe: any syntax error is a refusal, never a
* partial document. Returns the root, or the reason it cannot be used.
*/
function parseDocument$1(text) {
	const errors = [];
	const root = parse(text, errors, {
		allowTrailingComma: true,
		disallowComments: false
	});
	const first = errors[0];
	if (first) return {
		ok: false,
		detail: `document does not parse (${printParseErrorCode(first.error)} at offset ${first.offset})`
	};
	if (root === null || typeof root !== "object" || Array.isArray(root)) return {
		ok: false,
		detail: "document root is not an object"
	};
	return {
		ok: true,
		root
	};
}
const jsoncAdapter = {
	empty: "{}",
	readAt(text, path) {
		if (text.trim() === "") return { kind: "absent" };
		const doc = parseDocument$1(text);
		if (!doc.ok) return {
			kind: "unsupported",
			detail: doc.detail
		};
		const value = getAtPath(doc.root, path);
		return value === void 0 ? { kind: "absent" } : {
			kind: "value",
			value
		};
	},
	setAt(text, path, value) {
		return edit(text, path, value);
	},
	removeAt(text, path) {
		return edit(text, path, void 0);
	},
	appendToArray(text, path, values) {
		const doc = parseDocument$1(text);
		if (!doc.ok) throw new UnsupportedConfigShapeError(doc.detail);
		const current = getAtPath(doc.root, path);
		if (!Array.isArray(current)) throw new UnsupportedConfigShapeError(`${path.join(".")} is not an array — refusing to restructure it`);
		let next = text;
		let index = current.length;
		for (const value of values) {
			try {
				next = applyEdits(next, modify(next, [...path, index], value, {
					formattingOptions: FORMAT,
					isArrayInsertion: true
				}));
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				throw new UnsupportedConfigShapeError(`cannot append to ${path.join(".")}: ${message}`);
			}
			index++;
		}
		return next;
	}
};
/** Shared by set and remove: jsonc-parser removes a key when `value` is `undefined`. */
function edit(text, path, value) {
	const doc = parseDocument$1(text);
	if (!doc.ok) throw new UnsupportedConfigShapeError(doc.detail);
	try {
		return applyEdits(text, modify(text, path, value, { formattingOptions: FORMAT }));
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new UnsupportedConfigShapeError(`cannot edit path ${path.join(".")}: ${message}`);
	}
}

//#endregion
//#region ../mcp-harnesses/dist/node/format/toml.js
/**
* Suffix of the one-shot sibling backup the domain writes before the FIRST
* modifying write to a TOML target (review F-005): `config.toml.levr-bak`.
* Declared here, applied format-generically by the installer.
*/
const TOML_BACKUP_SUFFIX = ".levr-bak";
const BOM = "﻿";
function parseDocument(text) {
	try {
		return {
			ok: true,
			root: parse$1(stripBom(text))
		};
	} catch (err) {
		if (err instanceof TomlError) return {
			ok: false,
			detail: `document does not parse: ${err.message.split("\n")[0] ?? err.message} (line ${err.line}, col ${err.column})`
		};
		return {
			ok: false,
			detail: `document does not parse: ${err instanceof Error ? err.message : String(err)}`
		};
	}
}
/**
* `smol-toml` does not strip a UTF-8 byte-order mark, and Windows editors
* write one (code review F-006). The BOM is document decoration: parse and
* edit the text behind it, put it back on the way out.
*/
function stripBom(text) {
	return text.startsWith(BOM) ? text.slice(1) : text;
}
function splitLines(text) {
	const lines = [];
	const eols = [];
	let crlf = 0;
	let lf = 0;
	let from = 0;
	for (let i = 0; i < text.length; i++) {
		if (text[i] !== "\n") continue;
		const cr = i > 0 && text[i - 1] === "\r";
		lines.push(text.slice(from, cr ? i - 1 : i));
		eols.push(cr ? "\r\n" : "\n");
		if (cr) crlf++;
		else lf++;
		from = i + 1;
	}
	lines.push(text.slice(from));
	eols.push("");
	return {
		lines,
		eols,
		eol: crlf > lf ? "\r\n" : "\n"
	};
}
function joinLines(lines, eols) {
	let out = "";
	for (let i = 0; i < lines.length; i++) out += lines[i] + (eols[i] ?? "");
	return out;
}
/** Leading whitespace then `[` — the shape every table header shares. */
function isBracketLed(line) {
	return /^[ \t]*\[/.test(line);
}
/**
* The key path of a `[table.header]` line, or `undefined` when the line is
* not a standard-table header this scanner can read. Array-of-tables
* (`[[x]]`) and comment lines never match; a trailing `# comment` may
* contain anything, brackets included. Segments may be bare, `"basic"` (with
* escapes) or `'literal'` keys.
*
* `undefined` means "not OUR table" and nothing more — see the module
* comment for why an unreadable header still ends a body.
*/
function headerPathOf(line) {
	let i = 0;
	while (line[i] === " " || line[i] === "	") i++;
	if (line[i] !== "[" || line[i + 1] === "[") return void 0;
	i++;
	const segments = [];
	let current = "";
	let sawSegment = false;
	let closed = false;
	while (i < line.length) {
		const ch = line[i];
		if (ch === " " || ch === "	") {
			i++;
			continue;
		}
		if (ch === "]") {
			closed = true;
			i++;
			break;
		}
		if (ch === "\"") {
			const end = scanBasicString(line, i);
			if (end === -1) return void 0;
			const unescaped = unescapeBasic(line.slice(i + 1, end));
			if (unescaped === void 0) return void 0;
			current += unescaped;
			i = end + 1;
			sawSegment = true;
			continue;
		}
		if (ch === "'") {
			const close = line.indexOf("'", i + 1);
			if (close === -1) return void 0;
			current += line.slice(i + 1, close);
			i = close + 1;
			sawSegment = true;
			continue;
		}
		if (ch === ".") {
			if (!sawSegment) return void 0;
			segments.push(current);
			current = "";
			sawSegment = false;
			i++;
			continue;
		}
		if (/[A-Za-z0-9_-]/.test(ch)) {
			current += ch;
			sawSegment = true;
			i++;
			continue;
		}
		return;
	}
	if (!closed || !sawSegment) return void 0;
	const rest = line.slice(i);
	if (!/^[ \t]*(#.*)?$/.test(rest)) return void 0;
	segments.push(current);
	return segments;
}
/** Index of the closing quote of the basic string opening at `open`, or -1. */
function scanBasicString(line, open) {
	for (let i = open + 1; i < line.length; i++) {
		if (line[i] === "\\") {
			i++;
			continue;
		}
		if (line[i] === "\"") return i;
	}
	return -1;
}
/** TOML basic-string escapes are a subset of JSON's, so JSON can decode them. */
function unescapeBasic(raw) {
	try {
		const value = JSON.parse(`"${raw}"`);
		return typeof value === "string" ? value : void 0;
	} catch {
		return;
	}
}
const PROBE_KEY = "__levr_header_probe__";
/**
* What is the bracket-led line at `idx`? Swap it for a probe header and ask
* the parser:
*
* - `'real'`: the probe table appeared at the root — the line was a genuine
*   header at document level.
* - `'text'`: the document still parses and the probe did NOT appear — the
*   line is content inside a multi-line string. It changed the string, not
*   the document's shape.
* - `'unknown'`: the swap broke the document. Nothing is proven either way.
*/
function probeHeader(doc, idx) {
	const probe = [...doc.lines];
	probe[idx] = `[${PROBE_KEY}]`;
	const parsed = parseDocument(joinLines(probe, doc.eols));
	if (!parsed.ok) return "unknown";
	return Object.prototype.hasOwnProperty.call(parsed.root, PROBE_KEY) ? "real" : "text";
}
function samePath(a, b) {
	return a.length === b.length && a.every((s, i) => s === b[i]);
}
function isSubPath(path, prefix) {
	return path.length > prefix.length && prefix.every((s, i) => s === path[i]);
}
/**
* Locate our table: the header line index and the index just past its body.
* `undefined` when there is no standalone header for `path`.
*
* The START must be a fully parsed header for exactly `path`, confirmed
* real. The END is the first bracket-led line after it that is neither one
* of our own sub-tables nor proven to be string content — a header the path
* scanner cannot read, or one whose probe breaks the document, still ends
* the body. Misjudging a line can only make our region smaller.
*/
function locateTable(doc, path) {
	const { lines } = doc;
	let start = -1;
	for (let i = 0; i < lines.length; i++) {
		const hp = headerPathOf(lines[i]);
		if (hp && samePath(hp, path) && probeHeader(doc, i) === "real") {
			start = i;
			break;
		}
	}
	if (start === -1) return void 0;
	const last = lines.length - 1;
	const limit = lines[last] === "" ? last : lines.length;
	let end = limit;
	for (let i = start + 1; i < limit; i++) {
		if (!isBracketLed(lines[i])) continue;
		const verdict = probeHeader(doc, i);
		if (verdict === "text") continue;
		const hp = headerPathOf(lines[i]);
		if (hp && isSubPath(hp, path) && verdict === "real") continue;
		end = i;
		break;
	}
	while (end - 1 > start && /^[ \t]*(#.*)?$/.test(lines[end - 1])) end--;
	return {
		start,
		end
	};
}
function requireEditable(text, path) {
	const parsed = parseDocument(text);
	if (!parsed.ok) throw new UnsupportedConfigShapeError(parsed.detail);
	return {
		doc: splitLines(text),
		exists: getAtPath(parsed.root, path) !== void 0
	};
}
function notStandalone(path) {
	return new UnsupportedConfigShapeError(`${path.join(".")} exists but not as a standalone [${path.join(".")}] table (inline table or dotted key) — refusing to restructure it`);
}
const tomlAdapter = {
	empty: "",
	backupSuffix: TOML_BACKUP_SUFFIX,
	readAt(text, path) {
		if (stripBom(text).trim() === "") return { kind: "absent" };
		const doc = parseDocument(text);
		if (!doc.ok) return {
			kind: "unsupported",
			detail: doc.detail
		};
		const value = getAtPath(doc.root, path);
		return value === void 0 ? { kind: "absent" } : {
			kind: "value",
			value
		};
	},
	setAt(text, path, value) {
		if (value === null || typeof value !== "object" || Array.isArray(value)) throw new UnsupportedConfigShapeError(`a TOML table body must be an object, got ${value === null ? "null" : Array.isArray(value) ? "array" : typeof value}`);
		const body = value;
		const bom = text.startsWith(BOM) ? BOM : "";
		const inner = stripBom(text);
		if (inner.trim() === "") return bom + renderTable(path, body, inner.includes("\r\n") ? "\r\n" : "\n");
		const { doc, exists } = requireEditable(inner, path);
		const table = locateTable(doc, path);
		if (!table) {
			if (exists) throw notStandalone(path);
			const { eol } = doc;
			let base = inner.endsWith("\n") ? inner : inner + eol;
			if (!/\r?\n\r?\n$/.test(base)) base += eol;
			return bom + base + renderTable(path, body, eol);
		}
		const rendered = renderTomlBodyLines(body, path);
		const atEof = table.end === doc.lines.length;
		return bom + joinLines([
			...doc.lines.slice(0, table.start + 1),
			...rendered,
			...doc.lines.slice(table.end)
		], [
			...doc.eols.slice(0, table.start + 1),
			...rendered.map((_, i) => atEof && i === rendered.length - 1 ? "" : doc.eol),
			...doc.eols.slice(table.end)
		]);
	},
	removeAt(text, path) {
		const bom = text.startsWith(BOM) ? BOM : "";
		const inner = stripBom(text);
		if (inner.trim() === "") return text;
		const { doc, exists } = requireEditable(inner, path);
		if (!exists) return text;
		const table = locateTable(doc, path);
		if (!table) throw notStandalone(path);
		const lines = [...doc.lines.slice(0, table.start), ...doc.lines.slice(table.end)];
		const eols = [...doc.eols.slice(0, table.start), ...doc.eols.slice(table.end)];
		const at = table.start;
		if (at === 0) {
			if (lines[0] === "" && lines.length > 1) {
				lines.splice(0, 1);
				eols.splice(0, 1);
			}
		} else if (lines[at - 1] === "" && (at >= lines.length || lines[at] === "")) {
			lines.splice(at - 1, 1);
			eols.splice(at - 1, 1);
		}
		return bom + joinLines(lines, eols);
	}
};
function renderTable(path, body, eol) {
	return [`[${path.map(renderTomlKey).join(".")}]`, ...renderTomlBodyLines(body, path)].join(eol) + eol;
}

//#endregion
//#region ../mcp-harnesses/dist/node/format/index.js
/** Every syntax the installer can write, keyed by the catalog's `configFormat`. */
const ADAPTERS = {
	jsonc: jsoncAdapter,
	toml: tomlAdapter
};
/** The format a harness declares, with the catalog's documented default. */
function configFormatOf(harness) {
	return harness.configFormat ?? "jsonc";
}
/** The adapter for this harness's config syntax. */
function adapterFor(harness) {
	const format = configFormatOf(harness);
	const adapter = ADAPTERS[format];
	if (!adapter) throw new Error(`no config adapter registered for configFormat "${format}" (declared by harness "${harness.id}")`);
	return adapter;
}

//#endregion
//#region ../mcp-harnesses/dist/node/detect.js
/**
* Our server key's entry for this scope, or undefined when it is absent.
*
* Claude Code shares one file (`~/.claude.json`) between its `user` and
* `local` scopes, so the two are told apart by WHERE in the file they sit,
* not by which file is read — hence the entry path rather than a bare
* top-level lookup.
*/
function serverEntry(harness, scope, configPath, projectKey, serverName) {
	const text = readTextOrNull(configPath);
	if (!text) return void 0;
	const read = adapterFor(harness).readAt(text, entryPathFor(harness, scope, projectKey, serverName));
	return read.kind === "value" && read.value !== null ? read.value : void 0;
}
function detectScope(harness, env, def, opts) {
	const configPath = resolveConfigPath(harness, env, def.scope);
	const inRepo = def.projectPath ? resolveProjectRoot(env).isRepo : true;
	const collides = collidingScope(harness, env, def.scope) !== void 0;
	const available = Boolean(configPath) && inRepo && !collides;
	const read = (name) => available && configPath && name ? serverEntry(harness, def.scope, configPath, projectKeyFor(env), name) : void 0;
	const entry = read(opts.serverName);
	const currentUrl = entry === void 0 ? void 0 : entryUrl(harness, entry);
	const beside = read(opts.besideName);
	const besideUrl = beside === void 0 ? void 0 : entryUrl(harness, beside);
	return {
		scope: def.scope,
		installKind: def.installKind,
		configPath: available ? configPath ?? "" : "",
		available,
		alreadyConfigured: entry !== void 0,
		...currentUrl === void 0 ? {} : { currentUrl },
		...besideUrl === void 0 ? {} : { besideUrl },
		...beside === void 0 ? {} : { besideConfigured: true }
	};
}
function detectOne(harness, env, opts) {
	const scopes = harness.scopes.map((def) => detectScope(harness, env, def, opts));
	const available = scopes.some((s) => s.available);
	const installed = detectSignalsFor(harness, env.platform).some((s) => signalMatches(s, env, (p) => expandConfigPath(p, harness, env))) || scopes.some((s) => s.configPath !== "" && existsSync(s.configPath));
	const fallback = scopes.find((s) => s.scope === defaultScope(harness));
	return {
		id: harness.id,
		label: harness.label,
		installed,
		scopes,
		alreadyConfigured: fallback?.alreadyConfigured ?? false,
		configPath: fallback?.configPath ?? "",
		available
	};
}
/** Synchronous detection over the whole catalog. Exported for tests. */
function detectSync(env = defaultEnv(), opts = {}) {
	const resolved = {
		...opts,
		serverName: opts.serverName ?? DEFAULT_SERVER_NAME
	};
	return HARNESSES.map((h) => detectOne(h, env, resolved));
}

//#endregion
export { UnsupportedConfigShapeError, adapterFor, detectSync, jsoncAdapter, tomlAdapter };