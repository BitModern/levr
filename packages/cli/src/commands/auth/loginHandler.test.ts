import { describe, it, expect } from 'vitest';
import {
  generateCodeVerifier,
  generateCodeChallenge,
} from '../../auth/pkce.js';

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
