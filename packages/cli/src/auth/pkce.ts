import { randomBytes, createHash } from 'node:crypto';

/**
 * Generate a PKCE code verifier (43-128 chars, base64url).
 * Uses 64 random bytes → 86 chars after base64url encoding.
 */
export function generateCodeVerifier(): string {
  return randomBytes(64).toString('base64url').slice(0, 86);
}

/**
 * Generate a PKCE code challenge from the verifier (SHA-256, base64url).
 */
export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
