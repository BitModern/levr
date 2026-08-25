import { describe, expect, it } from 'vitest';
import { describeConnectionError } from './connection-error.js';

const URL_ = 'http://localhost:9999';

/** The shape Node's fetch actually produces: opaque outer, real code in cause. */
function fetchFailure(code: string): Error {
  const outer = new TypeError('fetch failed');
  (outer as { cause?: unknown }).cause = Object.assign(
    new Error('connect ' + code),
    { code },
  );
  return outer;
}

describe('describeConnectionError', () => {
  it('explains a refused connection, naming the backend', () => {
    const msg = describeConnectionError(fetchFailure('ECONNREFUSED'), URL_);
    expect(msg).toContain(URL_);
    expect(msg).toContain('not running');
  });

  it.each([
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ERR_SOCKET_CONNECTION_TIMEOUT',
  ])('explains %s as nothing listening', (code) => {
    expect(describeConnectionError(fetchFailure(code), URL_)).toContain(
      'No backend is listening',
    );
  });

  it.each(['ENOTFOUND', 'EAI_AGAIN'])(
    'explains %s as an unresolvable host',
    (code) => {
      expect(describeConnectionError(fetchFailure(code), URL_)).toContain(
        'Cannot resolve the host',
      );
    },
  );

  it('finds a code nested several causes deep', () => {
    const inner = Object.assign(new Error('refused'), {
      code: 'ECONNREFUSED',
    });
    const mid = Object.assign(new Error('mid'), { cause: inner });
    const outer = Object.assign(new TypeError('fetch failed'), { cause: mid });
    expect(describeConnectionError(outer, URL_)).toContain('not running');
  });

  it('reads a code on the error itself, with no cause chain', () => {
    expect(
      describeConnectionError(
        Object.assign(new Error('x'), {
          code: 'ECONNREFUSED',
        }),
        URL_,
      ),
    ).toContain('not running');
  });

  // The caller falls back to printing the error, so claiming an unrelated
  // failure is "backend not running" would send the operator to start a
  // server that is already up.
  it('declines an HTTP-level failure it cannot attribute', () => {
    expect(
      describeConnectionError(new Error('401 Unauthorized'), URL_),
    ).toBeUndefined();
  });

  it.each([
    ['a plain string', 'boom'],
    ['null', null],
    ['undefined', undefined],
    ['a code that is not a string', Object.assign(new Error('x'), { code: 7 })],
  ])('declines %s', (_label, input) => {
    expect(describeConnectionError(input, URL_)).toBeUndefined();
  });

  it('terminates on a cyclic cause chain', () => {
    // An error handler is the one place with nothing left to catch a hang.
    const a = new Error('a');
    const b = new Error('b');
    (a as { cause?: unknown }).cause = b;
    (b as { cause?: unknown }).cause = a;
    expect(describeConnectionError(a, URL_)).toBeUndefined();
  });
});
