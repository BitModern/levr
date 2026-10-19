import net from 'node:net';
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

  // A browser's speculative connection (opened, never used) kept the process
  // alive after `server.close()`, so `levr auth login` printed success and
  // never exited. Shutdown must drop it.
  it('drops an idle, never-used connection when the callback completes', async () => {
    const server = startCallbackServer({ timeout: 5_000 });
    close = server.close;
    const port = await server.port;

    const idle = net.connect(port, '127.0.0.1');
    await new Promise<void>((resolve) => idle.once('connect', () => resolve()));
    const dropped = new Promise<boolean>((resolve) => {
      idle.once('close', () => resolve(true));
      setTimeout(() => resolve(false), 2_000).unref();
    });

    const res = await fetch(
      `http://127.0.0.1:${port}/callback?code=test-auth-code&state=abc`,
    );
    expect(res.status).toBe(200);
    expect((await server.code).code).toBe('test-auth-code');

    expect(await dropped).toBe(true);
    idle.destroy();
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
