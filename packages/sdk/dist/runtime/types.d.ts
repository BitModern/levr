export type AuthScheme = {
    scheme: string;
    type: string;
};
export interface ClientConfig {
    baseUrl?: string | (() => string);
    auth?: ((scheme: AuthScheme) => Promise<string> | string) | string;
    headers?: Record<string, string>;
    workspaceId?: string;
    fetch?: typeof globalThis.fetch;
}
export interface RequestOptions {
    url: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path?: Record<string, unknown>;
    query?: Record<string, unknown>;
    body?: unknown;
    headers?: Record<string, string>;
    security?: ReadonlyArray<AuthScheme>;
    requestValidator?: (data: unknown) => Promise<unknown>;
    responseTransformer?: (data: unknown) => Promise<unknown>;
    throwOnError?: boolean;
    client?: Client;
    bodySerializer?: (body: unknown) => string | FormData | undefined;
    parseAs?: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream' | 'auto';
    responseStyle?: 'data' | 'fields';
}
type UnwrapResponse<T> = T extends Record<string, unknown> ? keyof T extends never ? T : T[keyof T] : T;
export type RequestResult<TData = unknown, TError = unknown, ThrowOnError extends boolean = boolean> = ThrowOnError extends true ? Promise<{
    ok: true;
    data: UnwrapResponse<TData>;
    request: Request;
    response: Response;
}> : Promise<{
    ok: true;
    data: UnwrapResponse<TData>;
    error: undefined;
    request: Request;
    response: Response;
} | {
    ok: false;
    data: undefined;
    error: TError;
    request: Request;
    response: Response;
}>;
type InterceptorFn<T extends unknown[]> = (...args: T) => Promise<T[0]> | T[0];
export interface InterceptorManager<T extends unknown[]> {
    use(fn: InterceptorFn<T>): void;
    eject(fn: InterceptorFn<T>): void;
    _fns: Array<InterceptorFn<T> | undefined>;
}
type MethodFn = <TData = unknown, TError = unknown, ThrowOnError extends boolean = false>(options: Omit<RequestOptions, 'method'>) => RequestResult<TData, TError, ThrowOnError>;
export interface Client {
    getConfig(): ClientConfig;
    setConfig(config: ClientConfig): ClientConfig;
    request: <TData = unknown, TError = unknown, ThrowOnError extends boolean = false>(options: RequestOptions) => RequestResult<TData, TError, ThrowOnError>;
    get: MethodFn;
    post: MethodFn;
    put: MethodFn;
    patch: MethodFn;
    delete: MethodFn;
    interceptors: {
        request: InterceptorManager<[Request, RequestOptions]>;
        response: InterceptorManager<[Response, Request, RequestOptions]>;
        error: InterceptorManager<[unknown, Response, Request, RequestOptions]>;
    };
}
export interface TDataShape {
    body?: unknown;
    headers?: unknown;
    path?: unknown;
    query?: unknown;
    url: string;
}
type OmitKeys<T, K> = Pick<T, Exclude<keyof T, K>>;
export type Options<TData extends TDataShape = TDataShape, ThrowOnError extends boolean = boolean> = OmitKeys<RequestOptions, 'body' | 'path' | 'query' | 'url' | 'method'> & Omit<TData, 'url'> & {
    throwOnError?: ThrowOnError;
    client?: Client;
};
export type Config = ClientConfig;
export type CreateClientConfig<T = ClientConfig> = (override?: Partial<T>) => T;
export {};
