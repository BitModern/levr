# @levr-one/cli

The command-line interface for [Levr](https://www.levr.one). Push test results
from any CI pipeline, manage authentication, and select workspaces. The binary
is `levr`.

## Install

```bash
npm install -g @levr-one/cli    # global install for daily use
# or run once, no install:
npx @levr-one/cli --help
```

The package is self-contained — no peer setup required. A global install
replaces the `levr` bin from the deprecated `@levr-one/setup` package.

## Get started

Pushing test results needs authentication and nothing else — log in once
(or set `LEVR_TOKEN` in CI):

```bash
levr auth login              # browser PKCE (or --device-code for SSH/headless)
levr push ./results.xml
```

Using an AI client (Claude Desktop/Code, Cursor, Windsurf, Zed)? Wire the
Levr MCP server into it with one command — no login needed; the client opens
a browser to authorize the first time it connects:

```bash
npx @levr-one/cli mcp add    # detect installed clients and pick interactively
```

Config edits preserve your existing MCP servers and comments, and re-running
is a no-op. Use `--all`, `--client <id>`, or `--yes` for non-interactive
runs and `--dry-run` to preview.

### Shell completion (optional)

Tab-completion is an explicit opt-in step (it is not installed automatically):

```bash
levr install       # add shell completion for the current shell
levr uninstall     # remove it
```

## Authentication

The CLI supports three authentication modes.

### Interactive (browser) — default

```bash
levr auth login
```

Opens a browser for PKCE-based OAuth login.

### Device code (SSH / headless)

```bash
levr auth login --device-code
```

A code is displayed in the terminal. Open the provided URL on any device, enter
the code, and approve.

### Personal Access Token (CI/CD)

Set the `LEVR_TOKEN` environment variable and the CLI uses it automatically —
no interactive login:

```bash
export LEVR_TOKEN=<your-personal-access-token>
levr push ./results.xml
```

### Other auth commands

```bash
levr auth status     # show current authentication state
levr auth logout     # clear stored credentials
```

## Workspaces

```bash
levr workspace list       # list the workspaces you belong to
levr workspace select     # choose the active workspace
levr workspace current    # show the active workspace
```

## Push test results

```bash
levr push <file> [options]
```

The backend auto-detects the file format. In CI, the automation source name and
run metadata are auto-detected. Team ID is optional — when omitted, the server
resolves the team from the automation source (if `--source` matches a known
source) or the workspace's default team.

**Examples:**

```bash
# Basic push (server resolves the default team)
levr push ./test-results.xml

# With an explicit team
levr push ./test-results.xml --team-id <uuid>

# With a custom source name and run name
levr push ./results.xml --source "backend-unit-tests" --run-name "nightly"
```

**Flags:**

| Flag                        | Alias | Description                                                                                |
| --------------------------- | ----- | ------------------------------------------------------------------------------------------ |
| `--team-id <uuid>`          | `-t`  | Team ID (optional; server resolves default if omitted. Or set `LEVR_TEAM_ID`)              |
| `--source <name>`           | `-s`  | Automation source name — groups recurring imports and remembers team (auto-detected in CI) |
| `--run-name <name>`         | `-r`  | Name for the test run                                                                      |
| `--format <type>`           | `-f`  | File format: `junit`, `gherkin`, `cucumber-json` (auto-detected if omitted)                |
| `--parent-folder-id <uuid>` |       | Destination folder ID                                                                      |
| `--create-run`              |       | Force run creation for structure-only imports                                              |
| `--update-mode <mode>`      |       | `update` (default) or `create_new`                                                         |
| `--verbose`                 | `-v`  | Show detailed output                                                                       |

### Automation sources

An automation source groups recurring imports from the same CI pipeline or test
suite. When you pass `--source`, the server creates the source on first use and
remembers which team it belongs to. On the first push, omit `--team-id` to link
the source to the workspace's default team, or pass `--team-id` to link it to a
specific team. Subsequent pushes with the same `--source` route to that team
automatically. Source names are normalized (lowercased, trimmed).

## CI/CD integration

### GitHub Actions

```yaml
- name: Push test results to Levr
  env:
    LEVR_TOKEN: ${{ secrets.LEVR_TOKEN }}
    # LEVR_TEAM_ID is optional — server resolves from automation source or workspace default
  run: npx @levr-one/cli push ./test-results.xml
```

### GitLab CI

```yaml
push-results:
  script:
    - npx @levr-one/cli push ./test-results.xml
  variables:
    LEVR_TOKEN: $LEVR_TOKEN
```

### Jenkins

```groovy
withEnv(["LEVR_TOKEN=${LEVR_TOKEN}"]) {
  sh 'npx @levr-one/cli push ./test-results.xml'
}
```

## Configuration

All configuration is via environment variables. Flags take precedence.

| Variable        | Description                                                                             | Default                |
| --------------- | --------------------------------------------------------------------------------------- | ---------------------- |
| `LEVR_TOKEN`    | Personal Access Token (for CI / headless)                                               |                        |
| `LEVR_URL`      | API base URL (`--url` flag > `LEVR_URL` > URL stored at login > default)                | `https://api.levr.one` |
| `LEVR_AUTH_URL` | Auth server URL for the browser login page (derived from the API URL when unset)        | derived                |
| `LEVR_MCP_URL`  | MCP server URL written by `levr mcp add` (derived from the API URL when unset)          | derived                |
| `LEVR_TEAM_ID`  | Default team ID (optional; server resolves from automation source or workspace default) |                        |
| `LEVR_SOURCE`   | Automation source name override (groups imports, remembers team)                        |                        |

## Troubleshooting

**`Authentication required. Run: levr auth login`** — No valid credentials
found. Run `levr auth login` or set `LEVR_TOKEN`.

**`Token expired`** — Run `levr auth login` to re-authenticate.

**Browser doesn't open during `levr auth login`** — Use
`levr auth login --device-code` for headless environments.

## License

MIT
