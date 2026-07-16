# @levr-one/setup

The Levr setup CLI. Authenticate with Levr and list the workspaces you belong to.

## Usage

```bash
npx @levr-one/setup            # or: levr, levr setup
```

This signs you in (browser PKCE by default) and prints your workspaces with your
role, marking the primary one.

### Options

| Flag                                 | Alias | Description                                                                   |
| ------------------------------------ | ----- | ----------------------------------------------------------------------------- |
| `--env <local\|staging\|production>` | `-e`  | Backend environment (default: `staging`). Overridable via `LEVR_BACKEND_URL`. |
| `--device`                           | `-d`  | Use the device authorization flow (headless / remote).                        |

Authentication and workspace listing are provided by
[`@levr-one/auth`](https://www.npmjs.com/package/@levr-one/auth).

## License

MIT
