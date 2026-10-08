function createInterceptorManager() {
    const _fns = [];
    return {
        _fns,
        use(fn) {
            _fns.push(fn);
        },
        eject(fn) {
            const idx = _fns.indexOf(fn);
            if (idx !== -1)
                _fns[idx] = undefined;
        },
    };
}
function buildPath(urlTemplate, pathParams) {
    if (!pathParams)
        return urlTemplate;
    return urlTemplate.replace(/\{(\w+)\}/g, (_, key) => {
        const val = pathParams[key];
        if (val === undefined)
            return `{${key}}`;
        const str = typeof val === 'object' && val !== null
            ? JSON.stringify(val)
            : String(val);
        return encodeURIComponent(str);
    });
}
function buildQuery(query) {
    if (!query)
        return '';
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value === null || value === undefined)
            continue;
        if (Array.isArray(value)) {
            for (const item of value) {
                if (item !== null && item !== undefined) {
                    params.append(key, String(item));
                }
            }
        }
        else if (typeof value === 'object') {
            params.append(key, JSON.stringify(value));
        }
        else {
            params.append(key, String(value));
        }
    }
    const str = params.toString();
    return str ? `?${str}` : '';
}
async function setAuthHeader(headers, config, security) {
    if (!security?.length || !config.auth)
        return;
    const scheme = security[0];
    if (!scheme)
        return;
    let token;
    if (typeof config.auth === 'function') {
        token = await config.auth(scheme);
    }
    else {
        token = config.auth;
    }
    if (token) {
        const prefix = token.startsWith('Bearer ') ? '' : 'Bearer ';
        headers.set('Authorization', `${prefix}${token}`);
    }
}
export function createClient(initialConfig = {}) {
    let _config = { ...initialConfig };
    const interceptors = {
        request: createInterceptorManager(),
        response: createInterceptorManager(),
        error: createInterceptorManager(),
    };
    const getConfig = () => ({ ..._config });
    const setConfig = (config) => {
        _config = { ...config };
        return getConfig();
    };
    const request = async (options) => {
        const fetchFn = _config.fetch ?? globalThis.fetch;
        const resolvedBase = typeof _config.baseUrl === 'function'
            ? _config.baseUrl()
            : _config.baseUrl;
        const base = resolvedBase ?? '';
        const pathStr = buildPath(options.url, options.path);
        const queryStr = buildQuery(options.query);
        const url = `${base}${pathStr}${queryStr}`;
        const headers = new Headers();
        if (_config.headers) {
            for (const [k, v] of Object.entries(_config.headers)) {
                headers.set(k, v);
            }
        }
        if (options.headers) {
            for (const [k, v] of Object.entries(options.headers)) {
                headers.set(k, v);
            }
        }
        if (_config.workspaceId) {
            if (!headers.has('Workspace-Id')) {
                headers.set('Workspace-Id', _config.workspaceId);
            }
        }
        await setAuthHeader(headers, _config, options.security);
        let body;
        if (options.body !== undefined) {
            if (options.bodySerializer) {
                const serialized = options.bodySerializer(options.body);
                if (serialized instanceof FormData) {
                    body = serialized;
                    headers.delete('Content-Type');
                }
                else {
                    body = serialized;
                }
            }
            else if (options.body instanceof FormData) {
                body = options.body;
                headers.delete('Content-Type');
            }
            else {
                body = JSON.stringify(options.body);
                if (!headers.has('Content-Type')) {
                    headers.set('Content-Type', 'application/json');
                }
            }
        }
        else {
            headers.delete('Content-Type');
        }
        if (options.requestValidator) {
            await options.requestValidator(options);
        }
        let req = new Request(url, {
            method: options.method ?? 'GET',
            headers,
            body,
            redirect: 'follow',
            credentials: 'include',
        });
        for (const fn of interceptors.request._fns) {
            if (fn)
                req = await fn(req, options);
        }
        let response = await fetchFn(req);
        for (const fn of interceptors.response._fns) {
            if (fn)
                response = await fn(response, req, options);
        }
        const result = { request: req, response };
        if (response.ok) {
            if (response.status === 204 ||
                response.headers.get('Content-Length') === '0') {
                return {
                    ok: true,
                    data: {},
                    error: undefined,
                    ...result,
                };
            }
            const parseAs = options.parseAs ?? 'json';
            let data;
            if (parseAs === 'stream') {
                return {
                    ok: true,
                    data: response.body,
                    error: undefined,
                    ...result,
                };
            }
            if (parseAs === 'auto' || parseAs === 'json') {
                const ct = response.headers.get('Content-Type') ?? '';
                if (ct.includes('json')) {
                    data = await response.json();
                }
                else {
                    data = await response.text();
                }
            }
            else {
                data = await response[parseAs]();
            }
            if (parseAs === 'json' && options.responseTransformer) {
                data = await options.responseTransformer(data);
            }
            return {
                ok: true,
                data: data,
                error: undefined,
                ...result,
            };
        }
        const textError = await response.text();
        let jsonError;
        try {
            jsonError = JSON.parse(textError);
        }
        catch { }
        let error = jsonError ?? textError;
        for (const fn of interceptors.error._fns) {
            if (fn)
                error = await fn(error, response, req, options);
        }
        error = error || {};
        if (options.throwOnError) {
            throw error;
        }
        return {
            ok: false,
            data: undefined,
            error: error,
            ...result,
        };
    };
    return {
        getConfig,
        setConfig,
        request,
        get: (options) => request({ ...options, method: 'GET' }),
        post: (options) => request({ ...options, method: 'POST' }),
        put: (options) => request({ ...options, method: 'PUT' }),
        patch: (options) => request({ ...options, method: 'PATCH' }),
        delete: (options) => request({ ...options, method: 'DELETE' }),
        interceptors,
    };
}
