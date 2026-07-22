import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LocalContext } from '../context.js';

vi.mock('../auth/resolve-token.js', () => ({
  resolveToken: vi.fn(),
  CredentialsMismatchError: class extends Error {},
}));

vi.mock('./auth/loginHandler.js', () => ({
  performLogin: vi.fn(),
}));

vi.mock('./workspace/listHandler.js', () => ({
  printSites: vi.fn(),
}));

vi.mock('../utils/sdk-client.js', () => ({
  configureClient: vi.fn(),
}));

vi.mock('../utils/env.js', () => ({
  setSessionApiUrl: vi.fn(),
}));

vi.mock('@levr/sdk', () => ({
  authGetSitesV1: vi.fn(),
}));

import { initHandler } from './initHandler.js';
import {
  resolveToken,
  CredentialsMismatchError,
} from '../auth/resolve-token.js';
import { performLogin } from './auth/loginHandler.js';
import { printSites } from './workspace/listHandler.js';
import { setSessionApiUrl } from '../utils/env.js';
import { authGetSitesV1 } from '@levr/sdk';

const mockResolveToken = vi.mocked(resolveToken);
const mockPerformLogin = vi.mocked(performLogin);
const mockPrintSites = vi.mocked(printSites);
const mockSetSessionApiUrl = vi.mocked(setSessionApiUrl);
const mockAuthGetSites = vi.mocked(authGetSitesV1);

const logError = vi.fn();
const logInfo = vi.fn();
const logSuccess = vi.fn();
const logWarning = vi.fn();

function createMockContext(): LocalContext {
  logError.mockReset();
  logInfo.mockReset();
  logSuccess.mockReset();
  logWarning.mockReset();
  return {
    process: {
      stdout: { write: vi.fn(() => true) },
      stderr: { write: vi.fn() },
      exitCode: 0,
    },
    logger: {
      error: logError,
      info: logInfo,
      success: logSuccess,
      warning: logWarning,
      debug: vi.fn(),
      setVerbose: vi.fn(),
    },
  } as unknown as LocalContext;
}

const SITES_RESPONSE = {
  ok: true,
  data: {
    sites: [
      {
        workspace_id: 'ws-1',
        workspace_name: 'Acme',
        role: 'owner',
        is_primary: true,
        user_id: 'u-1',
        last_accessed_at: null,
      },
    ],
    current_workspace_id: 'ws-1',
  },
  error: undefined,
} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('initHandler', () => {
  it('skips login and lists workspaces when already authenticated', async () => {
    mockResolveToken.mockResolvedValue({ token: 'tok', type: 'jwt' });
    mockAuthGetSites.mockResolvedValue(SITES_RESPONSE);

    const ctx = createMockContext();
    await initHandler.call(ctx, { 'device-code': false });

    expect(mockPerformLogin).not.toHaveBeenCalled();
    expect(logSuccess).toHaveBeenCalledWith('Already authenticated.');
    expect(mockPrintSites).toHaveBeenCalledWith(
      ctx,
      expect.arrayContaining([
        expect.objectContaining({ workspace_id: 'ws-1' }),
      ]),
    );
    expect(ctx.process.exitCode).toBe(0);
  });

  it('runs the login flow when unauthenticated, then lists workspaces', async () => {
    mockResolveToken
      .mockRejectedValueOnce(new Error('Not authenticated'))
      .mockResolvedValueOnce({ token: 'tok', type: 'jwt' });
    mockPerformLogin.mockResolvedValue(true);
    mockAuthGetSites.mockResolvedValue(SITES_RESPONSE);

    const ctx = createMockContext();
    await initHandler.call(ctx, { 'device-code': false });

    expect(mockPerformLogin).toHaveBeenCalledWith(ctx, { deviceCode: false });
    expect(mockPrintSites).toHaveBeenCalled();
    expect(ctx.process.exitCode).toBe(0);
  });

  it('passes --device-code through to the login flow', async () => {
    mockResolveToken
      .mockRejectedValueOnce(new Error('Not authenticated'))
      .mockResolvedValueOnce({ token: 'tok', type: 'jwt' });
    mockPerformLogin.mockResolvedValue(true);
    mockAuthGetSites.mockResolvedValue(SITES_RESPONSE);

    const ctx = createMockContext();
    await initHandler.call(ctx, { 'device-code': true });

    expect(mockPerformLogin).toHaveBeenCalledWith(ctx, { deviceCode: true });
  });

  it('warns about a cross-env credentials mismatch, then logs in fresh', async () => {
    const mismatch = new CredentialsMismatchError(
      'Stored credentials are for https://api.levr.one, but this command targets https://api.levr.now.',
      '',
    );
    mockResolveToken
      .mockRejectedValueOnce(mismatch)
      .mockResolvedValueOnce({ token: 'tok', type: 'jwt' });
    mockPerformLogin.mockResolvedValue(true);
    mockAuthGetSites.mockResolvedValue(SITES_RESPONSE);

    const ctx = createMockContext();
    await initHandler.call(ctx, { 'device-code': false });

    expect(logWarning).toHaveBeenCalledWith(
      expect.stringContaining('Stored credentials are for'),
    );
    expect(mockPerformLogin).toHaveBeenCalled();
    expect(mockPrintSites).toHaveBeenCalled();
  });

  it('stops without listing when the login flow fails', async () => {
    mockResolveToken.mockRejectedValue(new Error('Not authenticated'));
    mockPerformLogin.mockResolvedValue(false);

    const ctx = createMockContext();
    await initHandler.call(ctx, { 'device-code': false });

    expect(mockAuthGetSites).not.toHaveBeenCalled();
    expect(mockPrintSites).not.toHaveBeenCalled();
  });

  it('reports PAT auth and skips workspace listing', async () => {
    mockResolveToken.mockResolvedValue({ token: 'pat-tok', type: 'pat' });

    const ctx = createMockContext();
    await initHandler.call(ctx, { 'device-code': false });

    expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('LEVR_TOKEN'));
    expect(mockAuthGetSites).not.toHaveBeenCalled();
    expect(ctx.process.exitCode).toBe(0);
  });

  it('applies --url as the session API URL before resolving auth', async () => {
    mockResolveToken.mockResolvedValue({ token: 'tok', type: 'jwt' });
    mockAuthGetSites.mockResolvedValue(SITES_RESPONSE);

    const ctx = createMockContext();
    await initHandler.call(ctx, {
      'device-code': false,
      url: 'https://api.levr.now',
    });

    expect(mockSetSessionApiUrl).toHaveBeenCalledWith('https://api.levr.now');
  });

  it('sets exit code when workspace listing fails', async () => {
    mockResolveToken.mockResolvedValue({ token: 'tok', type: 'jwt' });
    mockAuthGetSites.mockResolvedValue({
      ok: false,
      data: undefined,
      error: { message: 'boom' },
    } as never);

    const ctx = createMockContext();
    await initHandler.call(ctx, { 'device-code': false });

    expect(logError).toHaveBeenCalledWith('Failed to list workspaces.');
    expect(ctx.process.exitCode).toBe(1);
  });
});
