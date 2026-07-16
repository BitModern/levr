/**
 * Cross-process advisory file lock for coordinating token refresh.
 *
 * Problem: each MCP process has its own OAuthClient with a per-process
 * refreshPromise dedup. When multiple MCP processes (tq-backender-proxy,
 * tq-agent-bridge, etc.) hit an expired access token at roughly the same
 * time, they ALL POST /v1/oauth/token with the same refresh token. The
 * backend rotates the refresh token on first request; subsequent requests
 * see invalid_grant (400). After CLEAR_TOKENS_AFTER_FAILURES (3)
 * consecutive 400s, clearTokens() wipes the environment entry entirely.
 *
 * Fix: before calling the refresh endpoint, acquire an exclusive lock
 * file keyed on apiBaseUrl. On acquire, re-read the token file — if
 * another process refreshed while we waited, adopt their tokens and
 * skip the network call. Otherwise, call the refresh endpoint and
 * release the lock.
 *
 * Stale lock handling: if the lock file's mtime is older than
 * STALE_LOCK_THRESHOLD_MS, consider the holder dead (crashed, killed)
 * and break the lock. This keeps a single bad actor from wedging all
 * MCP processes forever.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getTqDir } from './token-store.js';

const LOCK_DIR = 'locks';
const STALE_LOCK_THRESHOLD_MS = 30_000; // 30s — well over a normal refresh
const ACQUIRE_POLL_INTERVAL_MS = 50;
const ACQUIRE_JITTER_MS = 100;

export interface FileLockHandle {
  release: () => void;
  /** Was the lock broken because the previous holder left a stale file? */
  brokeStaleLock: boolean;
}

/**
 * Build a lock file path from an apiBaseUrl. Each environment
 * (localhost, staging, production) gets its own lock since their
 * tokens are independent.
 */
export function getLockPath(apiBaseUrl: string): string {
  const safe = apiBaseUrl.replace(/[^a-zA-Z0-9]/g, '_');
  const dir = path.join(getTqDir(), LOCK_DIR);
  return path.join(dir, `refresh-${safe}.lock`);
}

function ensureLockDir(lockPath: string): void {
  const dir = path.dirname(lockPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function breakStaleLockIfAny(lockPath: string): boolean {
  try {
    const stat = fs.statSync(lockPath);
    if (Date.now() - stat.mtimeMs > STALE_LOCK_THRESHOLD_MS) {
      fs.unlinkSync(lockPath);
      return true;
    }
  } catch {
    // lock file gone — race with holder releasing; caller will retry
  }
  return false;
}

/**
 * Acquire an exclusive lock file. Blocks up to `maxWaitMs` while another
 * holder has it. If the lock file is stale (mtime > threshold), break it
 * and take it. Returns a handle with `release()` that MUST be called
 * in finally.
 */
export async function acquireFileLock(
  lockPath: string,
  maxWaitMs = 10_000,
): Promise<FileLockHandle> {
  ensureLockDir(lockPath);

  const start = Date.now();
  let brokeStaleLock = false;

  while (true) {
    try {
      // 'wx' — exclusive create, fail if exists (atomic on POSIX)
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, `${process.pid}\n${Date.now()}`);
      fs.closeSync(fd);

      let released = false;
      return {
        brokeStaleLock,
        release: () => {
          if (released) return;
          released = true;
          try {
            fs.unlinkSync(lockPath);
          } catch {
            // Already gone — either we crashed and another process broke
            // it, or a test cleaned up. Either way, benign.
          }
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;

      if (breakStaleLockIfAny(lockPath)) {
        brokeStaleLock = true;
        // Retry immediately after breaking a stale lock
        continue;
      }

      if (Date.now() - start >= maxWaitMs) {
        throw new Error(
          `Could not acquire lock ${lockPath} within ${maxWaitMs}ms`,
        );
      }

      // Wait with jitter to avoid thundering herd
      const delay =
        ACQUIRE_POLL_INTERVAL_MS +
        Math.floor(Math.random() * ACQUIRE_JITTER_MS);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
