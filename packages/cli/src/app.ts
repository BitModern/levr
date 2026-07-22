import { buildApplication, buildRouteMap, text_en } from '@stricli/core';
import {
  buildInstallCommand,
  buildUninstallCommand,
} from '@stricli/auto-complete';
import { loginCommand } from './commands/auth/login.js';
import { logoutCommand } from './commands/auth/logout.js';
import { statusCommand } from './commands/auth/status.js';
import { pushCommand } from './commands/push.js';
import { listCommand } from './commands/workspace/list.js';
import { selectCommand } from './commands/workspace/select.js';
import { currentCommand } from './commands/workspace/current.js';
import { version } from '../package.json' with { type: 'json' };

const authRoutes = buildRouteMap({
  routes: {
    login: loginCommand,
    logout: logoutCommand,
    status: statusCommand,
  },
  docs: {
    brief: 'Manage authentication',
  },
});

const workspaceRoutes = buildRouteMap({
  routes: {
    list: listCommand,
    select: selectCommand,
    current: currentCommand,
  },
  docs: {
    brief: 'Manage workspace selection',
  },
});

const routes = buildRouteMap({
  routes: {
    auth: authRoutes,
    workspace: workspaceRoutes,
    push: pushCommand,
    install: buildInstallCommand('levr', {
      // Route completion through the single `levr` bin's hidden `__complete`
      // handler (see src/bin/cli.ts) rather than a separate completion binary,
      // so the published package has one bin and `npx @levr-one/cli …` resolves.
      bash: 'levr __complete',
    }),
    uninstall: buildUninstallCommand('levr', { bash: true }),
  },
  docs: {
    brief: 'The command-line interface for Levr',
    hideRoute: {
      install: true,
      uninstall: true,
    },
  },
});

export const app = buildApplication(routes, {
  name: 'levr',
  versionInfo: {
    // Single source of truth: read the version from package.json (inlined at
    // build time) instead of duplicating the literal here.
    currentVersion: version,
  },
  localization: {
    loadText: () => ({
      ...text_en,
      exceptionWhileParsingArguments: (exc, ansiColor) => {
        const base = text_en.exceptionWhileParsingArguments(exc, ansiColor);
        const hint = 'Run `levr <command> --help` for usage information.';
        return ansiColor
          ? `${base}\n\x1b[2m${hint}\x1b[22m`
          : `${base}\n${hint}`;
      },
    }),
  },
});
