# levr-cli

The command-line interface for Levr. Designed for both local development and CI/CD pipelines.

See [arch.md](arch.md) for architecture, component diagrams, auth flows, and data flow details.

## Conventions

- **SDK for data, raw fetch for auth** — data API calls (import, etc.) go through `@levr/sdk`; auth requests (OAuth token exchange, device flow, token refresh) use raw `fetch` against the auth server since the SDK doesn't cover OAuth endpoints
- **Stricli context pattern** — handlers receive `this: LocalContext` for testability (process, logger are injectable)
- **Bundled @levr/\*** — `@levr/sdk`, `@levr/ci-env`, and `@levr/mcp-harnesses` are bundled into `dist/` at build time via tsdown `noExternal: [/^@testlm\//]` (D4/internal, internal — a REGEX, because mcp-harnesses is imported via its `/node` subpath which an exact-name match misses), so the published `@levr-one/cli` is self-contained (no `@levr/*` runtime deps, no shipped `.d.ts`). They still must be built first (the bundler consumes their `dist/`). `@stricli/*`, `@clack/prompts`, `chalk`, `jsonc-parser`, `open`, `ora`, `zod` stay external runtime deps (deps of bundled packages MUST be declared here or rolldown half-inlines them — jsonc-parser's CJS internals broke at runtime when undeclared).
- **Colocated tests** — all test files live next to their source (e.g., `pushHandler.test.ts`, `resolve-token.test.ts`)
- **Context injection for tests** — test handlers by binding a mock `LocalContext` via `.call(mockContext, ...)`

## `mcp add` flags

| Flag              | Meaning                                                        |
| ----------------- | -------------------------------------------------------------- |
| `--client <id,…>` | install into these harness ids (repeatable or comma-separated) |
| `--all`           | install into every detected, installable client                |
| `--yes`, `-y`     | non-interactive; auto-select detected clients                  |
| `--dry-run`       | show the changes without writing                               |
| `--scope <s>`     | `user` (default) · `project` · `local` (internal)              |
| `--url <url>`     | explicit MCP URL (overrides `LEVR_MCP_URL` / derivation)       |

**`add.ts` must keep taking `HarnessScope` via the `import type` FORM.** Under
`verbatimModuleSyntax` an inline `import { type X }` still emits the import, so
`import { type HarnessScope }` would pull the harness catalog into the chunk
`app.ts` loads eagerly — costing `levr push` in CI the lazy-load property the
whole command layout exists to preserve. Only `import type { … }` is erased.

The unsupported-scope policy lives in `installSelected` (`src/mcp/run.ts`) and
keys on `namedIds`: a client the user typed with `--client` FAILS when it cannot
honor the requested scope, while one swept in by `--all` or a multiselect falls
back to `defaultScope(harness)` and records `fallbackFrom` so the report can say
so. Never make a fallback silent.

## Environment Variables

| Variable        | Description                                                                                                                                                                                                                                              | Default                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `LEVR_TOKEN`    | Personal Access Token (for CI/headless)                                                                                                                                                                                                                  |                        |
| `LEVR_URL`      | API base URL. Resolution: `--url` flag > `LEVR_URL` > `api_url` stored at login > default (internal)                                                                                                                                                     | `https://api.levr.one` |
| `LEVR_AUTH_URL` | Auth server URL (browser PKCE consent page only). Derived from the API URL for known hosts (`api.levr.one`/`api.levr.now`) when unset; unrecognized hosts (localhost stacks) require it explicitly                                                       | derived                |
| `LEVR_MCP_URL`  | MCP server URL written by `levr mcp add` (internal). Derived from the API URL when unset: known hosts map to the app-host OAuth resource (`ai.levr.<env>/api/v1/mcp` — NOT the bare api host, RFC 9728 resource-identity), others get `<api-url>/v1/mcp` | derived                |
| `LEVR_TEAM_ID`  | Default team ID (optional; server resolves from automation source or workspace default)                                                                                                                                                                  |                        |
| `LEVR_SOURCE`   | Default automation source name                                                                                                                                                                                                                           |                        |
| `LEVR_ENV_FILE` | Path to a `.env` to read instead of `./.env` (absolute, or relative to cwd). Unlike the implicit `.env`, a path named here that does not exist is an ERROR, not a silent skip | `.env` |

### `.env` loading

The CLI reads a `.env` from the working directory at startup
(`src/utils/load-env-file.ts`, called first in `src/bin/cli.ts` — every
`process.env` read in this package is inside a function, so a body statement
there beats all of them).

Two rules, both load-bearing and both mutation-tested:

- **Only `LEVR_`-prefixed keys are applied.** This parses with `dotenv.parse`
  rather than calling `dotenv.config()`, which would merge EVERY key into
  `process.env`. A checkout's `.env` routinely carries variables that change how
  Node itself behaves — `NODE_TLS_REJECT_UNAUTHORIZED`, `HTTP_PROXY`,
  `NODE_OPTIONS` — and none of those are ours to apply just because someone ran
  the CLI in that directory. The `LEVR_` namespace is what makes an unrelated
  project's `.env` inert here.
- **A real environment variable always wins.** An already-set key is left alone,
  so `LEVR_URL=… levr push` still overrides the file and CI variables are never
  shadowed by a checked-in `.env`. The file is a default, not an override.

A missing `.env` is normal and silent. A missing `LEVR_ENV_FILE` throws — naming
a file and getting silence hides a typo'd path, which is the one case where
quiet failure costs more than it saves.

**Worktree tip.** The CLI does NOT read `~/.tq/config.json` — that file belongs
to the `yarn tq:*` dev tooling and the stdio MCP servers (`@levr-one/auth`), a
separate config system with a different default. `dist/cli.js` defaults to
PRODUCTION (`https://api.levr.one`), so a dev running it from a worktree without
`LEVR_URL` set is talking to prod. Point it at the worktree with a `.env`:

```
LEVR_URL=http://localhost:8280       # apps/backender/.env API_BASE_URL
LEVR_AUTH_URL=http://localhost:3221  # apps/backender/.env AUTH_URL
```

Ports are assigned per worktree — read them from that worktree's
`apps/backender/.env` rather than copying the numbers above.

## ESLint Rules

Uses `typescript-eslint` with `recommendedTypeChecked` plus Prettier:

- `@typescript-eslint/no-floating-promises: warn`
- `@typescript-eslint/no-unsafe-argument: warn`
- `@typescript-eslint/no-unused-vars: error` (with `_` prefix ignored)

## Development

```bash
# Build (requires SDK to be built first — it is bundled in)
cd packages/sdk && yarn build
cd packages/cli && yarn build

# Watch mode
yarn dev

# Run tests
yarn test

# Lint
yarn lint

# Format
yarn format

# Type check
yarn typecheck
```

## Known Issues

- **Zod file validation bypass** — The generated Zod schema defines `file` as `z.string()` instead of `z.instanceof(Blob)`, so the request validator is bypassed for the import endpoint. Tracked as a code-gen follow-up.

## Related Documentation

- [arch.md](arch.md) — architecture, component diagrams, auth flows, data flow
- [README.md](README.md) — user-facing documentation with usage examples and CI snippets
- [CLI Plan (Plan 3)](../../specs/plans/tq-cli/tq-cli-plan3-cli-tool.md) — implementation plan
- [CLI Overview](../../specs/plans/tq-cli/tq-cli-overview.md) — high-level project overview
