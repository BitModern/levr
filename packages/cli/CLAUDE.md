# levr-cli

The command-line interface for Levr. Designed for both local development and CI/CD pipelines.

See [arch.md](arch.md) for architecture, component diagrams, auth flows, and data flow details.

## Conventions

- **SDK for data, raw fetch for auth** — data API calls (import, etc.) go through `@testlm/sdk`; auth requests (OAuth token exchange, device flow, token refresh) use raw `fetch` against the auth server since the SDK doesn't cover OAuth endpoints
- **Stricli context pattern** — handlers receive `this: LocalContext` for testability (process, logger are injectable)
- **Bundled SDK** — `@testlm/sdk` + `@testlm/ci-env` are bundled into `dist/` at build time via tsdown `noExternal` (D4/ENG-2363), so the published `@levr-one/cli` is self-contained (no `@testlm/*` runtime deps, no shipped `.d.ts`). They still must be built first (the bundler consumes their `dist/`). `@stricli/*`, `chalk`, `open`, `ora`, `zod` stay external runtime deps.
- **Colocated tests** — all test files live next to their source (e.g., `pushHandler.test.ts`, `resolve-token.test.ts`)
- **Context injection for tests** — test handlers by binding a mock `LocalContext` via `.call(mockContext, ...)`

## Environment Variables

| Variable        | Description                                                                             | Default                 |
| --------------- | --------------------------------------------------------------------------------------- | ----------------------- |
| `LEVR_TOKEN`    | Personal Access Token (for CI/headless)                                                 |                         |
| `LEVR_URL`      | API base URL                                                                            | `https://api.levr.one`  |
| `LEVR_AUTH_URL` | Auth server URL                                                                         | `https://auth.levr.one` |
| `LEVR_TEAM_ID`  | Default team ID (optional; server resolves from automation source or workspace default) |                         |
| `LEVR_SOURCE`   | Default automation source name                                                          |                         |

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
