# @levr-one/cli

The command-line interface for [Levr](https://www.levr.one). The binary is
`levr`, and it does three jobs:

- **Connect your AI tools** — `levr mcp add` wires the Levr MCP server into
  the AI clients on your machine (Claude Desktop, Claude Code, Cursor,
  Windsurf, Zed) with one command.
- **Push test results** — `levr push` uploads results from any terminal or CI
  pipeline.
- **Import test cases** — `levr import` brings existing cases in from CSV,
  Excel, JSON, or Google Sheets.

## Install

```bash
npm install -g @levr-one/cli    # gives you a persistent `levr` command
```

The package is self-contained — no peer setup required. A global install
replaces the `levr` bin from the deprecated `@levr-one/setup` package.

### Or run it without a global install

```bash
npx @levr-one/cli --help
```

`npx` is right for one-shot use (`mcp add`, trying a command). Two things to
expect:

- **`levr` will not be on your PATH afterwards.** npx puts the command on PATH
  only for the duration of that one invocation. Shell completion also assumes a
  global install, since the generated script wires up the `levr` command.
- **It does download the package** — roughly 8 MB into npm's `~/.npm/_npx`
  cache, kept indefinitely. The first run asks `Ok to proceed?`; later runs are
  silent until a new version is published.

In scripts and CI, pass `--yes` — **in a terminal the prompt blocks until it is
answered**, so an unattended run with a TTY hangs rather than failing:

```bash
npx --yes @levr-one/cli push ./test-results.xml
```

Two things to get right:

- **Always `npx @levr-one/cli`, never `npx levr`.** npx treats the first
  positional as a _package_ name, so `npx levr` would fetch and run whatever
  package is published under the unscoped name `levr` — which is not ours.
- **npm's flags go before the package name.** `npx @levr-one/cli --yes` passes
  `--yes` to `levr`, not to npm.

For reproducible CI, pin `@levr-one/cli` to a version you have validated.

## Quick start

**Using an AI client?** Wire the Levr MCP server into it — no login needed;
the client opens a browser to authorize the first time it connects:

```bash
npx @levr-one/cli mcp add
```

**Pushing test results?** Authentication is all you need — log in once (or
set `LEVR_TOKEN` in CI):

```bash
levr auth login              # browser PKCE (or --device-code for SSH/headless)
levr push ./results.xml
```

## Connect AI clients: `levr mcp add`

Detects the MCP-capable clients installed on your machine, lets you pick
which to set up, and writes the Levr MCP server into each one's config:

```bash
levr mcp add                 # detect clients and pick interactively
levr mcp add --all           # set up every detected client
levr mcp add --dry-run       # preview the changes without writing
levr mcp add --client cursor,zed --yes   # non-interactive selection
```

What it writes is **credential-free** — a `levr` server entry that connects
via `mcp-remote`. No token or secret is stored; your client opens the browser
to authorize with Levr on its first connection. After a run, restart the
client(s) and authorize once.

**Supported clients:**

| Client         | How it's configured                                                            |
| -------------- | ------------------------------------------------------------------------------ |
| Claude Desktop | config file (`claude_desktop_config.json`)                                     |
| Claude Code    | prints the `claude mcp add --transport http levr <url>` command for you to run |
| Cursor         | config file (`~/.cursor/mcp.json`)                                             |
| Windsurf       | config file (`~/.codeium/windsurf/mcp_config.json`)                            |
| Zed            | config file (`settings.json`, `context_servers`)                               |
| VS Code, Codex | listed but not yet installable (coming soon)                                   |

Config edits are **safe and repeatable**: existing MCP servers and comments
in your config files are preserved (jsonc-aware merge), and re-running is a
no-op that reports "already set up".

**Flags:**

| Flag              | Alias | Description                                           |
| ----------------- | ----- | ----------------------------------------------------- |
| `--client <id,…>` |       | Set up these client ids (comma-separated or repeated) |
| `--all`           |       | Set up every detected, installable client             |
| `--yes`           | `-y`  | Non-interactive; auto-select detected clients         |
| `--dry-run`       |       | Show the changes without writing                      |
| `--url <url>`     |       | MCP server URL (default derived from the API server)  |

Runs non-interactively whenever `--all`, `--client`, or `--yes` is passed —
or automatically when not attached to a terminal (CI). Unknown client ids and
failed writes exit non-zero.

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
| `--format <type>`           | `-f`  | File format: `junit`, `gherkin`, `cucumber-json`, `ctrf-json` (auto-detected if omitted)   |
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

## Import test cases

```bash
levr import <file> --team-id <uuid> [options]
```

Brings existing test cases into Levr from CSV, Excel (`.xlsx`), JSON, or a
public Google Sheet. It runs in two phases: **preview** proposes a mapping from
your columns onto the Levr test-case schema (exact and fuzzy matching, with an
LLM assist for whatever is left over), you review and adjust it, then **commit**
writes the folders, tests, steps, and preconditions.

In a terminal, unmapped and low-confidence columns are walked with a picker. For
scripts and CI, pass `--yes` — and `--map` or `--mapping-file` to pin the
mapping so a replay can't drift.

**One column must map to `test_name`.** Interactive runs ask for it;
non-interactive runs exit 1 rather than import unnamed cases.

**Examples:**

```bash
# Interactive import from a CSV export
levr import ./testrail-export.csv --team-id <uuid>

# Excel, with one column pinned up front
levr import ./cases.xlsx --team-id <uuid> --map "Title=test_name"

# A public Google Sheet, no prompts
levr import --sheets-url "https://docs.google.com/spreadsheets/d/..." --team-id <uuid> --yes

# Save the confirmed mapping once, then replay it in CI
levr import ./cases.csv --team-id <uuid> --save-mapping mapping.json
levr import ./cases.csv --team-id <uuid> --mapping-file mapping.json --yes
```

**Flags:**

| Flag                    | Alias | Description                                                                       |
| ----------------------- | ----- | --------------------------------------------------------------------------------- |
| `--team-id <uuid>`      | `-t`  | Team the imported test cases belong to (required)                                 |
| `--workspace-id <uuid>` | `-w`  | Workspace ID (required for multi-workspace JWT auth)                              |
| `--sheets-url <url>`    |       | Public Google Sheets URL, used instead of a file argument                         |
| `--format <type>`       | `-f`  | Source format: `csv`, `xlsx`, `json` (auto-detected from the filename if omitted) |
| `--map <pair>`          | `-m`  | Column override, repeatable — three forms, below                                  |
| `--mapping-file <path>` |       | JSON file holding a saved confirmed mapping (from `--save-mapping`)               |
| `--save-mapping <path>` |       | Write the confirmed mapping to this JSON file for CI replay                       |
| `--yes`                 | `-y`  | Accept the mapping without prompts (required for non-TTY runs)                    |
| `--verbose`             | `-v`  | Show detailed output                                                              |

`--map` accepts three forms:

| Form                            | Effect                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `"Source Column=target_field"`  | Map the column onto that Levr field                                            |
| `"Source Column="`              | Drop the column (empty target)                                                 |
| `"Source Column=labels:prefix"` | Import each value as the label `prefix:value`, keeping the column's provenance |

```bash
# Keep a TestRail "State" column as state:Draft / state:Approved labels
levr import ./cases.csv --team-id <uuid> --map "State=labels:state"
```

## CI/CD integration

### GitHub Actions

```yaml
- name: Push test results to Levr
  env:
    LEVR_TOKEN: ${{ secrets.LEVR_TOKEN }}
    # LEVR_TEAM_ID is optional — server resolves from automation source or workspace default
  run: npx --yes @levr-one/cli push ./test-results.xml
```

### GitLab CI

```yaml
push-results:
  script:
    - npx --yes @levr-one/cli push ./test-results.xml
  variables:
    LEVR_TOKEN: $LEVR_TOKEN
```

### Jenkins

```groovy
withEnv(["LEVR_TOKEN=${LEVR_TOKEN}"]) {
  sh 'npx --yes @levr-one/cli push ./test-results.xml'
}
```

## Authentication

Needed for `push` and `workspace` commands (`mcp add` needs none). Three modes:

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

## Shell completion (optional)

Completion needs a global install: the generated script wires up the `levr`
command, so it does nothing if `levr` is not on your PATH (which it is not when
you run via `npx`).

`levr completion` prints a completion script to **stdout**. It never edits your
shell config — you choose where the script goes:

```bash
# This session only
eval "$(levr completion bash)"
eval "$(levr completion zsh)"

# Persist it
levr completion bash >> ~/.bashrc
levr completion zsh  >> ~/.zshrc

# Or system-wide (bash)
levr completion bash > /etc/bash_completion.d/levr
```

**zsh:** load it _after_ `compinit`, which is what defines `compdef`:

```zsh
autoload -Uz compinit && compinit
eval "$(levr completion zsh)"
```

If `compinit` has not run, the script says so on stderr instead of failing with
a bare `command not found: compdef`.

Supported shells: **bash** and **zsh**. The shell is detected from `$SHELL` when
you omit the argument — pass it explicitly in scripts, or to generate a script
for a shell other than the one you are running. An unsupported or undetectable
shell writes an error to stderr and exits non-zero.

Nothing is installed automatically: the package ships no `postinstall` hook.

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

**The `levr` server doesn't appear in my AI client after `mcp add`** — Restart
the client; MCP servers are read at startup. Verify the entry with
`levr mcp add --dry-run` (it reports "already set up" when the config is in
place).

**My client asks me to authorize Levr** — Expected on the first connection:
the config is credential-free, so each client authorizes once in the browser.

**`Authentication required. Run: levr auth login`** — No valid credentials
found. Run `levr auth login` or set `LEVR_TOKEN`.

**`Token expired`** — Run `levr auth login` to re-authenticate.

**Browser doesn't open during `levr auth login`** — Use
`levr auth login --device-code` for headless environments.

## License

MIT
