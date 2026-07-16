import { buildApplication, buildCommand, buildRouteMap } from '@stricli/core';
import {
  buildInstallCommand,
  buildUninstallCommand,
} from '@stricli/auto-complete';
import {
  OAuthClient,
  PRESETS,
  resolveFromApiUrl,
  writeConfig,
  listWorkspaces,
  WorkspaceFetchError,
  type TqConfig,
  type WorkspaceSite,
} from '@levr-one/auth';
import { version } from '../package.json';
import type { LocalContext } from './context';

export type SetupEnv = 'local' | 'staging' | 'production';

export interface SetupFlags {
  readonly env: SetupEnv;
  readonly device: boolean;
}

/**
 * Injectable ports so the setup flow is exercisable without a real browser or
 * OAuth server (R2F9). The default route wires `realSetupPorts`; tests inject
 * fakes.
 */
export interface SetupPorts {
  resolveConfig(env: SetupEnv): TqConfig;
  writeConfig(config: TqConfig): void;
  authenticate(config: TqConfig, useDevice: boolean): Promise<void>;
  listWorkspaces(): Promise<WorkspaceSite[]>;
}

export interface SetupIO {
  out(line: string): void;
  err(line: string): void;
}

/**
 * Resolve the target config from the `--env` preset, honoring a
 * `LEVR_BACKEND_URL` / `TQ_BACKEND_URL` URL override and a `TQ_OAUTH_CLIENT_ID`
 * override (mirrors the persisted-config behavior of the internal `tq-oauth env`
 * command so the collapsed single-command flow behaves identically).
 */
function resolveConfigFromEnv(env: SetupEnv): TqConfig {
  const override =
    process.env['LEVR_BACKEND_URL'] ?? process.env['TQ_BACKEND_URL'];
  const config: TqConfig = override
    ? resolveFromApiUrl(override)
    : { ...PRESETS[env] };
  const clientOverride = process.env['TQ_OAUTH_CLIENT_ID'];
  if (clientOverride) {
    config.oauthClientId = clientOverride;
  }
  return config;
}

/** Real ports wired to `@levr-one/auth`'s library surface. */
export const realSetupPorts: SetupPorts = {
  resolveConfig: resolveConfigFromEnv,
  writeConfig: (config) => {
    writeConfig(config);
  },
  authenticate: async (config, useDevice) => {
    const client = new OAuthClient({
      clientId: config.oauthClientId,
      authServerUrl: config.apiUrl,
    });
    if (useDevice) {
      await client.authorizeDevice();
    } else {
      await client.authorize();
    }
  },
  listWorkspaces: () => listWorkspaces(),
};

function printWorkspaces(sites: WorkspaceSite[], io: SetupIO): void {
  if (sites.length === 0) {
    io.err('No workspaces found for this account.');
    return;
  }
  io.out('Your workspaces:');
  for (const site of sites) {
    const primary = site.is_primary ? ' (primary)' : '';
    io.out(`  • ${site.workspace_name} — ${site.role}${primary}`);
  }
}

/** True for the "no usable token yet" errors that a fresh sign-in resolves. */
function needsAuthentication(err: unknown): boolean {
  return (
    err instanceof WorkspaceFetchError &&
    (err.code === 'not_authenticated' || err.code === 'token_refresh_failed')
  );
}

/**
 * The setup flow: persist env → list workspaces (reusing a stored token) →
 * print. Only if no usable token exists do we open a browser to authenticate,
 * then list again — so re-running `levr setup` with a valid session does not
 * re-prompt the browser.
 *
 * R2F2: the resolved `--env` preset MUST be durably persisted via
 * `writeConfig()` BEFORE any list/auth, because `listWorkspaces()` independently
 * re-reads `~/.tq/config.json` from disk — holding the preset only in memory
 * would let `--env local` read a different persisted environment.
 */
export async function performSetup(
  ports: SetupPorts,
  flags: SetupFlags,
  io: SetupIO,
): Promise<void> {
  const config = ports.resolveConfig(flags.env);
  ports.writeConfig(config); // durable, before any read-back (R2F2)

  try {
    printWorkspaces(await ports.listWorkspaces(), io);
    return;
  } catch (err) {
    if (!needsAuthentication(err)) throw err;
  }

  // No usable token — sign in, then list.
  io.err(`Authenticating with ${config.environment} (${config.apiUrl})…`);
  await ports.authenticate(config, flags.device);
  printWorkspaces(await ports.listWorkspaces(), io);
}

const setupCommand = buildCommand({
  docs: {
    brief: 'Authenticate with Levr and list your workspaces',
    fullDescription:
      'Signs in to Levr (browser PKCE by default, --device for headless) and ' +
      'prints the workspaces you belong to, with your role and the primary ' +
      'workspace marked.',
  },
  parameters: {
    flags: {
      env: {
        kind: 'enum',
        values: ['local', 'staging', 'production'] as const,
        default: 'staging',
        brief: 'Backend environment (overridable via LEVR_BACKEND_URL)',
      },
      device: {
        kind: 'boolean',
        default: false,
        brief: 'Use the device authorization flow (headless / remote)',
      },
    },
    aliases: { e: 'env', d: 'device' },
  },
  async func(this: LocalContext, flags: SetupFlags): Promise<void> {
    const proc = this.process;
    await performSetup(this.ports, flags, {
      out: (line) => proc.stdout.write(`${line}\n`),
      err: (line) => proc.stderr.write(`${line}\n`),
    });
  },
});

const routes = buildRouteMap({
  routes: {
    setup: setupCommand,
    install: buildInstallCommand('levr', { bash: '__levr_bash_complete' }),
    uninstall: buildUninstallCommand('levr', { bash: true }),
  },
  defaultCommand: 'setup',
  docs: {
    brief: 'Levr setup CLI',
    hideRoute: {
      install: true,
      uninstall: true,
    },
  },
});

export const app = buildApplication(routes, {
  name: 'levr',
  versionInfo: {
    currentVersion: version,
  },
});
