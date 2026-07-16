import { describe, it, expect, vi } from 'vitest';
import { run } from '@stricli/core';
import { app, performSetup, realSetupPorts } from './app';
import type { SetupPorts } from './app';
import { buildContext } from './context';
import { WorkspaceFetchError } from '@levr-one/auth';
import type { TqConfig, WorkspaceSite } from '@levr-one/auth';

const CONFIG: TqConfig = {
  environment: 'staging',
  apiUrl: 'https://api.example.test',
  authUrl: 'https://auth.example.test',
  clientUrl: 'https://app.example.test',
  oauthClientId: 'test-client',
};

const SITES: WorkspaceSite[] = [
  {
    workspace_id: 'w1',
    workspace_name: 'Acme',
    workspace_url_key: 'acme',
    user_id: 'u1',
    role: 'owner',
    is_primary: true,
    last_accessed_at: null,
  },
  {
    workspace_id: 'w2',
    workspace_name: 'Beta',
    workspace_url_key: 'beta',
    user_id: 'u1',
    role: 'member',
    is_primary: false,
    last_accessed_at: null,
  },
];

function makeFakePorts(overrides: Partial<SetupPorts> = {}): {
  ports: SetupPorts;
  calls: string[];
} {
  const calls: string[] = [];
  const ports: SetupPorts = {
    resolveConfig: (env) => {
      calls.push(`resolveConfig:${env}`);
      return { ...CONFIG, environment: env };
    },
    writeConfig: () => {
      calls.push('writeConfig');
    },
    authenticate: (_config, useDevice) => {
      calls.push(`authenticate:${useDevice}`);
      return Promise.resolve();
    },
    listWorkspaces: () => {
      calls.push('listWorkspaces');
      return Promise.resolve(SITES);
    },
    ...overrides,
  };
  return { ports, calls };
}

/** A listWorkspaces that rejects with a "no token yet" error once, then succeeds. */
function listNeedsAuthThenSucceeds(
  calls: string[],
): () => Promise<WorkspaceSite[]> {
  let n = 0;
  return () => {
    n += 1;
    calls.push(`listWorkspaces:${n}`);
    if (n === 1) {
      return Promise.reject(
        new WorkspaceFetchError('not_authenticated', 'Not logged in.'),
      );
    }
    return Promise.resolve(SITES);
  };
}

function makeFakeProcess(): {
  process: NodeJS.Process;
  stdout: () => string;
  stderr: () => string;
} {
  const out: string[] = [];
  const err: string[] = [];
  const process = {
    stdout: {
      write: (s: string) => {
        out.push(s);
        return true;
      },
    },
    stderr: {
      write: (s: string) => {
        err.push(s);
        return true;
      },
    },
    env: {},
    exitCode: undefined,
  } as unknown as NodeJS.Process;
  return { process, stdout: () => out.join(''), stderr: () => err.join('') };
}

async function runCli(
  argv: string[],
  ports: SetupPorts,
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | string | undefined;
}> {
  const { process, stdout, stderr } = makeFakeProcess();
  const ctx = buildContext(process, ports);
  await run(app, argv, ctx);
  return { stdout: stdout(), stderr: stderr(), exitCode: process.exitCode };
}

describe('@levr-one/setup default route (via real stricli routing + fake ports)', () => {
  it.each([[[]], [['setup']]])(
    'routes both forms (%j) to the setup flow and prints workspaces',
    async (argv) => {
      const { ports } = makeFakePorts();
      const { stdout, exitCode } = await runCli(argv, ports);

      expect(stdout).toContain('Acme');
      expect(stdout).toContain('Beta');
      // H1: role is printed; is_primary is marked.
      expect(stdout).toContain('owner');
      expect(stdout).toContain('(primary)');
      expect(exitCode).toBeFalsy();
    },
  );

  it('reuses a valid token — does NOT re-authenticate when listing succeeds', async () => {
    const { ports, calls } = makeFakePorts();
    await runCli([], ports);
    expect(calls).toContain('listWorkspaces');
    expect(calls.some((c) => c.startsWith('authenticate'))).toBe(false);
  });

  it.each(['local', 'staging', 'production'] as const)(
    'resolves config for --env %s',
    async (env) => {
      const { ports, calls } = makeFakePorts();
      const { exitCode } = await runCli(['--env', env], ports);
      expect(calls).toContain(`resolveConfig:${env}`);
      expect(exitCode).toBeFalsy();
    },
  );

  it('authenticates on demand when there is no token, then lists (--device honored)', async () => {
    const calls: string[] = [];
    const { ports } = makeFakePorts({
      resolveConfig: (env) => {
        calls.push(`resolveConfig:${env}`);
        return { ...CONFIG, environment: env };
      },
      writeConfig: () => calls.push('writeConfig'),
      authenticate: (_c, useDevice) => {
        calls.push(`authenticate:${useDevice}`);
        return Promise.resolve();
      },
      listWorkspaces: listNeedsAuthThenSucceeds(calls),
    });

    const { stdout, exitCode } = await runCli(['--device'], ports);
    // First list fails (no token) -> authenticate(device=true) -> list succeeds.
    expect(calls).toEqual([
      'resolveConfig:staging',
      'writeConfig',
      'listWorkspaces:1',
      'authenticate:true',
      'listWorkspaces:2',
    ]);
    expect(stdout).toContain('Acme');
    expect(exitCode).toBeFalsy();
  });

  it('persists config BEFORE any list/auth (R2F2 ordering)', async () => {
    const { ports, calls } = makeFakePorts();
    await runCli([], ports);
    expect(calls.indexOf('writeConfig')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('writeConfig')).toBeLessThan(
      calls.indexOf('listWorkspaces'),
    );
  });

  it('exits non-zero (no uncaught crash) when sign-in itself fails', async () => {
    const calls: string[] = [];
    const { ports } = makeFakePorts({
      authenticate: () => Promise.reject(new Error('auth failed')),
      listWorkspaces: () => {
        calls.push('list');
        return Promise.reject(
          new WorkspaceFetchError('not_authenticated', 'no token'),
        );
      },
    });
    const { exitCode } = await runCli([], ports);
    expect(exitCode).toBeTruthy();
    expect(exitCode).not.toBe(0);
  });

  it('propagates a non-auth list error without trying to authenticate', async () => {
    const calls: string[] = [];
    const { ports } = makeFakePorts({
      authenticate: () => {
        calls.push('authenticate');
        return Promise.resolve();
      },
      listWorkspaces: () =>
        Promise.reject(
          new WorkspaceFetchError('http_error', 'boom', { status: 500 }),
        ),
    });
    const { exitCode } = await runCli([], ports);
    expect(exitCode).toBeTruthy();
    expect(calls).not.toContain('authenticate');
  });

  it('reports empty workspace lists without erroring', async () => {
    const { ports } = makeFakePorts({
      listWorkspaces: () => Promise.resolve([]),
    });
    const { stderr, exitCode } = await runCli([], ports);
    expect(stderr).toContain('No workspaces found');
    expect(exitCode).toBeFalsy();
  });
});

describe('performSetup (direct, injected ports)', () => {
  it('prints workspace_name — role, marking the primary', async () => {
    const out: string[] = [];
    const { ports } = makeFakePorts();
    await performSetup(
      ports,
      { env: 'staging', device: false },
      { out: (l) => out.push(l), err: () => undefined },
    );
    const joined = out.join('\n');
    expect(joined).toContain('Acme — owner (primary)');
    expect(joined).toContain('Beta — member');
  });

  it('authenticates on demand then lists when no token is present', async () => {
    const calls: string[] = [];
    const { ports } = makeFakePorts({
      authenticate: () => {
        calls.push('authenticate');
        return Promise.resolve();
      },
      listWorkspaces: listNeedsAuthThenSucceeds(calls),
    });
    await performSetup(
      ports,
      { env: 'local', device: true },
      { out: () => undefined, err: () => undefined },
    );
    expect(calls).toEqual([
      'listWorkspaces:1',
      'authenticate',
      'listWorkspaces:2',
    ]);
  });

  it('propagates auth errors from sign-in rather than swallowing them', async () => {
    const { ports } = makeFakePorts({
      authenticate: () => Promise.reject(new Error('boom')),
      listWorkspaces: () =>
        Promise.reject(
          new WorkspaceFetchError('not_authenticated', 'no token'),
        ),
    });
    await expect(
      performSetup(
        ports,
        { env: 'local', device: true },
        { out: () => undefined, err: () => undefined },
      ),
    ).rejects.toThrow('boom');
  });
});

describe('realSetupPorts.resolveConfig (pure env resolution)', () => {
  it('uses the requested preset by default', () => {
    const config = realSetupPorts.resolveConfig('staging');
    expect(config.environment).toBe('staging');
    expect(config.apiUrl).toContain('levr');
  });

  it('honors a LEVR_BACKEND_URL override', () => {
    vi.stubEnv('LEVR_BACKEND_URL', 'http://localhost:8080');
    try {
      const config = realSetupPorts.resolveConfig('staging');
      expect(config.apiUrl).toBe('http://localhost:8080');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
