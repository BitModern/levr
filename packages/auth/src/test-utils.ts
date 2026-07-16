/**
 * Shared test utilities for tq-oauth tests.
 */

/**
 * Temporarily simulate a non-test environment so loadConfig()
 * exercises the config-file reading path. loadConfig() skips
 * ~/.tq/config.json when VITEST/JEST env vars are set.
 */
export function withNonTestEnv<T>(fn: () => T): T {
  const saved = {
    VITEST: process.env.VITEST,
    NODE_ENV: process.env.NODE_ENV,
    JEST_WORKER_ID: process.env.JEST_WORKER_ID,
    // DEV_TLS gates isLocalTlsMode() in config.ts. Clearing it forces the
    // cert-file probe path, which deterministically returns false in the
    // tmpDir filesystem the test harness uses.
    DEV_TLS: process.env.DEV_TLS,
  };
  delete process.env.VITEST;
  process.env.NODE_ENV = 'development';
  delete process.env.JEST_WORKER_ID;
  delete process.env.DEV_TLS;
  try {
    return fn();
  } finally {
    if (saved.VITEST !== undefined) process.env.VITEST = saved.VITEST;
    else delete process.env.VITEST;
    if (saved.NODE_ENV !== undefined) process.env.NODE_ENV = saved.NODE_ENV;
    else delete process.env.NODE_ENV;
    if (saved.JEST_WORKER_ID !== undefined)
      process.env.JEST_WORKER_ID = saved.JEST_WORKER_ID;
    else delete process.env.JEST_WORKER_ID;
    if (saved.DEV_TLS !== undefined) process.env.DEV_TLS = saved.DEV_TLS;
    else delete process.env.DEV_TLS;
  }
}
