import { getApiUrl } from "./env-CdwyPHGV.js";

//#region ../sdk-public/dist/runtime/client.js
function createInterceptorManager() {
	const _fns = [];
	return {
		_fns,
		use(fn) {
			_fns.push(fn);
		},
		eject(fn) {
			const idx = _fns.indexOf(fn);
			if (idx !== -1) _fns[idx] = void 0;
		}
	};
}
function buildPath(urlTemplate, pathParams) {
	if (!pathParams) return urlTemplate;
	return urlTemplate.replace(/\{(\w+)\}/g, (_, key) => {
		const val = pathParams[key];
		if (val === void 0) return `{${key}}`;
		const str = typeof val === "object" && val !== null ? JSON.stringify(val) : String(val);
		return encodeURIComponent(str);
	});
}
function buildQuery(query) {
	if (!query) return "";
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value === null || value === void 0) continue;
		if (Array.isArray(value)) {
			for (const item of value) if (item !== null && item !== void 0) params.append(key, String(item));
		} else if (typeof value === "object") params.append(key, JSON.stringify(value));
		else params.append(key, String(value));
	}
	const str = params.toString();
	return str ? `?${str}` : "";
}
async function setAuthHeader(headers, config, security) {
	if (!security?.length || !config.auth) return;
	const scheme = security[0];
	if (!scheme) return;
	let token;
	if (typeof config.auth === "function") token = await config.auth(scheme);
	else token = config.auth;
	if (token) {
		const prefix = token.startsWith("Bearer ") ? "" : "Bearer ";
		headers.set("Authorization", `${prefix}${token}`);
	}
}
function createClient(initialConfig = {}) {
	let _config = { ...initialConfig };
	const interceptors = {
		request: createInterceptorManager(),
		response: createInterceptorManager(),
		error: createInterceptorManager()
	};
	const getConfig = () => ({ ..._config });
	const setConfig = (config) => {
		_config = { ...config };
		return getConfig();
	};
	const request = async (options) => {
		const fetchFn = _config.fetch ?? globalThis.fetch;
		const url = `${(typeof _config.baseUrl === "function" ? _config.baseUrl() : _config.baseUrl) ?? ""}${buildPath(options.url, options.path)}${buildQuery(options.query)}`;
		const headers = new Headers();
		if (_config.headers) for (const [k, v] of Object.entries(_config.headers)) headers.set(k, v);
		if (options.headers) for (const [k, v] of Object.entries(options.headers)) headers.set(k, v);
		if (_config.workspaceId) {
			if (!headers.has("Workspace-Id")) headers.set("Workspace-Id", _config.workspaceId);
		}
		await setAuthHeader(headers, _config, options.security);
		let body;
		if (options.body !== void 0) if (options.bodySerializer) {
			const serialized = options.bodySerializer(options.body);
			if (serialized instanceof FormData) {
				body = serialized;
				headers.delete("Content-Type");
			} else body = serialized;
		} else if (options.body instanceof FormData) {
			body = options.body;
			headers.delete("Content-Type");
		} else {
			body = JSON.stringify(options.body);
			if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
		}
		else headers.delete("Content-Type");
		if (options.requestValidator) await options.requestValidator(options);
		let req = new Request(url, {
			method: options.method ?? "GET",
			headers,
			body,
			redirect: "follow",
			credentials: "include"
		});
		for (const fn of interceptors.request._fns) if (fn) req = await fn(req, options);
		let response = await fetchFn(req);
		for (const fn of interceptors.response._fns) if (fn) response = await fn(response, req, options);
		const result = {
			request: req,
			response
		};
		if (response.ok) {
			if (response.status === 204 || response.headers.get("Content-Length") === "0") return {
				ok: true,
				data: {},
				error: void 0,
				...result
			};
			const parseAs = options.parseAs ?? "json";
			let data;
			if (parseAs === "stream") return {
				ok: true,
				data: response.body,
				error: void 0,
				...result
			};
			if (parseAs === "auto" || parseAs === "json") if ((response.headers.get("Content-Type") ?? "").includes("json")) data = await response.json();
			else data = await response.text();
			else data = await response[parseAs]();
			if (parseAs === "json" && options.responseTransformer) data = await options.responseTransformer(data);
			return {
				ok: true,
				data,
				error: void 0,
				...result
			};
		}
		const textError = await response.text();
		let jsonError;
		try {
			jsonError = JSON.parse(textError);
		} catch {}
		let error = jsonError ?? textError;
		for (const fn of interceptors.error._fns) if (fn) error = await fn(error, response, req, options);
		error = error || {};
		if (options.throwOnError) throw error;
		return {
			ok: false,
			data: void 0,
			error,
			...result
		};
	};
	return {
		getConfig,
		setConfig,
		request,
		get: (options) => request({
			...options,
			method: "GET"
		}),
		post: (options) => request({
			...options,
			method: "POST"
		}),
		put: (options) => request({
			...options,
			method: "PUT"
		}),
		patch: (options) => request({
			...options,
			method: "PATCH"
		}),
		delete: (options) => request({
			...options,
			method: "DELETE"
		}),
		interceptors
	};
}

//#endregion
//#region ../sdk-public/dist/runtime/index.js
const defaultConfig = { baseUrl: "https://api.levr.one" };
const client = createClient(defaultConfig);

//#endregion
//#region ../sdk-public/dist/gen/attachment-upload/functions.js
/** POST /v1/attachment/upload */
const attachmentUploadUploadV1 = (options) => {
	return (options?.client ?? client).post({
		security: [{
			scheme: "bearer",
			type: "http"
		}],
		url: "/v1/attachment/upload",
		bodySerializer: (body) => {
			const fd = new FormData();
			if (body && typeof body === "object") for (const [k, v] of Object.entries(body)) {
				if (v == null) continue;
				fd.append(k, v instanceof Blob ? v : String(v));
			}
			return fd;
		},
		...options
	});
};

//#endregion
//#region ../sdk-public/dist/gen/auth/functions.js
/** GET /v1/auth/profile */
const authGetProfileV1 = (options) => {
	return (options?.client ?? client).get({
		security: [{
			scheme: "bearer",
			type: "http"
		}],
		url: "/v1/auth/profile",
		...options
	});
};
/** GET /v1/auth/sites */
const authGetSitesV1 = (options) => {
	return (options?.client ?? client).get({
		security: [{
			scheme: "bearer",
			type: "http"
		}],
		url: "/v1/auth/sites",
		...options
	});
};

//#endregion
//#region ../sdk-public/dist/gen/comment-issue/functions.js
/** POST /v1/comment-issue */
const commentIssueCreateV1 = (options) => {
	return (options?.client ?? client).post({
		security: [{
			scheme: "bearer",
			type: "http"
		}],
		url: "/v1/comment-issue",
		...options
	});
};

//#endregion
//#region ../sdk-public/dist/gen/comment-run/functions.js
/** POST /v1/comment-run */
const commentRunCreateV1 = (options) => {
	return (options?.client ?? client).post({
		security: [{
			scheme: "bearer",
			type: "http"
		}],
		url: "/v1/comment-run",
		...options
	});
};

//#endregion
//#region ../sdk-public/dist/gen/comment-test/functions.js
/** POST /v1/comment-test */
const commentTestCreateV1 = (options) => {
	return (options?.client ?? client).post({
		security: [{
			scheme: "bearer",
			type: "http"
		}],
		url: "/v1/comment-test",
		...options
	});
};

//#endregion
//#region ../sdk-public/dist/gen/import/functions.js
/** POST /v1/imports */
const importCreateV1 = (options) => {
	return (options?.client ?? client).post({
		security: [{
			scheme: "bearer",
			type: "http"
		}],
		url: "/v1/imports",
		bodySerializer: (body) => {
			const fd = new FormData();
			if (body && typeof body === "object") for (const [k, v] of Object.entries(body)) {
				if (v == null) continue;
				fd.append(k, v instanceof Blob ? v : String(v));
			}
			return fd;
		},
		...options
	});
};

//#endregion
//#region ../sdk-public/dist/gen/run-api/functions.js
/** PATCH /v1/run/run-result-variant/{runResultVariantId} */
const runApiUpdateRunResultVariantByIdV1 = (options) => {
	return (options?.client ?? client).patch({
		security: [{
			scheme: "bearer",
			type: "http"
		}],
		url: "/v1/run/run-result-variant/{runResultVariantId}",
		...options
	});
};

//#endregion
//#region src/utils/sdk-client.ts
/**
* Configure the SDK client with the resolved auth token and API URL.
*/
function configureClient(auth, workspaceId) {
	client.setConfig({
		baseUrl: getApiUrl(),
		auth: () => auth.token,
		workspaceId
	});
}
/**
* Upload a test result file via the generated SDK function.
* importCreateV1 handles auth, FormData serialization, and Content-Type automatically.
*
* Note: requestValidator is disabled because the generated Zod schema types
* `file` as z.string() (from OpenAPI `format: binary`) but we pass a File object.
* The server validates the actual multipart payload.
*/
async function uploadImport(options) {
	const result = await importCreateV1({
		body: {
			file: options.file,
			team_id: options.teamId,
			format: options.format,
			run_name: options.runName,
			automation_source: options.automationSource,
			automation_source_id: options.automationSourceId,
			import_metadata: options.importMetadata ? JSON.stringify(options.importMetadata) : void 0,
			include_results: options.includeResults ? true : void 0
		},
		requestValidator: void 0
	});
	if (result.error) {
		const status = result.response?.status;
		switch (status) {
			case 401: throw new Error("Authentication failed. Check your token or run 'levr auth login'.");
			case 403: throw new Error("Permission denied. Check your team access.");
			case 404: throw new Error(tryReadMessage(result.error) ?? "Not found. Check --automation-source and --team-id.");
			case 422: throw new Error("File could not be processed. Check the file format.");
			case 429: throw new Error("Rate limited. Please try again later.");
			default: throw new Error(`Import failed (${String(status ?? "unknown")}): ${JSON.stringify(result.error)}`);
		}
	}
	return result.data;
}
function tryReadMessage(err) {
	if (err && typeof err === "object" && "message" in err) {
		const m = err.message;
		return typeof m === "string" ? m : void 0;
	}
}
async function uploadAttachment(body) {
	const result = await attachmentUploadUploadV1({
		body,
		requestValidator: void 0
	});
	return {
		status: result.response?.status ?? 0,
		data: result.data,
		error: result.error
	};
}
/**
* Server-side append to an execution result's actual_result, addressed by
* the variant id alone (ENG-6161 PATCH /v1/run/run-result-variant/:id). Never
* a read-modify-write: the server appends.
*/
async function appendActualResult(runResultVariantId, text) {
	const result = await runApiUpdateRunResultVariantByIdV1({
		path: { runResultVariantId },
		body: { append_actual_result: text },
		requestValidator: void 0
	});
	if (result.error) throw new Error(`Append failed (${String(result.response?.status ?? "unknown")}): ${tryReadMessage(result.error) ?? JSON.stringify(result.error)}`);
}
/** A NEW comment on an issue, test or run (append-only; ENG-6164 --embed). */
async function createComment(target, targetId, body) {
	const result = target === "issue" ? await commentIssueCreateV1({
		body: {
			issue_id: targetId,
			body
		},
		requestValidator: void 0
	}) : target === "test" ? await commentTestCreateV1({
		body: {
			test_id: targetId,
			body
		},
		requestValidator: void 0
	}) : await commentRunCreateV1({
		body: {
			run_id: targetId,
			body
		},
		requestValidator: void 0
	});
	if (result.error) throw new Error(`Comment failed (${String(result.response?.status ?? "unknown")}): ${tryReadMessage(result.error) ?? JSON.stringify(result.error)}`);
}

//#endregion
export { appendActualResult, authGetProfileV1, authGetSitesV1, client, configureClient, createComment, uploadAttachment, uploadImport };