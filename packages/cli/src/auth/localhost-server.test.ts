import { describe, it, expect, afterEach } from 'vitest';
import { startCallbackServer } from './localhost-server.js';

describe('startCallbackServer', () => {
  let close: (() => void) | undefined;

  afterEach(() => {
    close?.();
    close = undefined;
  });

  it('should resolve with code on valid callback', async () => {
    const server = startCallbackServer({ timeout: 5_000 });
    close = server.close;

    const port = await server.port;

    const res = await fetch(
      `http://127.0.0.1:${port}/callback?code=test-auth-code&state=abc`,
    );
    expect(res.status).toBe(200);

    const result = await server.code;
    expect(result.code).toBe('test-auth-code');
  });

  it('should reject on OAuth error in callback', async () => {
    const server = startCallbackServer({ timeout: 5_000 });
    close = server.close;

    // Attach rejection handler before triggering
    const rejection = server.code.catch((err: Error) => err);

    const port = await server.port;
    await fetch(`http://127.0.0.1:${port}/callback?error=access_denied`);

    const err = await rejection;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('OAuth error: access_denied');
  });

  it('should reject on state mismatch when expectedState is set', async () => {
    const server = startCallbackServer({
      timeout: 5_000,
      expectedState: 'correct-state',
    });
    close = server.close;

    const rejection = server.code.catch((err: Error) => err);

    const port = await server.port;
    const res = await fetch(
      `http://127.0.0.1:${port}/callback?code=test-code&state=wrong-state`,
    );
    expect(res.status).toBe(200);

    const err = await rejection;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('OAuth state mismatch');
  });

  it('should reject when state is missing but expectedState is set', async () => {
    const server = startCallbackServer({
      timeout: 5_000,
      expectedState: 'expected-value',
    });
    close = server.close;

    const rejection = server.code.catch((err: Error) => err);

    const port = await server.port;
    await fetch(`http://127.0.0.1:${port}/callback?code=test-code`);

    const err = await rejection;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('OAuth state mismatch');
  });

  it('should accept any state when expectedState is not set', async () => {
    const server = startCallbackServer({ timeout: 5_000 });
    close = server.close;

    const port = await server.port;

    await fetch(
      `http://127.0.0.1:${port}/callback?code=test-code&state=anything`,
    );

    const result = await server.code;
    expect(result.code).toBe('test-code');
  });

  it('should return 404 for non-callback paths', async () => {
    const server = startCallbackServer({ timeout: 5_000 });
    close = server.close;

    const port = await server.port;

    const res = await fetch(`http://127.0.0.1:${port}/other`);
    expect(res.status).toBe(404);
  });
});
