/**
 * URL joining that preserves a path prefix on the API base URL.
 *
 * `new URL('/v1/oauth/token', base)` looks correct but silently discards any
 * path on `base`: a leading `/` makes the second argument an *absolute-path
 * reference*, which per RFC 3986 §5.3 replaces the base's entire path. So
 *
 *   new URL('/v1/oauth/token', 'https://ai.levr.test:3020/api')
 *     -> 'https://ai.levr.test:3020/v1/oauth/token'   // `/api` is gone
 *
 * That is latent for a bare origin (`https://api.levr.test:8080`), where the
 * dropped path is empty — which is why it went unnoticed. It breaks the moment
 * the base carries a prefix, as it does in DEV_TLS local dev: `tq:env local`
 * resolves `apiUrl` from `apps/backender/.env`'s `API_BASE_URL`, which points
 * at the SPA origin plus the Vite `/api` proxy so cookies stay same-origin.
 * The request then lands on the SPA instead of the API, and because the SPA
 * serves its HTML fallback for unknown paths (200, not 404) the client-side
 * router rewrites it under the active workspace — surfacing as a baffling
 * `/w/<slug>/v1/oauth/authorize` "path does not exist".
 *
 * Joining relatively against a trailing-slash base keeps the prefix and is a
 * no-op for bases that have none.
 */
export function joinApiPath(baseUrl: string, apiPath: string): URL {
  // A base without a trailing slash would have its last segment treated as a
  // file and replaced by the relative reference.
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  // Strip leading slashes so the reference stays relative — a single leading
  // `/` is the whole bug this helper exists to prevent.
  const relative = apiPath.replace(/^\/+/, '');
  return new URL(relative, base);
}
