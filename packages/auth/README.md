# @levr-one/auth

Shared OAuth 2.1 client with self-healing token management, used by the Levr
CLIs and tooling. Provides a browser (PKCE) and device authorization flow, an
on-disk token/config store under `~/.tq/`, and a `listWorkspaces()` helper.

## Install

```bash
npm install @levr-one/auth
```

## Usage

```ts
import { OAuthClient, listWorkspaces } from '@levr-one/auth';

// Authenticate (opens a browser by default; use authorizeDevice() for headless).
const client = new OAuthClient({
  clientId: 'my-client',
  authServerUrl: 'https://api.levr.now',
});
await client.authorize();

// List the workspaces the signed-in user belongs to.
const workspaces = await listWorkspaces();
for (const w of workspaces) {
  console.log(w.workspace_name, w.role, w.is_primary ? '(primary)' : '');
}
```

`listWorkspaces()` throws a typed `WorkspaceFetchError` (never terminates the
process) on auth or HTTP errors — catch it and handle as your app sees fit.

## License

MIT
