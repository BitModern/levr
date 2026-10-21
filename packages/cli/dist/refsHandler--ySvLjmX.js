import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path$1 from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";

//#region ../code-intel/dist/shared.js
/** Directories never worth walking — they dwarf the real source tree. */
const IGNORED_DIRS = [
	"node_modules",
	"dist",
	"build",
	"coverage",
	".git",
	".turbo",
	".yarn",
	".next",
	"out"
];
/** The files the TypeScript engines load. */
const TS_SOURCE = /\.tsx?$/;
const TEST_FILE_RE = /\.(test|spec)\.[cm]?tsx?$/;
function isTestFile(filePath) {
	return TEST_FILE_RE.test(filePath);
}
/** Walk up from `start` until a directory containing `.git` is found. */
function findProjectRoot(start = process.cwd()) {
	let dir = path$1.resolve(start);
	for (;;) {
		if (fs.existsSync(path$1.join(dir, ".git"))) return dir;
		const parent = path$1.dirname(dir);
		if (parent === dir) return path$1.resolve(start);
		dir = parent;
	}
}
/**
* Nearest `tsconfig.json` at or above `scopeRoot`, bounded by `projectRoot`.
*
* Load-bearing, not a nicety. `apps/backender` mandates non-relative imports
* (`import { X } from 'src/service/x'`), resolved through the `paths` mapping in
* its tsconfig. Without those options the specifier does not resolve, the import
* never binds to the declaration, and a reference search cannot see the
* consumer — so the gate reports a well-wired service as orphaned and FAILS
* CLOSED ON CORRECT CODE.
*
* That is a worse failure than the one this gate replaced: Axon was confidently
* wrong, and a gate that fails correct work is confidently wrong with authority.
*/
function findTsConfig(scopeRoot, projectRoot) {
	let dir = path$1.resolve(scopeRoot);
	const stop = path$1.resolve(projectRoot);
	for (;;) {
		const candidate = path$1.join(dir, "tsconfig.json");
		if (fs.existsSync(candidate)) return candidate;
		if (dir === stop) return null;
		const parent = path$1.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}
function listSourceFiles(scopeRoot, extension = TS_SOURCE, skipDir) {
	if (extension.test(scopeRoot) && fs.statSync(scopeRoot, { throwIfNoEntry: false })?.isFile()) return [scopeRoot];
	const files = [];
	const walk = (dir) => {
		let entries;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) if (entry.isDirectory()) {
			if (IGNORED_DIRS.includes(entry.name) || skipDir?.(dir, entry.name)) continue;
			walk(path$1.join(dir, entry.name));
		} else if (extension.test(entry.name)) files.push(path$1.join(dir, entry.name));
	};
	walk(scopeRoot);
	return files.sort();
}
/**
* A name so common that answering for it would load the machine's memory
* rather than a project — `id`, `name`, `run` — unscoped or in a scope
* where it appears everywhere. A misconfigured GATE (exit 2 in the CLIs),
* never a verdict: the remedy is `--scope`, and running unbounded ended in
* a SIGKILLed 19 GB `tsgo --lsp` with no answer at all (ENG-5121 review
* F-025).
*/
var SymbolTooCommonError = class extends Error {
	symbol;
	count;
	limit;
	what;
	constructor(symbol, count, limit, what) {
		super(`"${symbol}" is too common to resolve here: ${count} ${what}, above the ${limit} limit. Narrow it with --scope (e.g. --scope apps/backender/src/<module>).`);
		this.symbol = symbol;
		this.count = count;
		this.limit = limit;
		this.what = what;
		this.name = "SymbolTooCommonError";
	}
};
function escapeRegExp$1(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
* Does this source text LOOK like it declares `symbol` at top level?
*
* A candidate filter only — cheap enough to run over every file in scope so
* an engine knows which files to ask the compiler about. The compiler (or the
* LSP server's symbol tree) is what decides; this must merely never say "no"
* for a file that does declare the symbol.
*/
function looksLikeTopLevelDeclaration(symbol, text) {
	const name = escapeRegExp$1(symbol);
	if (new RegExp(String.raw`^[ \t]*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|function\s*\*?|interface|type|enum|const\s+enum|const|let|var)\s+${name}\b`, "m").test(text)) return true;
	return new RegExp(String.raw`(?:^|,)[ \t]*${name}\s*[=:,;]`, "m").test(text);
}
/**
* Does this source text LOOK like it declares a class/interface MEMBER named
* `symbol`? Covers a decorator on the same line, a definite-assignment `!`,
* and a member on the class's own line (`class A { X = 1 }`) — all shapes
* ts-morph's `getMembers()` returns and the earlier filter missed
* (ENG-5121 review F-023).
*/
function looksLikeMemberDeclaration(symbol, text) {
	return new RegExp(String.raw`(?:^[ \t]*|[{;][ \t]*)(?:@\w+(?:\([^)]*\))?\s*)*(?:(?:public|private|protected|static|readonly|abstract|override|async|declare|accessor|get|set)\s+)*\*?${escapeRegExp$1(symbol)}\s*[!?]?\s*[(<:=;,}]`, "m").test(text);
}
/** Convert an absolute path under `projectRoot` to the repo-relative form results use. */
function relativeTo(projectRoot, absolute) {
	return path$1.relative(projectRoot, absolute) || absolute;
}
/** An empty "not found" result, so both engines produce a byte-identical one. */
function notFound(filesScanned, tsConfigPath) {
	return {
		found: false,
		resolvedAsMember: false,
		declarationFiles: [],
		referenceCount: 0,
		referencingFiles: [],
		excludedTestReferences: 0,
		filesScanned,
		tsConfigPath
	};
}
/**
* Upper bound on source files one request may load.
*
* A TS program holds every loaded file's AST and type information in memory, so
* cost scales with the file count. Node's default old-space is ~4GB, and an
* UNSCOPED run over this monorepo (11,460 `.ts`/`.tsx` files) exceeds it:
*
*     FATAL ERROR: Ineffective mark-compacts near heap limit
*     Allocation failed - JavaScript heap out of memory
*
* That is the worst possible failure for a gate. It exits 134 with a V8 stack
* trace and no verdict — not a pass, not a fail, just noise a caller has to
* interpret. The gate framework exists to make "verified" and "not verified"
* distinguishable, and an OOM is neither.
*
* 10,000 sits above the largest legitimate single scope in this repo and below
* the whole-repo set that does not. `apps/backender/src` was 6,314 files when
* the cap was 8000, and reached 8,016 with ENG-6802, which made every gate
* scoped to it refuse. It counts test files even when `includeTests` is off
* (about 1,100 of them); excluding those is a separate follow-up. Override deliberately with `--max-files` if a
* genuinely larger scope is ever needed — and expect to raise Node's heap with
* `NODE_OPTIONS=--max-old-space-size=...` at the same time.
*
* The cap applies to every engine. An LSP engine would survive a larger
* scope, but an unscoped gate must behave identically whichever engine the
* workspace has bound — "exit 2, narrow the scope" — or flipping the binding
* would change verdicts for reasons that have nothing to do with the code.
* (Moved from `scripts/gates/symbol-referenced.lib.ts`, ENG-7284 D5.)
*/
const DEFAULT_MAX_FILES = 1e4;
/** Thrown when the requested scope holds more files than the resolver will load. */
var ScopeTooBroadError = class extends Error {
	fileCount;
	maxFiles;
	scopeLabel;
	constructor(fileCount, maxFiles, scopeLabel) {
		super(`scope "${scopeLabel}" contains ${fileCount} source files, above the ${maxFiles}-file limit. Loading them all would exhaust Node's heap and abort with no verdict. Narrow it with --scope (e.g. --scope apps/backender/src), or raise the cap deliberately with --max-files.`);
		this.fileCount = fileCount;
		this.maxFiles = maxFiles;
		this.scopeLabel = scopeLabel;
		this.name = "ScopeTooBroadError";
	}
};
/**
* A toolchain the engine needs is missing or unusable in the target checkout
* (no `typescript`, no tsgo binary, no `rust-analyzer`, an index that never
* settles). Exit 2 in every CLI: a misconfigured environment, never a
* verdict. `remedy` says what to install.
*/
var ToolchainError = class extends Error {
	remedy;
	constructor(message, remedy) {
		super(`${message} ${remedy}`);
		this.remedy = remedy;
		this.name = "ToolchainError";
	}
};

//#endregion
//#region ../code-intel/dist/lsp-client.js
/** How long to wait for any single server response before failing CLOSED. */
const RESPONSE_TIMEOUT_MS = 12e4;
/** How much of the server's stderr to keep for the exit diagnostic. */
const STDERR_TAIL_BYTES = 4096;
var LspClient = class LspClient {
	options;
	proc;
	buffer = Buffer.alloc(0);
	nextId = 1;
	pending = /* @__PURE__ */ new Map();
	opened = /* @__PURE__ */ new Set();
	exited = null;
	stderrTail = "";
	listeners = /* @__PURE__ */ new Set();
	name;
	responseTimeoutMs;
	rootDir;
	constructor(options) {
		this.options = options;
		this.rootDir = path$1.resolve(options.rootDir);
		this.name = options.name;
		this.responseTimeoutMs = options.responseTimeoutMs ?? RESPONSE_TIMEOUT_MS;
		const bin = options.bin;
		const [cmd, args] = bin.endsWith(".js") ? [process.execPath, [bin, ...options.args]] : [bin, [...options.args]];
		this.proc = spawn(cmd, args, {
			cwd: this.rootDir,
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			]
		});
		this.proc.stdout.on("data", (chunk) => this.onData(chunk));
		this.proc.stderr.on("data", (chunk) => {
			this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL_BYTES);
		});
		this.proc.stdin.on("error", (err) => this.fail(err));
		this.proc.on("exit", (code, signal) => {
			const tail = this.stderrTail.trim();
			this.fail(/* @__PURE__ */ new Error(`${this.name} exited (code=${code ?? "null"}, signal=${signal ?? "null"}) before answering` + (tail ? `\n--- ${this.name} stderr (tail) ---\n${tail}` : "")));
		});
		this.proc.on("error", (err) => this.fail(err));
	}
	/** Record the fatal error once and reject everything still waiting. */
	fail(err) {
		if (!this.exited) this.exited = err;
		for (const p of this.pending.values()) p.reject(this.exited);
		this.pending.clear();
	}
	/** Spawn the server and complete the `initialize` handshake. */
	static async start(options) {
		const client = new LspClient(options);
		const rootUri = pathToFileURL(client.rootDir).href;
		try {
			await client.handshake(rootUri);
		} catch (e) {
			client.proc.kill();
			throw e;
		}
		return client;
	}
	async handshake(rootUri) {
		await this.request("initialize", {
			processId: process.pid,
			rootUri,
			capabilities: mergeCapabilities({
				workspace: { configuration: true },
				textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } }
			}, this.options.capabilities ?? {}),
			...this.options.initializationOptions !== void 0 ? { initializationOptions: this.options.initializationOptions } : {},
			workspaceFolders: [{
				uri: rootUri,
				name: path$1.basename(this.rootDir)
			}]
		});
		this.notify("initialized", {});
	}
	write(message) {
		if (this.exited) throw this.exited;
		const body = JSON.stringify(message);
		this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
	}
	onData(chunk) {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		for (;;) {
			const headerEnd = this.buffer.indexOf("\r\n\r\n");
			if (headerEnd < 0) return;
			const header = this.buffer.subarray(0, headerEnd).toString("ascii");
			const lengthMatch = /Content-Length: (\d+)/i.exec(header);
			if (!lengthMatch) {
				this.buffer = this.buffer.subarray(headerEnd + 4);
				continue;
			}
			const length = Number(lengthMatch[1]);
			const bodyStart = headerEnd + 4;
			if (this.buffer.length < bodyStart + length) return;
			const body = this.buffer.subarray(bodyStart, bodyStart + length);
			this.buffer = this.buffer.subarray(bodyStart + length);
			let message;
			try {
				message = JSON.parse(body.toString("utf8"));
			} catch (e) {
				this.fail(/* @__PURE__ */ new Error(`${this.name} sent malformed JSON: ${e.message}`));
				return;
			}
			this.dispatch(message);
		}
	}
	dispatch(message) {
		if (message.method !== void 0 && message.id !== void 0) {
			let result = null;
			if (message.method === "workspace/configuration") result = (message.params?.items ?? []).map(() => null);
			this.write({
				jsonrpc: "2.0",
				id: message.id,
				result
			});
			return;
		}
		if (message.method !== void 0) {
			for (const listener of this.listeners) listener(message);
			return;
		}
		if (message.id !== void 0) {
			const waiter = this.pending.get(message.id);
			if (waiter) {
				this.pending.delete(message.id);
				waiter.resolve(message);
			}
		}
	}
	request(method, params) {
		const id = this.nextId++;
		return new Promise((resolve$1, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(/* @__PURE__ */ new Error(`${this.name} did not answer ${method} within ${this.responseTimeoutMs} ms`));
			}, this.responseTimeoutMs);
			this.pending.set(id, {
				resolve: (m) => {
					clearTimeout(timer);
					if (m.error) reject(/* @__PURE__ */ new Error(`${method} failed: ${m.error.message}`));
					else resolve$1(m);
				},
				reject: (e) => {
					clearTimeout(timer);
					reject(e);
				}
			});
			try {
				this.write({
					jsonrpc: "2.0",
					id,
					method,
					params
				});
			} catch (e) {
				clearTimeout(timer);
				this.pending.delete(id);
				reject(e instanceof Error ? e : new Error(String(e)));
			}
		});
	}
	notify(method, params) {
		this.write({
			jsonrpc: "2.0",
			method,
			params
		});
	}
	/**
	* Open a file so the server loads the project that contains it, and WAIT
	* for that load to settle (obligation 2 + R1/F-11). Idempotent.
	*/
	async open(absolutePath) {
		const resolved = path$1.resolve(absolutePath);
		if (this.opened.has(resolved)) return;
		this.opened.add(resolved);
		this.notify("textDocument/didOpen", { textDocument: {
			uri: pathToFileURL(resolved).href,
			languageId: languageIdOf(resolved),
			version: 1,
			text: fs.readFileSync(resolved, "utf8")
		} });
		await this.request("textDocument/documentSymbol", { textDocument: { uri: pathToFileURL(resolved).href } });
	}
	/** Hierarchical symbols of an (already opened) file. */
	async documentSymbols(absolutePath) {
		await this.open(absolutePath);
		return (await this.request("textDocument/documentSymbol", { textDocument: { uri: pathToFileURL(path$1.resolve(absolutePath)).href } })).result ?? [];
	}
	/**
	* Every reference to the symbol whose identifier is at `position` in
	* `absolutePath`, INCLUDING the declaration itself. Answers only from loaded
	* projects — see the header.
	*
	* `includeDeclaration` is deliberately `true`. In the compiler's model an
	* import specifier (`import { X } from …`) is itself a declaration — of the
	* local alias — so `false` drops every import line along with the real
	* declaration, and the count no longer matches ts-morph's
	* `findReferencesAsNodes()`, which lists them. The caller knows the real
	* declaration's position (it asked for it) and removes exactly that one.
	*/
	async references(absolutePath, position) {
		await this.open(absolutePath);
		return (await this.request("textDocument/references", {
			textDocument: { uri: pathToFileURL(path$1.resolve(absolutePath)).href },
			position,
			context: { includeDeclaration: true }
		})).result ?? [];
	}
	/**
	* Where the symbol whose identifier is at `position` is DEFINED. Used to
	* confirm a documentSymbol candidate is the declaration itself and not an
	* alias of one — an import specifier in a wrapped `import { type X, … }`
	* reports as a top-level symbol, and taking it as the declaration made the
	* REAL declaration's identifier count as an external reference
	* (ENG-5121 review F-021).
	*/
	async definition(absolutePath, position) {
		await this.open(absolutePath);
		const result = (await this.request("textDocument/definition", {
			textDocument: { uri: pathToFileURL(path$1.resolve(absolutePath)).href },
			position
		})).result;
		if (!result) return [];
		return (Array.isArray(result) ? result : [result]).map((l) => "targetUri" in l ? {
			uri: l.targetUri,
			range: l.targetSelectionRange
		} : l);
	}
	/**
	* `workspace/symbol` for `query`. Never the first call on tsgo (see the
	* header); rust-analyzer answers it once indexing is quiescent.
	*/
	async workspaceSymbol(query) {
		return (await this.request("workspace/symbol", { query })).result ?? [];
	}
	/**
	* Resolve with the first server notification named `method` that
	* `accept` takes, or REJECT after `timeoutMs`, or as soon as the server
	* dies. A timeout is a failure, never "it probably settled".
	*/
	waitForNotification(method, accept, timeoutMs) {
		if (this.exited) return Promise.reject(this.exited);
		return new Promise((resolve$1, reject) => {
			const done = (fn) => {
				clearTimeout(timer);
				clearInterval(poll);
				this.listeners.delete(listener);
				fn();
			};
			const listener = (m) => {
				if (m.method === method && accept(m.params)) done(() => resolve$1(m.params));
			};
			const timer = setTimeout(() => done(() => reject(/* @__PURE__ */ new Error(`${this.name} sent no matching ${method} within ${timeoutMs} ms`))), timeoutMs);
			const poll = setInterval(() => {
				if (this.exited) done(() => reject(this.exited));
			}, 250);
			this.listeners.add(listener);
		});
	}
	/** Shut the server down. Safe to call twice. */
	async dispose() {
		if (this.exited) return;
		try {
			await Promise.race([this.request("shutdown"), new Promise((resolve$1) => setTimeout(resolve$1, 2e3))]);
			this.notify("exit");
		} catch {}
		this.proc.stdin?.end();
		this.proc.kill();
	}
};
/** The LSP `languageId` for a file, by extension. */
function languageIdOf(file) {
	if (file.endsWith(".rs")) return "rust";
	if (file.endsWith("x")) return "typescriptreact";
	return "typescript";
}
/** `base` with `extra` merged in, one level deep (`workspace`, `textDocument`, …). */
function mergeCapabilities(base, extra) {
	const out = { ...base };
	for (const [key, value] of Object.entries(extra)) {
		const prev = out[key];
		out[key] = prev && typeof prev === "object" && value && typeof value === "object" ? {
			...prev,
			...value
		} : value;
	}
	return out;
}
/** Convert a `file://` URI the server returned to an absolute path. */
function uriToPath(uri) {
	return fileURLToPath(uri);
}

//#endregion
//#region ../code-intel/dist/workspaces.js
/**
* Open one source file in every workspace whose `package.json` lists
* `packageName` as a dependency, so the server loads those projects and
* `references` can see cross-package consumers. `within` restricts the
* candidates to workspaces that intersect the search scope — a scope of
* `apps/backender` has no use for `apps/client`'s project.
*
* For `isAutomated` in `packages/shared` that is the difference between 3
* refs / 1 file and 11 refs / 6 files (ENG-5121 §3.4 E5 → E6). Opening ANY
* file of the project is enough (E7) — `firstSourceFile` picks one.
*
* Returns the files it opened, so callers (and tests) can see what happened.
*/
async function openDependentWorkspaces(client, packageName, within) {
	const opened = [];
	for (const ws of listWorkspaces(client.rootDir)) {
		if (!ws.dependencies.has(packageName)) continue;
		if (within && !within.some((scope) => intersects(ws.dir, scope))) continue;
		const file = firstSourceFile(ws.dir);
		if (!file) continue;
		await client.open(file);
		opened.push(file);
	}
	return opened;
}
let workspaceCache = null;
/**
* Every workspace package under `rootDir`, read from the root `package.json`'s
* `workspaces` globs. Only the one-level `dir/*` and literal `dir/name` forms
* are supported, which is every form this repo uses.
*/
function listWorkspaces(rootDir) {
	const root = path$1.resolve(rootDir);
	if (workspaceCache?.root === root) return workspaceCache.list;
	const list = [];
	const patterns = readPackageJson(path$1.join(root, "package.json"))?.workspaces ?? [];
	const seen = /* @__PURE__ */ new Set();
	for (const pattern of patterns) {
		const dirs = pattern.endsWith("/*") ? listDirs(path$1.join(root, pattern.slice(0, -2))) : [path$1.join(root, pattern)];
		for (const dir of dirs) {
			if (seen.has(dir)) continue;
			seen.add(dir);
			const pkg = readPackageJson(path$1.join(dir, "package.json"));
			if (!pkg?.name) continue;
			list.push({
				dir,
				name: pkg.name,
				dependencies: new Set([
					...Object.keys(pkg.dependencies ?? {}),
					...Object.keys(pkg.devDependencies ?? {}),
					...Object.keys(pkg.peerDependencies ?? {})
				])
			});
		}
	}
	workspaceCache = {
		root,
		list
	};
	return list;
}
/** The workspace a file belongs to — nearest ancestor `package.json` with a name — or null. */
function workspaceOf(rootDir, absoluteFile) {
	const root = path$1.resolve(rootDir);
	const file = path$1.resolve(absoluteFile);
	let best = null;
	for (const ws of listWorkspaces(root)) if (file === ws.dir || file.startsWith(ws.dir + path$1.sep)) {
		if (!best || ws.dir.length > best.dir.length) best = ws;
	}
	return best;
}
function readPackageJson(file) {
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
		if (parsed.workspaces && !Array.isArray(parsed.workspaces)) parsed.workspaces = parsed.workspaces.packages ?? [];
		return parsed;
	} catch {
		return null;
	}
}
function listDirs(parent) {
	try {
		return fs.readdirSync(parent, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path$1.join(parent, e.name));
	} catch {
		return [];
	}
}
function intersects(a, b) {
	const x = path$1.resolve(a);
	const y = path$1.resolve(b);
	return x === y || x.startsWith(y + path$1.sep) || y.startsWith(x + path$1.sep);
}
/** Root-level files that are in no workspace's source project. */
const CONFIG_FILE = /^(?:.*\.config|eslint|vitest|vite|playwright|tsup|tsdown|knip|commitlint|prettier)(?:\..*)?\.tsx?$/;
/** Where a workspace's source project lives, in the order to try. */
const SOURCE_DIRS = [
	"src",
	"app",
	"lib",
	"test",
	"scripts"
];
/**
* The first `.ts`/`.tsx` source file under `dir` (not a `.d.ts`, not a test),
* used purely to make the server load `dir`'s project — any file will do (E7)
* AS LONG AS IT IS IN THE PROJECT. A breadth-first walk from the workspace
* root found `vite.config.ts` / `eslint.config.ts` first for ~35 of 41
* workspaces, and those are in no `src/**`-scoped tsconfig, so the open
* loaded nothing and cross-workspace consumers stayed invisible (ENG-5121
* review F-029). Source directories are tried first; root-level config
* files are never the answer.
*/
function firstSourceFile(dir) {
	for (const sub of SOURCE_DIRS) {
		const candidate = path$1.join(dir, sub);
		if (fs.existsSync(candidate)) {
			const found = firstSourceFileUnder(candidate);
			if (found) return found;
		}
	}
	return firstSourceFileUnder(dir, true);
}
function firstSourceFileUnder(dir, skipConfigs = false) {
	const queue = [dir];
	while (queue.length) {
		const current = queue.shift();
		let entries;
		try {
			entries = fs.readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}
		entries.sort((a, b) => a.name.localeCompare(b.name));
		for (const entry of entries) if (entry.isDirectory()) {
			if (!IGNORED_DIRS.includes(entry.name)) queue.push(path$1.join(current, entry.name));
		} else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") && !/\.(test|spec)\.tsx?$/.test(entry.name) && !(skipConfigs && CONFIG_FILE.test(entry.name))) return path$1.join(current, entry.name);
	}
	return null;
}

//#endregion
//#region ../code-intel/dist/engines/tsgo.js
/**
* `typescript` and the tsgo binary, resolved from `projectRoot`'s own
* dependencies. See the header: never from this package's location.
*/
function resolveTsToolchain(projectRoot) {
	const manifest = path$1.join(path$1.resolve(projectRoot), "package.json");
	if (!fs.existsSync(manifest)) throw new ToolchainError(`No package.json at ${projectRoot}, so typescript cannot be resolved from the checkout.`, "Run this from the root of a TypeScript repository.");
	const requireFromRepo = createRequire(manifest);
	let typescript;
	try {
		typescript = requireFromRepo("typescript");
	} catch {
		throw new ToolchainError(`typescript is not installed in ${projectRoot}.`, "Install it in this checkout (e.g. `yarn add -D typescript`).");
	}
	const platformPackage = `@typescript/native-preview-${process.platform}-${process.arch}`;
	const exe = process.platform === "win32" ? "tsgo.exe" : "tsgo";
	try {
		const dir = path$1.dirname(requireFromRepo.resolve(`${platformPackage}/package.json`));
		const native = path$1.join(dir, "lib", exe);
		if (fs.existsSync(native)) return {
			ts: typescript,
			tsgoBin: native
		};
	} catch {}
	try {
		const dir = path$1.dirname(requireFromRepo.resolve("@typescript/native-preview/package.json"));
		const launcher = path$1.join(dir, "bin", "tsgo.js");
		if (fs.existsSync(launcher)) return {
			ts: typescript,
			tsgoBin: launcher
		};
	} catch {}
	throw new ToolchainError(`The tsgo binary (@typescript/native-preview) is not installed in ${projectRoot}.`, "Install it in this checkout (e.g. `yarn add -D @typescript/native-preview`).");
}
/** LSP `SymbolKind` values a top-level declaration can carry. Type aliases report as Class (5). */
const TOP_LEVEL_KINDS = new Set([
	5,
	10,
	11,
	12,
	13,
	14
]);
/** Class/interface members: Method 6, Property 7 (accessors also report as 7), Field 8. */
const MEMBER_KINDS = new Set([
	6,
	7,
	8
]);
/** Containers whose children count as members. */
const CONTAINER_KINDS = new Set([5, 11]);
/**
* Files step 3 may load beyond the configured projects — extra opens plus
* the excluded files the compiler API answers. Each is a full module load
* with its import closure; past this many the name is not being resolved,
* it is being grepped, and the process is on its way to being OOM-killed.
*/
const MAX_EXTRA_FILES = 200;
/**
* Files whose TEXT looks like it declares the symbol. Each costs a
* `documentSymbol` round trip (~150 ms) plus a `definition` per hit; for
* `id` inside apps/backender/src that is thousands of object-literal keys
* and minutes of wall clock before a single reference is asked for.
*/
const MAX_DECLARATION_CANDIDATES = 200;
function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** Inside the repository and not under a `node_modules` (a dependency's .d.ts). */
function isRepoSource(file, projectRoot) {
	const root = path$1.resolve(projectRoot) + path$1.sep;
	return file.startsWith(root) && !file.includes(`${path$1.sep}node_modules${path$1.sep}`);
}
/** Files whose text looks like it declares `symbol` at top level. */
function topLevelCandidates(symbol, contents) {
	return [...contents].filter(([, text]) => looksLikeTopLevelDeclaration(symbol, text)).map(([f]) => f);
}
/** Files whose text looks like it declares a MEMBER named `symbol`. */
function memberCandidates(symbol, contents) {
	return [...contents].filter(([, text]) => looksLikeMemberDeclaration(symbol, text)).map(([f]) => f);
}
/** Files each tsconfig includes, computed once per config per engine call. */
var ProjectMembership = class {
	ts;
	projectRoot;
	byConfig = /* @__PURE__ */ new Map();
	constructor(ts, projectRoot) {
		this.ts = ts;
		this.projectRoot = projectRoot;
	}
	/**
	* The tsconfig whose file set contains `file`, or null when no governing
	* config includes it (no tsconfig up the tree, or excluded by the one
	* there is).
	*/
	coveringConfig(file) {
		const config = findTsConfig(path$1.dirname(file), this.projectRoot);
		if (!config) return null;
		let files = this.byConfig.get(config);
		if (!files) {
			files = this.load(config);
			this.byConfig.set(config, files);
		}
		return files.has(path$1.resolve(file)) ? config : null;
	}
	/** The governing tsconfig's compiler options (for a file it EXCLUDES). */
	optionsFor(file) {
		const config = findTsConfig(path$1.dirname(file), this.projectRoot);
		if (!config) return {};
		this.coveringConfig(file);
		return this.optionsByConfig.get(config) ?? {};
	}
	optionsByConfig = /* @__PURE__ */ new Map();
	load(config) {
		const ts = this.ts;
		const read = ts.readConfigFile(config, (p) => ts.sys.readFile(p));
		if (read.error || !read.config) return /* @__PURE__ */ new Set();
		const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path$1.dirname(config));
		this.optionsByConfig.set(config, parsed.options);
		return new Set(parsed.fileNames.map((f) => path$1.resolve(f)));
	}
};
/**
* References from files NO tsconfig covers, resolved by the compiler API
* with the governing tsconfig's OPTIONS. An excluded file opened into the
* server's inferred project has no `paths`, so an import through an alias
* (`~/x`) never resolves and its references vanish — correct code FAILED
* under the tsgo binding (ENG-5121 review F-022). tsgo exposes no way to
* give an inferred project compiler options (its LSP preferences are
* editor settings only), so those files are answered here instead: one
* language service over exactly those files, which pulls the declaring
* module in through the resolved import.
*/
function referencesFromUncoveredFiles(ts, uncovered, declarations, membership) {
	const out = /* @__PURE__ */ new Map();
	if (uncovered.length === 0) return out;
	const options = {
		...membership.optionsFor(uncovered[0]),
		noEmit: true,
		skipLibCheck: true
	};
	const roots = [...new Set([...uncovered, ...declarations.map((d) => d.file)])];
	const service = ts.createLanguageService({
		getCompilationSettings: () => options,
		getScriptFileNames: () => roots,
		getScriptVersion: () => "1",
		getScriptSnapshot: (f) => fs.existsSync(f) ? ts.ScriptSnapshot.fromString(fs.readFileSync(f, "utf8")) : void 0,
		getCurrentDirectory: () => process.cwd(),
		getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
		fileExists: (p) => ts.sys.fileExists(p),
		readFile: (p, encoding) => ts.sys.readFile(p, encoding),
		readDirectory: (...args) => ts.sys.readDirectory(...args),
		directoryExists: (p) => ts.sys.directoryExists(p),
		getDirectories: (p) => ts.sys.getDirectories(p)
	});
	const wanted = new Set(uncovered.map((f) => path$1.resolve(f)));
	try {
		for (const decl of declarations) {
			const source = service.getProgram()?.getSourceFile(decl.file);
			if (!source) continue;
			const offset = source.getPositionOfLineAndCharacter(decl.position.line, decl.position.character);
			for (const entry of service.getReferencesAtPosition(decl.file, offset) ?? []) {
				const file = path$1.resolve(entry.fileName);
				if (!wanted.has(file)) continue;
				const refSource = service.getProgram()?.getSourceFile(entry.fileName);
				if (!refSource) continue;
				const pos = refSource.getLineAndCharacterOfPosition(entry.textSpan.start);
				(out.get(file) ?? out.set(file, []).get(file)).push(pos);
			}
		}
	} finally {
		service.dispose();
	}
	return out;
}
/** Keep only candidates whose definition is the candidate itself. */
async function confirmDeclarations(client, candidates) {
	const confirmed = [];
	for (const c of candidates) {
		const defs = await client.definition(c.file, c.position);
		if (defs.some((d) => uriToPath(d.uri) === c.file && d.range.start.line === c.position.line) || defs.length === 0) confirmed.push(c);
	}
	return confirmed;
}
function topLevelDeclarations(symbols, name, file) {
	return symbols.filter((s) => s.name === name && TOP_LEVEL_KINDS.has(s.kind)).map((s) => ({
		file,
		position: s.selectionRange.start
	}));
}
function memberDeclarations(symbols, name, file) {
	const out = [];
	for (const container of symbols) {
		if (!CONTAINER_KINDS.has(container.kind)) continue;
		for (const child of container.children ?? []) if (child.name === name && MEMBER_KINDS.has(child.kind)) out.push({
			file,
			position: child.selectionRange.start
		});
	}
	return out;
}
async function resolveOne$1(ts, client, symbol, request, contents, scopeFiles, membership) {
	const { projectRoot, includeTests, tsConfigPath } = request;
	const rel = (p) => relativeTo(projectRoot, p);
	let declarations = [];
	const topLevel = topLevelCandidates(symbol, contents);
	if (topLevel.length > MAX_DECLARATION_CANDIDATES) throw new SymbolTooCommonError(symbol, topLevel.length, MAX_DECLARATION_CANDIDATES, "files in scope look like they declare it");
	for (const file of topLevel) declarations.push(...topLevelDeclarations(await client.documentSymbols(file), symbol, file));
	declarations = await confirmDeclarations(client, declarations);
	let resolvedAsMember = false;
	if (declarations.length === 0) {
		const members = memberCandidates(symbol, contents);
		if (members.length > MAX_DECLARATION_CANDIDATES) throw new SymbolTooCommonError(symbol, members.length, MAX_DECLARATION_CANDIDATES, "files in scope look like they declare a member of that name");
		for (const file of members) declarations.push(...memberDeclarations(await client.documentSymbols(file), symbol, file));
		declarations = await confirmDeclarations(client, declarations);
		resolvedAsMember = declarations.length > 0;
	}
	if (declarations.length === 0) return {
		symbol,
		result: notFound(scopeFiles.size, tsConfigPath),
		locations: []
	};
	for (const decl of new Set(declarations.map((d) => d.file))) {
		const ws = workspaceOf(projectRoot, decl);
		if (ws) await openDependentWorkspaces(client, ws.name, request.scopeRoots);
	}
	const mention = /* @__PURE__ */ new RegExp(`\\b${escapeRegExp(symbol)}\\b`);
	const loadedConfigs = /* @__PURE__ */ new Set();
	const uncovered = [];
	let extraFiles = 0;
	for (const [file, text] of contents) {
		if (!mention.test(text)) continue;
		if (!includeTests && isTestFile(file)) continue;
		const config = membership.coveringConfig(file);
		if (config) {
			if (loadedConfigs.has(config)) continue;
			loadedConfigs.add(config);
			await client.open(file);
			continue;
		}
		if (++extraFiles > MAX_EXTRA_FILES) throw new SymbolTooCommonError(symbol, extraFiles, MAX_EXTRA_FILES, "files outside every tsconfig project mention it");
		if (findTsConfig(path$1.dirname(file), projectRoot)) uncovered.push(file);
		else await client.open(file);
	}
	const fromUncovered = referencesFromUncoveredFiles(ts, uncovered, declarations, membership);
	const declarationFiles = /* @__PURE__ */ new Set();
	const referencingFiles = /* @__PURE__ */ new Set();
	const locations = [];
	const seen = /* @__PURE__ */ new Set();
	let referenceCount = 0;
	let excludedTestReferences = 0;
	for (const decl of declarations) {
		declarationFiles.add(decl.file);
		locations.push({
			file: rel(decl.file),
			line: decl.position.line + 1,
			col: decl.position.character + 1,
			kind: "declaration"
		});
		const merged = [...(await client.references(decl.file, decl.position)).map((r) => ({
			file: uriToPath(r.uri),
			start: r.range.start
		})), ...[...fromUncovered].flatMap(([file, positions]) => positions.map((start) => ({
			file,
			start
		})))];
		for (const ref of merged) {
			const refFile = ref.file;
			if (refFile === decl.file) continue;
			if (!isRepoSource(refFile, projectRoot)) continue;
			const key = `${refFile}:${ref.start.line}:${ref.start.character}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const location = {
				file: rel(refFile),
				line: ref.start.line + 1,
				col: ref.start.character + 1
			};
			if (!includeTests && isTestFile(refFile)) {
				excludedTestReferences++;
				locations.push({
					...location,
					kind: "test"
				});
				continue;
			}
			referenceCount++;
			referencingFiles.add(refFile);
			locations.push({
				...location,
				kind: "reference"
			});
		}
	}
	return {
		symbol,
		result: {
			found: true,
			resolvedAsMember,
			declarationFiles: [...declarationFiles].map(rel).sort(),
			referenceCount,
			referencingFiles: [...referencingFiles].map(rel).sort(),
			excludedTestReferences,
			filesScanned: scopeFiles.size,
			tsConfigPath
		},
		locations
	};
}
/**
* ONE server per call — and therefore one per process for the CLIs — for N
* symbols. The server's project loads are the expensive part (2–2.5 s for
* `apps/client`); each `references` request after that is tens of
* milliseconds, which is what keeps G47's eight symbols far inside the
* executor's 30 s cap.
*/
const tsgoEngine = async (request) => {
	const { ts, tsgoBin } = resolveTsToolchain(request.toolchainRoot ?? request.projectRoot);
	const contents = /* @__PURE__ */ new Map();
	for (const file of request.files) try {
		contents.set(file, fs.readFileSync(file, "utf8"));
	} catch {}
	const scopeFiles = new Set(request.files);
	const client = await LspClient.start({
		rootDir: request.projectRoot,
		bin: tsgoBin,
		args: ["--lsp", "--stdio"],
		name: "tsgo --lsp"
	});
	try {
		for (const scopeRoot of request.scopeRoots) {
			if (findTsConfig(scopeRoot, request.projectRoot)) continue;
			const root = path$1.resolve(scopeRoot);
			for (const file of request.files) if (file === root || file.startsWith(root + path$1.sep)) await client.open(file);
		}
		const membership = new ProjectMembership(ts, request.projectRoot);
		const results = [];
		for (const symbol of request.symbols) results.push(await resolveOne$1(ts, client, symbol, request, contents, scopeFiles, membership));
		return results;
	} finally {
		await client.dispose();
	}
};

//#endregion
//#region ../code-intel/dist/engines/rust-test-code.js
/**
* [issue:ENG-7284] D5 — which lines of a Rust file are TEST code, so the
* rust-analyzer engine can discount references from them.
*
* Pure and linear: each file is lexed ONCE into its comment/string spans and
* its matching brace pairs, and every question after that (is this position
* code, where does this item end, which block encloses it) is a lookup.
* Review round 2 measured the earlier per-attribute rescan at 703 ms for one
* 100 KB file.
*
* ## What is test code
*
* - an ITEM whose outer attribute is `#[test]`, `#[<path>::test]`, or a
*   `#[cfg(...)]` predicate that cannot hold when `test` is false
*   (`cfg(test)`, `cfg(all(test, unix))`; not `cfg(any(test, feature))`,
*   which a feature build turns on, and not `cfg(not(any(test, mock)))`).
*   Items with a body run to their matching `}`; body-less items (`use`,
*   `const`, `static`, `type`, `extern crate`, a tuple struct) run to their
*   `;`. An attribute on anything that is not an item — a struct field, an
*   enum variant, a parameter, a statement — opens no region;
* - the whole file, for an inner `#![cfg(test)]` at file scope, or the
*   enclosing block for one inside `mod x { … }`;
* - an out-of-line `#[cfg(test)] mod x;` is reported by name, and the caller
*   marks that module's file(s) as test code.
*/
/**
* Cargo's build output and vendored crates: `target/` or `vendor/` beside a
* `Cargo.toml`. A module that happens to be named `target` or `vendor`
* (`src/target/mod.rs`) is source and is walked (review round 3 L7).
*/
const rustSkipDir = (parent, name) => (name === "target" || name === "vendor") && fs.existsSync(path$1.join(parent, "Cargo.toml"));
const RAW_STRING = /(?:b|c)?r(#*)"/y;
const CHAR_LITERAL = /'(?:\\(?:u\{[0-9a-fA-F]+\}|x[0-9a-fA-F]{2}|.)|[^\\'\n])'/uy;
var RustSource = class {
	text;
	/** Sorted, non-overlapping `[start, end)` spans of comments and strings. */
	nonCode = [];
	/** Code `{` offset → its matching `}` offset. */
	braceClose = /* @__PURE__ */ new Map();
	/** Code brace pairs, in order of their `{`. */
	bracePairs = [];
	lineStarts = [0];
	constructor(text) {
		this.text = text;
		const stack = [];
		for (let i = 0; i < text.length;) {
			const ch = text[i];
			const next = text[i + 1];
			if (ch === "\n") {
				this.lineStarts.push(i + 1);
				i++;
				continue;
			}
			const end = this.nonCodeEnd(i, ch, next);
			if (end > i) {
				this.nonCode.push([i, end]);
				for (let j = i; j < end; j++) if (text[j] === "\n") this.lineStarts.push(j + 1);
				i = end;
				continue;
			}
			if (ch === "{") stack.push(i);
			else if (ch === "}") {
				const open = stack.pop();
				if (open !== void 0) {
					this.braceClose.set(open, i);
					this.bracePairs.push([open, i]);
				}
			}
			i++;
		}
		this.bracePairs.sort((a, b) => a[0] - b[0]);
	}
	/** End of the comment/string starting at `i`, or `i` when there is none. */
	nonCodeEnd(i, ch, next) {
		const text = this.text;
		if (ch === "/" && next === "/") {
			const nl = text.indexOf("\n", i);
			return nl < 0 ? text.length : nl;
		}
		if (ch === "/" && next === "*") {
			let depth = 1;
			let j = i + 2;
			while (j < text.length && depth > 0) if (text[j] === "/" && text[j + 1] === "*") {
				depth++;
				j += 2;
			} else if (text[j] === "*" && text[j + 1] === "/") {
				depth--;
				j += 2;
			} else j++;
			return j;
		}
		if ((ch === "r" || ch === "b" || ch === "c") && !/\w/.test(text[i - 1] ?? "")) {
			RAW_STRING.lastIndex = i;
			const raw = RAW_STRING.exec(text);
			if (raw) {
				const close = `"${raw[1]}`;
				const end = text.indexOf(close, i + raw[0].length);
				return end < 0 ? text.length : end + close.length;
			}
		}
		if (ch === "\"") {
			let j = i + 1;
			while (j < text.length && text[j] !== "\"") j += text[j] === "\\" ? 2 : 1;
			return Math.min(j + 1, text.length);
		}
		if (ch === "'") {
			CHAR_LITERAL.lastIndex = i;
			const lit = CHAR_LITERAL.exec(text);
			if (lit) return i + lit[0].length;
		}
		return i;
	}
	/** The non-code span containing `pos`, or undefined when `pos` is code. */
	spanAt(pos) {
		let lo = 0;
		let hi = this.nonCode.length - 1;
		while (lo <= hi) {
			const mid = lo + hi >> 1;
			const [s, e] = this.nonCode[mid];
			if (pos < s) hi = mid - 1;
			else if (pos >= e) lo = mid + 1;
			else return this.nonCode[mid];
		}
	}
	isCode(pos) {
		return this.spanAt(pos) === void 0;
	}
	/** `pos`, or the end of the non-code span it falls in. */
	skip(pos) {
		return this.spanAt(pos)?.[1] ?? pos;
	}
	lineAt(offset) {
		let lo = 0;
		let hi = this.lineStarts.length - 1;
		while (lo < hi) {
			const mid = lo + hi + 1 >> 1;
			if (this.lineStarts[mid] <= offset) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	}
	/** The innermost brace pair enclosing `pos`, or undefined at file scope. */
	enclosing(pos) {
		let best;
		for (const pair of this.bracePairs) {
			if (pair[0] > pos) break;
			if (pair[1] > pos) best = pair;
		}
		return best;
	}
	/** Index of the `]` matching the code `[` at `open`, or -1. */
	bracketClose(open) {
		let depth = 0;
		for (let i = open; i < this.text.length;) {
			const skipped = this.skip(i);
			if (skipped !== i) {
				i = skipped;
				continue;
			}
			const ch = this.text[i];
			if (ch === "[") depth++;
			else if (ch === "]" && --depth === 0) return i;
			i++;
		}
		return -1;
	}
	/**
	* The first code character in `stops` at bracket depth 0 at or after
	* `from`, or -1. `()`, `[]` and nested `{}` always count; with `angles`,
	* `<…>` does too (an item signature: `impl Foo<{ N + 1 }> {` must not stop
	* at the const-generic brace, review round 3 L3), where `->` and `=>` are
	* not closers.
	*/
	findAtDepth0(from, stops, angles = false) {
		let depth = 0;
		for (let i = from; i < this.text.length;) {
			const skipped = this.skip(i);
			if (skipped !== i) {
				i = skipped;
				continue;
			}
			const ch = this.text[i];
			const prev = this.text[i - 1];
			if (depth === 0 && stops.includes(ch)) return i;
			if (ch === "(" || ch === "[" || ch === "{" || angles && ch === "<") depth++;
			else if (ch === ")" || ch === "]" || ch === "}" || angles && ch === ">" && prev !== "-" && prev !== "=") {
				if (depth === 0) return -1;
				depth--;
			}
			i++;
		}
		return -1;
	}
};
/**
* Whether a `cfg(...)` predicate can be true when `test` is false. Kleene
* logic: `test` is false, every other option is unknown. The item is test
* code exactly when the result is definitely false. A predicate that does
* not parse is treated as production (never hides a reference).
*/
function cfgIsTestOnly(predicate) {
	let pos = 0;
	const src = predicate;
	const ws = () => {
		while (pos < src.length && /\s/.test(src[pos])) pos++;
	};
	const parse = () => {
		ws();
		const ident = /^[A-Za-z_][\w]*/.exec(src.slice(pos));
		if (!ident) throw new Error("cfg: expected an identifier");
		const name = ident[0];
		pos += name.length;
		ws();
		if (src[pos] === "=") {
			pos++;
			ws();
			const str = /^"(?:[^"\\]|\\.)*"/.exec(src.slice(pos));
			if (!str) throw new Error("cfg: expected a string");
			pos += str[0].length;
			return null;
		}
		if (src[pos] !== "(") return name === "test" ? false : null;
		pos++;
		const args = [];
		ws();
		while (src[pos] !== ")") {
			args.push(parse());
			ws();
			if (src[pos] === ",") {
				pos++;
				ws();
			} else if (src[pos] !== ")") throw new Error("cfg: expected , or )");
		}
		pos++;
		if (name === "not") {
			if (args.length !== 1) throw new Error("cfg: not takes one argument");
			return args[0] === null ? null : !args[0];
		}
		if (name === "all") {
			if (args.includes(false)) return false;
			return args.every((a) => a === true) ? true : null;
		}
		if (name === "any") {
			if (args.includes(true)) return true;
			return args.every((a) => a === false) ? false : null;
		}
		return null;
	};
	try {
		const result = parse();
		ws();
		return pos === src.length && result === false;
	} catch {
		return false;
	}
}
/** Attribute names (last path segment) that make an item a test. */
const TEST_ITEM_ATTRIBUTES = new Set([
	"test",
	"rstest",
	"test_case",
	"bench"
]);
/** Whether an attribute (name, arguments) marks its item as test code. */
function isTestAttribute(name, args) {
	const last = name.split("::").pop() ?? name;
	if (TEST_ITEM_ATTRIBUTES.has(last)) return true;
	return name === "cfg" && args !== void 0 && cfgIsTestOnly(args);
}
const ATTRIBUTE_START = /#(!?)\[/g;
const ATTRIBUTE_BODY = /^\s*([\w:]+)\s*(?:\(([\s\S]*)\))?\s*$/;
const ITEM = /^(?:pub(?:\s*\([^)]*\))?\s+)?(?:(?:default|async|unsafe|const|extern(?:\s+"[^"]*")?)\s+)*(mod|fn|impl|struct|enum|union|trait|const|static|use|type|extern\s+crate|macro_rules!)(?![\w])/;
/** `extern "C" { … }` (optionally `unsafe`), review round 3 L1. */
const EXTERN_BLOCK = /^(?:pub(?:\s*\([^)]*\))?\s+)?(?:unsafe\s+)?extern(?:\s+"[^"]*")?\s*\{/;
/** A macro invocation used as an item: `mock! {…}`, `thread_local!(…);` (L2). */
const MACRO_ITEM = /^(?:[A-Za-z_]\w*::)*[A-Za-z_]\w*!\s*([({[])/;
/** `#[path = "…"]` immediately before (possibly among other attributes). */
const PATH_ATTRIBUTE = /#\[\s*path\s*=\s*"([^"]+)"\s*\]/;
/** A `#[path]` attached to the attribute run that ends at the match. */
const PATH_BEFORE = /#\[\s*path\s*=\s*"([^"]+)"\s*\](?:\s*#\[[^\]]*\])*\s*$/;
/** An out-of-line module declaration. */
const MOD_DECL = /\bmod\s+([A-Za-z_]\w*)\s*;/g;
/** Items whose extent is a `{ … }` body (or a `;` when they have none). */
const BLOCK_ITEMS = new Set([
	"mod",
	"fn",
	"impl",
	"struct",
	"enum",
	"union",
	"trait",
	"macro_rules!"
]);
function cfgTestRegions(text) {
	const src = new RustSource(text);
	const ranges = [];
	const outOfLine = [];
	const outOfLinePaths = [];
	let wholeFile = false;
	for (const match of text.matchAll(ATTRIBUTE_START)) {
		const at = match.index;
		if (!src.isCode(at)) continue;
		const open = at + match[0].length - 1;
		const close = src.bracketClose(open);
		if (close < 0) continue;
		const body = ATTRIBUTE_BODY.exec(text.slice(open + 1, close));
		if (!body || !isTestAttribute(body[1] ?? "", body[2])) continue;
		if (match[1] === "!") {
			const block = src.enclosing(at);
			if (!block) wholeFile = true;
			else ranges.push([src.lineAt(block[0]), src.lineAt(block[1])]);
			continue;
		}
		let p = close + 1;
		let pathTarget = PATH_BEFORE.exec(text.slice(Math.max(0, at - 300), at))?.[1];
		for (;;) {
			while (p < text.length && (/\s/.test(text[p]) || !src.isCode(p))) p = src.isCode(p) ? p + 1 : src.skip(p);
			if (text[p] === "#" && text[p + 1] === "[") {
				const next = src.bracketClose(p + 1);
				if (next < 0) break;
				pathTarget = PATH_ATTRIBUTE.exec(text.slice(p, next + 1))?.[1] ?? pathTarget;
				p = next + 1;
				continue;
			}
			break;
		}
		const head = text.slice(p, p + 200);
		const externBlock = EXTERN_BLOCK.exec(head);
		if (externBlock) {
			const end$1 = src.braceClose.get(p + externBlock[0].length - 1);
			if (end$1 !== void 0) ranges.push([src.lineAt(at), src.lineAt(end$1)]);
			continue;
		}
		const item = ITEM.exec(head);
		if (!item) {
			const macro = MACRO_ITEM.exec(head);
			if (macro) {
				const open$1 = p + macro[0].length - 1;
				const end$1 = text[open$1] === "{" ? src.braceClose.get(open$1) : src.findAtDepth0(open$1, ";");
				if (end$1 !== void 0 && end$1 >= 0) ranges.push([src.lineAt(at), src.lineAt(end$1)]);
			}
			continue;
		}
		const kind = item[1].replace(/\s+/g, " ");
		const afterKeyword = p + item[0].length;
		if (kind === "mod") {
			const decl = /^\s*([A-Za-z_]\w*)\s*;/.exec(text.slice(afterKeyword));
			if (decl) {
				if (pathTarget) outOfLinePaths.push(pathTarget);
				else outOfLine.push(decl[1]);
				continue;
			}
		}
		let end;
		if (BLOCK_ITEMS.has(kind)) {
			const stop = src.findAtDepth0(afterKeyword, "{;", true);
			if (stop < 0) continue;
			end = text[stop] === "{" ? src.braceClose.get(stop) ?? -1 : stop;
		} else end = src.findAtDepth0(afterKeyword, ";");
		if (end < 0) continue;
		ranges.push([src.lineAt(at), src.lineAt(end)]);
	}
	const declaredMods = [];
	for (const m of text.matchAll(MOD_DECL)) if (src.isCode(m.index)) declaredMods.push(m[1]);
	return {
		ranges,
		outOfLine,
		wholeFile,
		outOfLinePaths,
		declaredMods
	};
}

//#endregion
//#region ../code-intel/dist/engines/rust-analyzer.js
/** The files the Rust engine treats as source. */
const RUST_SOURCE = /\.rs$/;
const RA_BIN = "rust-analyzer";
const INSTALL_REMEDY = "Install it with `rustup component add rust-analyzer` and make sure `rust-analyzer` is on PATH.";
/** Default bound on the indexing wait; `CODE_INTEL_RA_TIMEOUT_MS` overrides. */
const DEFAULT_INDEX_TIMEOUT_MS = 3e5;
function indexTimeoutMs(env = process.env) {
	const raw = Number(env.CODE_INTEL_RA_TIMEOUT_MS);
	return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INDEX_TIMEOUT_MS;
}
/**
* Refuse up front when `rust-analyzer` cannot run. rustup installs a proxy
* named `rust-analyzer` for every toolchain, which exits non-zero with
* "Unknown binary" until the component is added, so existence on PATH is not
* enough: `--version` must succeed.
*/
function assertRustAnalyzer(bin = RA_BIN) {
	const probe = spawnSync(bin, ["--version"], { encoding: "utf8" });
	if (probe.error || probe.status !== 0) {
		const detail = (probe.stderr || probe.error?.message || "").trim();
		throw new ToolchainError(`rust-analyzer is not available${detail ? ` (${detail.split("\n")[0]})` : ""}.`, INSTALL_REMEDY);
	}
}
/**
* The directory rust-analyzer should treat as the workspace: the HIGHEST
* directory between the scope and the repository root that holds a
* `Cargo.toml`, so a scope inside one member of a Cargo workspace still
* loads the whole workspace (and its cross-crate references).
*/
function cargoRoot(scopeRoot, projectRoot) {
	const stop = path$1.resolve(projectRoot);
	let dir = path$1.resolve(scopeRoot);
	if (fs.statSync(dir, { throwIfNoEntry: false })?.isFile()) dir = path$1.dirname(dir);
	let found = null;
	for (;;) {
		if (fs.existsSync(path$1.join(dir, "Cargo.toml"))) found = dir;
		if (dir === stop) break;
		const parent = path$1.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	if (!found) throw new ToolchainError(`No Cargo.toml at or above ${relativeTo(projectRoot, scopeRoot)}.`, "Point --scope inside a Cargo crate or workspace.");
	return found;
}
/**
* A file that is test code in full, by its path alone: under a `tests/`
* directory of the crate, or named `tests.rs` / `*_test.rs` / `*_tests.rs`.
* Judged relative to `crateRoot`, so a checkout that itself sits under some
* `tests/` directory is not all test code.
*/
function isRustTestPath(file, crateRoot) {
	const resolved = path$1.resolve(file);
	const parts = (crateRoot ? path$1.relative(crateRoot, resolved) : resolved).split(path$1.sep);
	if (parts.slice(0, -1).includes("tests")) return true;
	const base = parts[parts.length - 1] ?? "";
	return base === "tests.rs" || base.endsWith("_test.rs") || base.endsWith("_tests.rs");
}
/**
* Answers "is this location test code?" for one crate. Every `.rs` file of
* the crate is scanned up front for out-of-line `#[cfg(test)] mod x;`
* declarations, so a reference in `x.rs` is test code whichever file the
* server happens to return first.
*/
var TestCode = class {
	crateRoot;
	regions = /* @__PURE__ */ new Map();
	testFiles = /* @__PURE__ */ new Set();
	constructor(crateRoot) {
		this.crateRoot = crateRoot;
		for (const file of listSourceFiles(crateRoot, RUST_SOURCE, rustSkipDir)) this.regionsOf(path$1.resolve(file));
	}
	isTest(file, line) {
		const resolved = path$1.resolve(file);
		if (isRustTestPath(resolved, this.crateRoot) || this.testFiles.has(resolved)) return true;
		const { ranges, wholeFile } = this.regionsOf(resolved);
		return wholeFile || ranges.some(([a, b]) => line >= a && line <= b);
	}
	regionsOf(file) {
		const cached = this.regions.get(file);
		if (cached) return cached;
		let text = "";
		try {
			text = fs.readFileSync(file, "utf8");
		} catch {}
		const regions = cfgTestRegions(text);
		const dir = path$1.dirname(file);
		const stem = path$1.basename(file, ".rs");
		const moduleDir = [
			"mod",
			"lib",
			"main"
		].includes(stem) ? dir : path$1.join(dir, stem);
		const markModule = (name) => {
			this.testFiles.add(path$1.join(moduleDir, `${name}.rs`));
			for (const f of listSourceFiles(path$1.join(moduleDir, name), RUST_SOURCE, rustSkipDir)) this.testFiles.add(path$1.resolve(f));
		};
		for (const name of regions.outOfLine) markModule(name);
		for (const target of regions.outOfLinePaths) this.testFiles.add(path$1.resolve(dir, target));
		if (regions.wholeFile || this.testFiles.has(file)) for (const name of regions.declaredMods) markModule(name);
		this.regions.set(file, regions);
		return regions;
	}
};
function inside(file, roots) {
	const f = path$1.resolve(file);
	return roots.some((r) => {
		const root = path$1.resolve(r);
		return f === root || f.startsWith(root + path$1.sep);
	});
}
/** The identifier position of `name` declared in `file` within `range`. */
function identifierIn(symbols, name, range) {
	const within = (p) => (p.line > range.start.line || p.line === range.start.line && p.character >= range.start.character) && (p.line < range.end.line || p.line === range.end.line && p.character <= range.end.character);
	const stack = [...symbols];
	while (stack.length) {
		const s = stack.pop();
		if (s.name === name && within(s.selectionRange.start)) return s.selectionRange.start;
		stack.push(...s.children ?? []);
	}
	return null;
}
async function resolveOne(client, symbol, request, testCode) {
	const { projectRoot, includeTests } = request;
	const rel = (p) => relativeTo(projectRoot, p);
	const hits = (await client.workspaceSymbol(symbol)).filter((s) => s.name === symbol && s.location.uri.startsWith("file:") && inside(uriToPath(s.location.uri), request.scopeRoots));
	const declarations = [];
	const seenDecl = /* @__PURE__ */ new Set();
	for (const hit of hits) {
		const file = uriToPath(hit.location.uri);
		const position = identifierIn(await client.documentSymbols(file), symbol, hit.location.range) ?? hit.location.range.start;
		const key = `${file}:${position.line}:${position.character}`;
		if (seenDecl.has(key)) continue;
		seenDecl.add(key);
		declarations.push({
			file,
			position
		});
	}
	if (declarations.length === 0) return {
		symbol,
		result: notFound(request.files.length, null),
		locations: []
	};
	const declarationFiles = /* @__PURE__ */ new Set();
	const referencingFiles = /* @__PURE__ */ new Set();
	const locations = [];
	const seen = /* @__PURE__ */ new Set();
	let referenceCount = 0;
	let excludedTestReferences = 0;
	const root = path$1.resolve(projectRoot) + path$1.sep;
	for (const decl of declarations) {
		declarationFiles.add(decl.file);
		locations.push({
			file: rel(decl.file),
			line: decl.position.line + 1,
			col: decl.position.character + 1,
			kind: "declaration"
		});
		const refs = await client.references(decl.file, decl.position);
		for (const ref of refs) {
			if (!ref.uri.startsWith("file:")) continue;
			const refFile = uriToPath(ref.uri);
			if (refFile === decl.file) continue;
			if (!refFile.startsWith(root)) continue;
			const start = ref.range.start;
			const key = `${refFile}:${start.line}:${start.character}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const location = {
				file: rel(refFile),
				line: start.line + 1,
				col: start.character + 1
			};
			if (!includeTests && testCode.isTest(refFile, start.line)) {
				excludedTestReferences++;
				locations.push({
					...location,
					kind: "test"
				});
				continue;
			}
			referenceCount++;
			referencingFiles.add(refFile);
			locations.push({
				...location,
				kind: "reference"
			});
		}
	}
	return {
		symbol,
		result: {
			found: true,
			resolvedAsMember: false,
			declarationFiles: [...declarationFiles].map(rel).sort(),
			referenceCount,
			referencingFiles: [...referencingFiles].map(rel).sort(),
			excludedTestReferences,
			filesScanned: request.files.length,
			tsConfigPath: null
		},
		locations
	};
}
/**
* ONE server per call, for N symbols: indexing is the expensive part, each
* `references` request after it is cheap.
*/
const rustAnalyzerEngine = async (request) => {
	assertRustAnalyzer();
	const workspaceRoot = cargoRoot(request.scopeRoots[0], request.projectRoot);
	const timeoutMs = indexTimeoutMs();
	let client;
	try {
		client = await LspClient.start({
			rootDir: workspaceRoot,
			bin: RA_BIN,
			args: [],
			name: "rust-analyzer",
			capabilities: {
				workspace: {
					configuration: false,
					symbol: {}
				},
				experimental: { serverStatusNotification: true },
				window: { workDoneProgress: true }
			},
			initializationOptions: {
				checkOnSave: false,
				workspace: { symbol: { search: {
					kind: "all_symbols",
					scope: "workspace"
				} } }
			},
			responseTimeoutMs: timeoutMs
		});
	} catch (e) {
		throw new ToolchainError(`rust-analyzer did not start: ${e.message}`, INSTALL_REMEDY);
	}
	try {
		let status;
		try {
			status = await client.waitForNotification("experimental/serverStatus", (p) => p?.quiescent === true, timeoutMs);
		} catch (e) {
			throw new ToolchainError(`rust-analyzer did not finish indexing ${relativeTo(request.projectRoot, workspaceRoot) || "."}: ${e.message}.`, "Raise CODE_INTEL_RA_TIMEOUT_MS for a large workspace, or check that `cargo metadata` succeeds there.");
		}
		if (status.health === "error") throw new ToolchainError(`rust-analyzer reports an error loading the workspace${status.message ? `: ${status.message}` : ""}.`, "Check that `cargo metadata` succeeds in the crate.");
		const testCode = new TestCode(workspaceRoot);
		const results = [];
		for (const symbol of request.symbols) results.push(await resolveOne(client, symbol, request, testCode));
		return results;
	} finally {
		await client.dispose();
	}
};

//#endregion
//#region ../code-intel/dist/registry.js
const engines = {
	ts: {
		resolve: tsgoEngine,
		source: TS_SOURCE,
		usesTsConfig: true
	},
	rust: {
		resolve: rustAnalyzerEngine,
		source: RUST_SOURCE,
		usesTsConfig: false,
		skipDir: rustSkipDir
	}
};
const REFS_LANGUAGES = Object.keys(engines);
function isRefsLanguage(value) {
	return Object.prototype.hasOwnProperty.call(engines, value);
}
/**
* The request an engine receives: absolute scope roots, every source file
* in them, and the scope cap applied BEFORE anything loads.
*/
function buildEngineRequest(options) {
	const engine = engines[options.language];
	const projectRoot = path$1.resolve(options.projectRoot);
	const scopeRoots = options.scopes.map((s) => path$1.resolve(projectRoot, s));
	const files = [...new Set(scopeRoots.flatMap((r) => listSourceFiles(r, engine.source, "skipDir" in engine ? engine.skipDir : void 0)))].sort();
	const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
	if (files.length > maxFiles) throw new ScopeTooBroadError(files.length, maxFiles, options.scopes.join(", "));
	const tsConfig = engine.usesTsConfig && scopeRoots[0] ? findTsConfig(scopeRoots[0], projectRoot) : null;
	return {
		symbols: options.symbols,
		projectRoot,
		scopeRoots,
		files,
		includeTests: options.includeTests,
		tsConfigPath: tsConfig ? relativeTo(projectRoot, tsConfig) : null
	};
}

//#endregion
//#region src/commands/gates/refsHandler.ts
/** Locations printed after the verdict. */
const MAX_LOCATIONS = 20;
function usage(message) {
	return {
		exitCode: 2,
		stdout: "",
		stderr: `gates refs: ${message}\n`
	};
}
/** A relative path that leaves its base (`..` or `../x`, not `..cache`). */
function escapes(rel) {
	return rel === ".." || rel.startsWith(`..${path$1.sep}`) || path$1.isAbsolute(rel);
}
/**
* The scope, repository-relative, or a reason it is refused. It must exist
* and resolve INSIDE the repository, never to the root itself: the root is
* the whole repository, which no engine loads (the resolver's ENG-5106
* rule). Symlinks are resolved first, so a link cannot point the search
* outside.
*/
function resolveScope(projectRoot, scope) {
	const trimmed = scope.trim();
	if (!trimmed) return { error: "--scope is required" };
	const root = fs.realpathSync(projectRoot);
	const target = path$1.resolve(root, trimmed);
	let real;
	try {
		real = fs.realpathSync(target);
	} catch {
		if (escapes(path$1.relative(root, target))) return { error: `--scope "${scope}" resolves outside the repository (${root})` };
		return { error: `--scope "${scope}" does not exist` };
	}
	const rel = path$1.relative(root, real);
	if (escapes(rel)) return { error: `--scope "${scope}" resolves outside the repository (${root})` };
	if (rel === "") return { error: `--scope "${scope}" is the repository root; name a directory narrower than the root (e.g. apps/backender/src)` };
	return { scope: rel };
}
function formatLocation(loc) {
	return `  ${loc.kind.padEnd(11)} ${loc.file}:${loc.line}:${loc.col}`;
}
/** One-line verdict plus up to MAX_LOCATIONS locations. */
function formatRefs(resolution, language, scope) {
	const { symbol, result } = resolution;
	const where = `[${language}, scope ${scope}]`;
	if (!result.found) return `FAIL ${symbol}: not found in ${result.filesScanned} file(s) ${where}\n`;
	const tests = result.excludedTestReferences ? `; ${result.excludedTestReferences} in test code not counted (--include-tests counts them)` : "";
	const lines = [result.referenceCount > 0 ? `PASS ${symbol}: declared in ${result.declarationFiles.join(", ")}; ${result.referenceCount} reference(s) from ${result.referencingFiles.length} other module(s)${tests} ${where}` : `FAIL ${symbol}: declared in ${result.declarationFiles.join(", ")} but not referenced from any other module${tests} ${where}`];
	const rank = {
		declaration: 0,
		reference: 1,
		test: 2
	};
	const ordered = [...resolution.locations].sort((a, b) => rank[a.kind] - rank[b.kind]);
	const shown = ordered.slice(0, MAX_LOCATIONS);
	lines.push(...shown.map(formatLocation));
	const more = ordered.length - shown.length;
	if (more > 0) lines.push(`  … ${more} more`);
	return lines.join("\n") + "\n";
}
/** The whole command minus process I/O, so tests can drive it. */
async function executeRefs(flags, cwd = process.cwd()) {
	if (!isRefsLanguage(flags.lang)) return usage(`--lang "${flags.lang}" is not a language this CLI resolves; expected one of: ${REFS_LANGUAGES.join(", ")}`);
	const symbol = flags.symbol.trim();
	if (!symbol) return usage("--symbol is required");
	const projectRoot = findProjectRoot(cwd);
	const scoped = resolveScope(projectRoot, flags.scope);
	if ("error" in scoped) return usage(scoped.error);
	try {
		const request = buildEngineRequest({
			language: flags.lang,
			symbols: [symbol],
			projectRoot,
			scopes: [scoped.scope],
			includeTests: flags["include-tests"]
		});
		const [resolution] = await engines[flags.lang].resolve(request);
		if (!resolution) return usage(`no answer for "${symbol}"`);
		return {
			exitCode: resolution.result.found && resolution.result.referenceCount > 0 ? 0 : 1,
			stdout: formatRefs(resolution, flags.lang, scoped.scope),
			stderr: ""
		};
	} catch (error) {
		if (error instanceof ToolchainError || error instanceof ScopeTooBroadError || error instanceof SymbolTooCommonError) return usage(error.message);
		return usage(`resolution failed for "${symbol}": ${error instanceof Error ? error.message : String(error)}`);
	}
}
async function gatesRefsHandler(flags) {
	const result = await executeRefs(flags);
	if (result.stdout.length > 0) this.process.stdout.write(result.stdout);
	if (result.stderr.length > 0) this.process.stderr.write(result.stderr);
	this.process.exitCode = result.exitCode;
}

//#endregion
export { gatesRefsHandler };