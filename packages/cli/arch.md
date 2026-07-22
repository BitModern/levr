# levr-cli Architecture

## Component Diagram

```
┌─────────────────────────────────────────────────────┐
│                    levr-cli                         │
│                                                     │
│  ┌─────────┐  ┌─────────────┐  ┌────────────────┐  │
│  │ Stricli │  │   Commands  │  │   Auth Layer   │  │
│  │  (app)  │→ │ push, auth  │  │ PKCE, device,  │  │
│  │         │  │   handlers  │  │ PAT, refresh   │  │
│  └─────────┘  └──────┬──────┘  └───────┬────────┘  │
│                      │                 │            │
│               ┌──────▼──────┐   ┌──────▼────────┐  │
│               │ @testlm/sdk │   │  raw fetch    │  │
│               │ (data API)  │   │  (OAuth API)  │  │
│               └──────┬──────┘   └──────┬────────┘  │
└──────────────────────┼─────────────────┼────────────┘
                       │                 │
              ┌────────▼────┐    ┌───────▼──────┐
              │  Backender  │    │  Backender   │
              │  /v1/       │    │  /v1/oauth/  │
              │  imports    │    │  token,      │
              │             │    │  device      │
              └─────────────┘    └──────┬───────┘
                                       │
                                ┌──────▼──────┐
                                │  Auth-Web   │
                                │  /oauth/    │
                                │  authorize  │
                                │  /device    │
                                └─────────────┘
```

## Directory Structure

```
src/
├── bin/
│   └── cli.ts              # Entry point: Stricli run + the hidden `__complete` tab-completion route
├── commands/
│   ├── push.ts             # Push command definition (flags, args)
│   ├── pushHandler.ts      # Push command handler
│   ├── pushHandler.test.ts # Push handler tests
│   └── auth/
│       ├── login.ts        # Login command definition
│       ├── loginHandler.ts # Login handler (PKCE + device flow)
│       ├── logout.ts       # Logout command definition
│       ├── logoutHandler.ts
│       ├── status.ts       # Auth status command definition
│       └── statusHandler.ts
├── auth/
│   ├── resolve-token.ts    # Auth resolution: LEVR_TOKEN > stored JWT
│   ├── credentials.ts      # Credential storage (~/.config/levr/)
│   ├── pkce.ts             # PKCE challenge generation
│   ├── localhost-server.ts # Localhost callback server for PKCE
│   ├── device-flow.ts      # Device code polling flow
│   └── token-refresh.ts    # JWT token refresh logic
├── utils/
│   ├── env.ts              # Environment variable helpers (LEVR_URL, LEVR_TOKEN, etc.)
│   ├── sdk-client.ts       # SDK client config + uploadImport wrapper
│   ├── ci-detect.ts        # CI environment detection
│   ├── logger.ts           # Logger (info/success/error/warning/debug)
│   ├── sleep.ts            # Sleep utility
│   └── index.ts            # Re-exports
├── types/
│   ├── auth-types.ts       # ResolvedAuth, StoredCredentials, OAuthTokenResponse, DeviceAuthorizationResponse
│   └── push-types.ts       # PushCommandFlags, CiMetadata
├── app.ts                  # Stricli app config and command tree
├── completion.ts           # Shell tab-completion helper (levr __complete)
└── context.ts              # LocalContext interface and builder
```

## Auth Flow Diagrams

### PKCE Browser Flow (default: `levr auth login`)

```
CLI                         Browser               Auth-Web              Backender
 │                             │                     │                     │
 │  1. Generate PKCE pair      │                     │                     │
 │     (verifier + challenge)  │                     │                     │
 │  2. Generate state nonce    │                     │                     │
 │  3. Start localhost:random  │                     │                     │
 │                             │                     │                     │
 │  4. open(authorize URL)────▶│                     │                     │
 │                             │  GET /oauth/authorize?                    │
 │                             │  client_id=3&       │                     │
 │                             │  redirect_uri=      │                     │
 │                             │  http://127.0.0.1:  │                     │
 │                             │  {port}/callback&   │                     │
 │                             │  code_challenge=... │                     │
 │                             │  state=... ────────▶│                     │
 │                             │                     │  User logs in +     │
 │                             │                     │  grants consent     │
 │                             │                     │                     │
 │                             │  302 redirect ◀─────│                     │
 │                             │  → 127.0.0.1:{port} │                     │
 │                             │  /callback?code=    │                     │
 │  5. Receive callback ◀──────│  &state=...         │                     │
 │     (validate state)        │                     │                     │
 │                             │                     │                     │
 │  6. POST /v1/oauth/token ──────────────────────────────────────────────▶│
 │     grant_type=authorization_code                                       │
 │     code=..., code_verifier=...                                         │
 │                                                                         │
 │  7. { access_token, refresh_token, expires_in } ◀───────────────────────│
 │                                                                         │
 │  8. GET /v1/auth/profile (via SDK) ─────────────────────────────────────▶│
 │     → extract email                                                     │
 │                                                                         │
 │  9. Save credentials to                                                 │
 │     ~/.config/levr/credentials.json (0600)                              │
```

### Device Code Flow (`levr auth login --device-code`)

```
CLI                                Auth-Web              Backender
 │                                    │                     │
 │  1. POST /v1/oauth/device/authorize ────────────────────▶│
 │     client_id=3, scope=read:own write:own                │
 │                                                          │
 │  2. { device_code, user_code, ◀──────────────────────────│
 │       verification_uri,                                  │
 │       expires_in, interval }                             │
 │                                                          │
 │  3. Display to user:                                     │
 │     "Visit: {verification_uri}"                          │
 │     "Enter code: {user_code}"    │                       │
 │                                  │                       │
 │                           User visits URL,               │
 │                           enters code,                   │
 │                           approves ─────────────────────▶│
 │                                                          │
 │  4. Poll: POST /v1/oauth/token ─────────────────────────▶│
 │     grant_type=device_code                               │
 │     device_code=...                                      │
 │                                                          │
 │     ◀── 400 { error: "authorization_pending" } ─────────│
 │     (retry after interval)                               │
 │     ...                                                  │
 │     ◀── 200 { access_token, refresh_token } ────────────│
 │                                                          │
 │  5. Save credentials (same as PKCE step 9)              │
```

### PAT Path (`LEVR_TOKEN` env var)

```
CLI                                 Backender
 │                                     │
 │  resolveToken():                    │
 │    LEVR_TOKEN present → use directly│
 │                                     │
 │  SDK call with Bearer token ───────▶│
 │    (PAT validated by middleware)     │
 │                                     │
```

## Data Flow — `levr push`

```
                    CLI                                           Backender
┌──────────────────────────────────────────┐    ┌─────────────────────────────────────┐
│                                          │    │                                     │
│  1. resolveToken()                       │    │                                     │
│     → PAT or JWT                         │    │                                     │
│                                          │    │                                     │
│  2. Validate file                        │    │                                     │
│     → exists, ≤10MB                      │    │                                     │
│                                          │    │                                     │
│  3. Resolve team ID (optional)            │    │                                     │
│     → --team-id flag > LEVR_TEAM_ID env  │    │                                     │
│     → server fallback: automation source │    │                                     │
│       team > workspace default team      │    │                                     │
│                                          │    │                                     │
│  4. Resolve source name                  │    │                                     │
│     → --source flag > LEVR_SOURCE env    │    │                                     │
│       > CI auto-detect > undefined       │    │                                     │
│                                          │    │                                     │
│  5. Collect CI metadata                  │    │                                     │
│     → getCiMetadata() from env vars      │    │                                     │
│                                          │    │                                     │
│  6. configureClient(auth)                │    │                                     │
│     → sets SDK baseUrl + auth header     │    │                                     │
│                                          │    │                                     │
│  7. uploadImport() via SDK ─────────────────▶│  POST /v1/imports                    │
│     multipart/form-data:                 │    │    (multipart/form-data)             │
│     - file (Blob)                        │    │                                     │
│     - team_id? (optional)                │    │  7b. Resolve team_id:                │
│     - format? (auto-detect if omitted)   │    │      explicit > automation source >  │
│                                          │    │      workspace default               │
│                                          │    │                                     │
│                                          │    │  8. Parse file (JUnit/Gherkin/      │
│     - parent_folder_id?                  │    │     Cucumber JSON)                   │
│     - run_name?                          │    │                                     │
│     - create_run?                        │    │  9. Build import:                    │
│     - update_mode                        │    │     - Create/match folders + tests   │
│     - automation_source?                 │    │     - Create run + run_results       │
│     - import_metadata? (JSON string)     │    │     - Link automation_source         │
│                                          │    │     - Store import_metadata →        │
│                                          │    │       run.source JSONB               │
│                                          │    │                                     │
│  10. Display results ◀──────────────────────│  { status, format, result: {          │
│      - Format detected                   │    │    run_id, stats, warnings } }       │
│      - Tests created/updated             │    │                                     │
│      - Run ID                            │    └─────────────────────────────────────┘
│      - Warnings (if any)                 │
│      - CI label                          │
│      - Verbose: full stats breakdown     │
│                                          │
└──────────────────────────────────────────┘
```

## Token Lifecycle

```
JWT (from PKCE or device flow):
  ├── access_token  — 1 day TTL
  ├── refresh_token — 30 day TTL
  └── Stored at: ~/.config/levr/credentials.json (mode 0600)

Refresh logic (resolve-token.ts → token-refresh.ts):
  1. Read stored credentials
  2. If expires_at - 5min < now → refresh
  3. POST /v1/oauth/token { grant_type: refresh_token }
  4. On success → update credentials file
  5. On failure → delete credentials, throw error

PAT (from LEVR_TOKEN env var):
  ├── No expiry management by CLI (server-side validation)
  └── No local storage needed

Credentials file format:
  {
    version: 1,
    api_url: "https://api.levr.one",
    access_token: "eyJ...",
    refresh_token: "...",
    expires_at: "2026-02-14T...",
    user: { id: "uuid", email: "user@...", workspace_id: "uuid" }
  }
```

## CI Detection

Lightweight detection via environment variables (no runtime dependency). Supports:

| Provider        | Detection env var     | Source name derivation                                           |
| --------------- | --------------------- | ---------------------------------------------------------------- |
| GitHub Actions  | `GITHUB_ACTIONS=true` | `GITHUB_REPOSITORY` + `GITHUB_WORKFLOW`                          |
| GitLab CI       | `GITLAB_CI=true`      | `CI_PROJECT_PATH` + `CI_JOB_NAME`                                |
| CircleCI        | `CIRCLECI=true`       | `CIRCLE_PROJECT_USERNAME/CIRCLE_PROJECT_REPONAME` + `CIRCLE_JOB` |
| Jenkins         | `JENKINS_URL` set     | `JOB_NAME`                                                       |
| Azure Pipelines | `TF_BUILD=True`       | `BUILD_REPOSITORY_URI` + `BUILD_DEFINITIONNAME`                  |
| Generic         | `CI=true` or `CI=1`   | "CI"                                                             |

Source name resolution order: `--source` flag > `LEVR_SOURCE` env > CI auto-detect > undefined.

CI metadata (`CiMetadata`) is sent as `import_metadata` (JSON string) and stored on `run.source` JSONB in the database.

## Security Model

- **PKCE** — SHA-256 code challenge (86-char verifier from 64 random bytes); prevents authorization code interception
- **State parameter** — random 32-hex nonce validated on callback; prevents CSRF
- **Localhost binding** — callback server binds to `127.0.0.1` only (not `0.0.0.0`)
- **File permissions** — credentials stored with `0600` (owner read/write only)
- **No secrets in binary** — OAuth client is public (client_id=3, no client_secret); all secrets are server-side
- **Refresh token handling** — on refresh failure, credentials are deleted (forces re-login)
