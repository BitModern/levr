import { describe, expect, it } from 'vitest';
import { classifyToken, PAT_PREFIX } from './token-shape.js';

// internal — the server tells a PAT from a JWT by the token's shape
// (`isPersonalAccessToken`: the `tq_` prefix), never by which env var or
// file it came from. The CLI must agree, or an OAuth access token exported
// as LEVR_TOKEN skips every JWT-only step.
describe('classifyToken (internal)', () => {
  it('a Levr personal access token is `tq_` + hex', () => {
    expect(classifyToken(`${PAT_PREFIX}${'a1'.repeat(32)}`)).toBe('pat');
  });

  it('an OAuth access token (three base64url segments) is a JWT', () => {
    expect(classifyToken('eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1In0.c2ln')).toBe(
      'jwt',
    );
  });

  it('anything that does not carry the PAT prefix goes to the JWT verifier, as on the server', () => {
    expect(classifyToken('not-a-token')).toBe('jwt');
    expect(classifyToken('TQ_' + '0'.repeat(64))).toBe('jwt');
  });
});
