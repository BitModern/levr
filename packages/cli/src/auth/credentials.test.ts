import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StoredCredentials } from '../types/auth-types.js';

const testDir = join(tmpdir(), `levr-cli-creds-test-${Date.now()}`);

// Mock homedir so credentials go to a temp location
vi.mock('node:os', async () => {
  const path = await import('node:path');
  const os = await import('node:os');
  return {
    ...os,
    homedir: () => path.join(testDir),
  };
});

const sampleCredentials: StoredCredentials = {
  version: 1,
  api_url: 'https://api.levr.one',
  access_token: 'eyJ.test.token',
  refresh_token: 'refresh-test',
  expires_at: '2026-02-13T10:00:00.000Z',
  user: {
    id: 'user-456',
    email: 'test@example.com',
    workspace_id: 'ws-123',
  },
};

describe('credentials', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should return null when no credentials file exists', async () => {
    const { readCredentials } = await import('./credentials.js');
    expect(readCredentials()).toBeNull();
  });

  it('should write and read credentials', async () => {
    const { readCredentials, writeCredentials } = await import(
      './credentials.js'
    );
    writeCredentials(sampleCredentials);
    const result = readCredentials();
    expect(result).toEqual(sampleCredentials);
  });

  it('should delete credentials', async () => {
    const { readCredentials, writeCredentials, deleteCredentials } =
      await import('./credentials.js');
    writeCredentials(sampleCredentials);
    expect(readCredentials()).not.toBeNull();
    const deleted = deleteCredentials();
    expect(deleted).toBe(true);
    expect(readCredentials()).toBeNull();
  });

  it('should return false when deleting non-existent credentials', async () => {
    const { deleteCredentials } = await import('./credentials.js');
    expect(deleteCredentials()).toBe(false);
  });
});
