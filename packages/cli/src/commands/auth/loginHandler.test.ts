import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LocalContext } from '../../context.js';
import {
  generateCodeVerifier,
  generateCodeChallenge,
} from '../../auth/pkce.js';

vi.mock('../../auth/credentials.js', () => ({
  readCredentials: vi.fn(() => null),
  writeCredentials: vi.fn(),
}));

import { performLogin } from './loginHandler.js';
import { resetSessionApiUrl } from '../../utils/env.js';

// Test the PKCE flow orchestration components individually.
// Full integration test (spawn CLI → mock server) is in __tests__/.
// Workspace auto-selection on login is tested via autoSelectWorkspace
// in workspace/resolve-workspace.test.ts.

describe('loginHandler PKCE flow', () => {
  it('generates a valid PKCE pair for the auth URL', () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);

    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    // Challenge should be ~43 chars (256-bit hash base64url)
    expect(challenge.length).toBe(43);
  });
});

describe('performLogin', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetSessionApiUrl();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetSessionApiUrl();
  });

  function createMockContext(): LocalContext & { errors: string[] } {
    const errors: string[] = [];
    return {
      process: {
        stdout: { write: vi.fn(() => true) },
        stderr: { write: vi.fn() },
        exitCode: 0,
      },
      logger: {
        error: vi.fn((msg: string) => errors.push(msg)),
        info: vi.fn(),
        success: vi.fn(),
        warning: vi.fn(),
        debug: vi.fn(),
        setVerbose: vi.fn(),
      },
      errors,
    } as unknown as LocalContext & { errors: string[] };
  }

  it('fails fast with a clear error when the auth URL cannot be derived from --url', async () => {
    delete process.env['LEVR_AUTH_URL'];

    const ctx = createMockContext();
    const ok = await performLogin(ctx, {
      deviceCode: false,
      url: 'http://localhost:9999',
    });

    expect(ok).toBe(false);
    expect(ctx.process.exitCode).toBe(1);
    expect(ctx.errors.join('\n')).toContain('LEVR_AUTH_URL');
  });
});
