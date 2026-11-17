/**
 * [issue:internal] The repository a CLI command runs in (plan internal D7,
 * shared with D9): git root, origin remote, and an ssh alias resolved with
 * `ssh -G` (Review R4 C13). git and ssh are stubs; nothing is spawned.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  NOT_A_REPO_MESSAGE,
  parseRemoteHost,
  resolveRepoContext,
  type RunCommand,
} from './repo-context.js';

function gitStub(remote: string | null, inRepo = true): RunCommand {
  return vi.fn((args: readonly string[]) => {
    if (!inRepo) return { code: 128, stdout: '' };
    if (args.join(' ') === 'rev-parse --show-toplevel') {
      return { code: 0, stdout: '/work/api\n' };
    }
    if (args.join(' ') === 'remote get-url origin') {
      return remote
        ? { code: 0, stdout: `${remote}\n` }
        : { code: 2, stdout: '' };
    }
    return { code: 1, stdout: '' };
  });
}

const sshPrinting =
  (out: string): RunCommand =>
  () => ({ code: 0, stdout: out });

describe('resolveRepoContext', () => {
  it('outside a git repo it fails with exit 2 and the cd message', async () => {
    const result = await resolveRepoContext({
      cwd: '/tmp',
      git: gitStub(null, false),
      ssh: vi.fn(),
      askIsSshAlias: vi.fn(),
      note: vi.fn(),
    });
    expect(result).toEqual({
      ok: false,
      exitCode: 2,
      message: NOT_A_REPO_MESSAGE,
    });
    expect(NOT_A_REPO_MESSAGE).toContain(
      'cd into one of your repos and run `levr gates setup`',
    );
  });

  it('a repo with no origin remote has a root and no remote', async () => {
    const result = await resolveRepoContext({
      cwd: '/work/api',
      git: gitStub(null),
      ssh: vi.fn(),
      askIsSshAlias: vi.fn(),
      note: vi.fn(),
    });
    expect(result).toEqual({
      ok: true,
      context: {
        root: '/work/api',
        remote: null,
        originalRemote: null,
        host: null,
        isDefaultProviderHost: false,
      },
    });
  });

  it('a default provider host is used as is, with no alias question', async () => {
    const ask = vi.fn();
    const ssh = vi.fn();
    const result = await resolveRepoContext({
      cwd: '/work/api',
      git: gitStub('git@github.com:acme/api.git'),
      ssh,
      askIsSshAlias: ask,
      note: vi.fn(),
    });
    expect(result.ok && result.context).toMatchObject({
      remote: 'git@github.com:acme/api.git',
      host: 'github.com',
      isDefaultProviderHost: true,
    });
    expect(ask).not.toHaveBeenCalled();
    expect(ssh).not.toHaveBeenCalled();
  });

  it('ssh alias resolves to its real host', async () => {
    const ssh = vi.fn(
      sshPrinting(
        'user git\nhostname github.com\nport 22\nidentityfile ~/.ssh/work\n',
      ),
    );
    const note = vi.fn();
    const result = await resolveRepoContext({
      cwd: '/work/api',
      git: gitStub('git@github-work:acme/api.git'),
      ssh,
      askIsSshAlias: vi.fn(() => Promise.resolve(true)),
      note,
    });
    expect(ssh).toHaveBeenCalledWith(['-G', 'github-work']);
    expect(result.ok && result.context).toEqual({
      root: '/work/api',
      remote: 'git@github.com:acme/api.git',
      originalRemote: 'git@github-work:acme/api.git',
      host: 'github.com',
      isDefaultProviderHost: true,
    });
    expect(note.mock.calls.flat().join('\n')).toContain('github-work');
  });

  it('an ssh:// alias remote keeps its user and path when rewritten', async () => {
    const result = await resolveRepoContext({
      cwd: '/work/api',
      git: gitStub('ssh://git@gl-work/team/sub/api.git'),
      ssh: sshPrinting('hostname gitlab.com\n'),
      askIsSshAlias: vi.fn(() => Promise.resolve(true)),
      note: vi.fn(),
    });
    expect(result.ok && result.context.remote).toBe(
      'ssh://git@gitlab.com/team/sub/api.git',
    );
  });

  it('a host the user says is no alias is kept as typed, and ssh is not run', async () => {
    const ssh = vi.fn();
    const result = await resolveRepoContext({
      cwd: '/work/api',
      git: gitStub('git@git.acme.dev:team/api.git'),
      ssh,
      askIsSshAlias: vi.fn(() => Promise.resolve(false)),
      note: vi.fn(),
    });
    expect(ssh).not.toHaveBeenCalled();
    expect(result.ok && result.context).toMatchObject({
      remote: 'git@git.acme.dev:team/api.git',
      host: 'git.acme.dev',
      isDefaultProviderHost: false,
    });
  });

  it('ssh missing or printing no hostname: says so and continues with the host as typed', async () => {
    for (const ssh of [
      (() => ({ code: -1, stdout: '' })) as RunCommand,
      sshPrinting('user git\nport 22\n'),
    ]) {
      const note = vi.fn();
      const result = await resolveRepoContext({
        cwd: '/work/api',
        git: gitStub('git@github-work:acme/api.git'),
        ssh,
        askIsSshAlias: vi.fn(() => Promise.resolve(true)),
        note,
      });
      expect(result.ok && result.context.remote).toBe(
        'git@github-work:acme/api.git',
      );
      expect(note.mock.calls.flat().join('\n')).toContain('as typed');
    }
  });

  it('an alias that resolves to another non-default host is kept as typed', async () => {
    const note = vi.fn();
    const result = await resolveRepoContext({
      cwd: '/work/api',
      git: gitStub('git@work:acme/api.git'),
      ssh: sshPrinting('hostname git.acme.dev\n'),
      askIsSshAlias: vi.fn(() => Promise.resolve(true)),
      note,
    });
    expect(result.ok && result.context.remote).toBe('git@work:acme/api.git');
    expect(note.mock.calls.flat().join('\n')).toContain('git.acme.dev');
  });

  it('never passes an option-like host to ssh', async () => {
    const ssh = vi.fn();
    const result = await resolveRepoContext({
      cwd: '/work/api',
      git: gitStub('git@-oProxyCommand=x:acme/api.git'),
      ssh,
      askIsSshAlias: vi.fn(() => Promise.resolve(true)),
      note: vi.fn(),
    });
    expect(ssh).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });
});

describe('parseRemoteHost', () => {
  it.each([
    ['git@github.com:acme/api.git', 'github.com', true],
    ['https://GitHub.com/acme/api', 'github.com', false],
    ['ssh://git@host:2222/a/b.git', 'host', true],
    ['git://host/a/b.git', 'host', false],
  ])('%s', (remote, host, ssh) => {
    expect(parseRemoteHost(remote)).toMatchObject({ host, ssh });
  });

  it('returns null for something that is not a remote', () => {
    expect(parseRemoteHost('not a remote')).toBeNull();
  });
});
