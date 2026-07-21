import { describe, it, expect } from 'vitest';
import { generateCodeVerifier, generateCodeChallenge } from './pkce.js';

describe('PKCE', () => {
  describe('generateCodeVerifier', () => {
    it('should return a string between 43 and 128 characters', () => {
      const verifier = generateCodeVerifier();
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(128);
    });

    it('should only contain base64url-safe characters', () => {
      const verifier = generateCodeVerifier();
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should generate unique verifiers', () => {
      const a = generateCodeVerifier();
      const b = generateCodeVerifier();
      expect(a).not.toBe(b);
    });
  });

  describe('generateCodeChallenge', () => {
    it('should return a base64url-encoded SHA-256 hash', () => {
      const challenge = generateCodeChallenge('test-verifier');
      expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should be deterministic for the same verifier', () => {
      const verifier = generateCodeVerifier();
      const a = generateCodeChallenge(verifier);
      const b = generateCodeChallenge(verifier);
      expect(a).toBe(b);
    });

    it('should produce different challenges for different verifiers', () => {
      const a = generateCodeChallenge('verifier-a');
      const b = generateCodeChallenge('verifier-b');
      expect(a).not.toBe(b);
    });
  });
});
