import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  authGetSitesV1: vi.fn(),
  client: { setConfig: vi.fn(), getConfig: vi.fn(() => ({})) },
}));
vi.mock('@levr-one/sdk', () => sdk);
vi.mock('../auth/resolve-token.js', () => ({
  resolveToken: vi.fn(() => Promise.resolve({ type: 'pat', token: 't' })),
}));
vi.mock('./sdk-client.js', () => ({ configureClient: vi.fn() }));
vi.mock('../workspace/workspace-store.js', () => ({
  loadWorkspace: vi.fn(() => null),
  saveWorkspace: vi.fn(),
  clearWorkspace: vi.fn(),
}));

import type { LocalContext } from '../context.js';
import { resolveToken } from '../auth/resolve-token.js';
import { connect } from './connect.js';

function ctx() {
  const errors: string[] = [];
  const c = {
    process: { exitCode: undefined as number | undefined },
    logger: { error: (m: string) => errors.push(m) },
  } as unknown as LocalContext & { process: { exitCode?: number } };
  return { c, errors };
}

// internal — `connect` (attach, result append) used to resolve the workspace
// only for a stored-credentials JWT; every LEVR_TOKEN was a "PAT" and the
// flag was dropped.
describe('connect — workspace per credential kind (internal)', () => {
  const env = process.env;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...env };
    delete process.env['LEVR_WORKSPACE_ID'];
  });
  afterEach(() => {
    process.env = env;
  });

  it('a PAT sends an explicit --workspace-id as given, without listing sites', async () => {
    const { c } = ctx();
    expect(await connect(c, 'ws-7')).toBe(true);
    expect(sdk.authGetSitesV1).not.toHaveBeenCalled();
    expect(sdk.client.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-7' }),
    );
  });

  it("a PAT with nothing named sends none: the token's own workspace applies", async () => {
    const { c } = ctx();
    expect(await connect(c)).toBe(true);
    expect(sdk.client.setConfig).not.toHaveBeenCalled();
  });

  it('an OAuth access token in LEVR_TOKEN resolves the flag against the sites and sends it', async () => {
    vi.mocked(resolveToken).mockResolvedValueOnce({
      type: 'jwt',
      token: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1In0.c2ln',
      source: 'env',
    });
    sdk.authGetSitesV1.mockResolvedValue({
      data: {
        sites: [{ workspace_id: 'ws-9', workspace_name: 'Nine' }],
        current_workspace_id: 'ws-9',
      },
    });
    const { c } = ctx();
    expect(await connect(c, 'ws-9')).toBe(true);
    expect(sdk.authGetSitesV1).toHaveBeenCalled();
    expect(sdk.client.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-9' }),
    );
  });

  it('a JWT naming a workspace the account cannot see stops the command', async () => {
    vi.mocked(resolveToken).mockResolvedValueOnce({
      type: 'jwt',
      token: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1In0.c2ln',
      source: 'env',
    });
    sdk.authGetSitesV1.mockResolvedValue({
      data: { sites: [], current_workspace_id: '' },
    });
    const { c, errors } = ctx();
    expect(await connect(c, 'ws-9')).toBe(false);
    expect(c.process.exitCode).toBe(1);
    expect(errors.join('')).toMatch(/Workspace ws-9 not found/);
  });
});
