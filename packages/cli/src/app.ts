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
      bash: '__levr_bash_complete',
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
    currentVersion: '0.1.0',
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
