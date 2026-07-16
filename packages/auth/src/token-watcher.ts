/**
 * TokenWatcher - Self-Healing Token Management
 *
 * Watches the token file for changes and notifies subscribers.
 * This enables MCP servers to auto-recover when:
 * - Tokens appear after startup (user runs authorize)
 * - Tokens are refreshed externally
 * - Token file is fixed after corruption
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadTokens, getTokenFilePath, getTqDir } from './token-store.js';
import type { StoredTokens, TokenChangeCallback, AuthStatus } from './types.js';

/**
 * Options for TokenWatcher
 */
export interface TokenWatcherOptions {
  /** Polling interval in milliseconds (backup if fs.watch misses events) */
  pollInterval?: number;
  /** Minutes before expiration to consider token as expiring soon */
  expirationWarningMinutes?: number;
}

const DEFAULT_OPTIONS: Required<TokenWatcherOptions> = {
  pollInterval: 30000, // 30 seconds
  expirationWarningMinutes: 5,
};

/**
 * TokenWatcher for self-healing token management
 *
 * Usage:
 * ```typescript
 * const watcher = new TokenWatcher();
 * watcher.onTokenChange((tokens) => {
 *   if (tokens) {
 *     console.log('Tokens available:', tokens.expiresAt > Date.now() ? 'valid' : 'expired');
 *   } else {
 *     console.log('No tokens available');
 *   }
 * });
 * watcher.start();
 * ```
 */
export class TokenWatcher {
  private watcher: fs.FSWatcher | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastTokens: StoredTokens | null = null;
  private lastTokensJson: string = '';
  private callbacks: Set<TokenChangeCallback> = new Set();
  private options: Required<TokenWatcherOptions>;
  private isRunning: boolean = false;

  constructor(options?: TokenWatcherOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Start watching for token changes
   */
  start(): void {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;

    const tokenFilePath = getTokenFilePath();
    const tqDir = getTqDir();

    // Ensure directory exists for watching
    if (!fs.existsSync(tqDir)) {
      try {
        fs.mkdirSync(tqDir, { recursive: true, mode: 0o700 });
      } catch {
        console.error('[tq-oauth] Failed to create .tq directory for watching');
      }
    }

    // Watch the directory (not the file) because the file may not exist yet
    // and fs.watch on a non-existent file fails
    try {
      this.watcher = fs.watch(tqDir, (eventType, filename) => {
        if (filename === path.basename(tokenFilePath)) {
          this.checkTokens();
        }
      });

      this.watcher.on('error', (error) => {
        console.error('[tq-oauth] Watch error:', error);
        // Continue with polling as fallback
      });
    } catch (error) {
      console.error('[tq-oauth] Failed to start file watcher:', error);
      // Continue with polling as fallback
    }

    // Also poll periodically (backup if fs.watch misses events)
    // unref so timer doesn't keep the process alive
    this.pollInterval = setInterval(() => {
      this.checkTokens();
    }, this.options.pollInterval);
    this.pollInterval.unref();

    // Initial check
    this.checkTokens();
  }

  /**
   * Stop watching for token changes
   */
  stop(): void {
    this.isRunning = false;

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Register a callback for token changes
   */
  onTokenChange(callback: TokenChangeCallback): void {
    this.callbacks.add(callback);

    // Immediately notify with current state if watcher is running
    if (this.isRunning) {
      callback(this.lastTokens);
    }
  }

  /**
   * Remove a token change callback
   */
  offTokenChange(callback: TokenChangeCallback): void {
    this.callbacks.delete(callback);
  }

  /**
   * Get current tokens (synchronous)
   */
  getCurrentTokens(): StoredTokens | null {
    return this.lastTokens;
  }

  /**
   * Get current auth status based on tokens
   */
  getAuthStatus(): AuthStatus {
    if (!this.lastTokens) {
      return 'missing';
    }

    const now = Date.now();
    const warningThreshold = this.options.expirationWarningMinutes * 60 * 1000;

    if (now >= this.lastTokens.expiresAt) {
      return 'expired';
    }

    if (this.lastTokens.expiresAt - now < warningThreshold) {
      // Expiring soon - could trigger proactive refresh
      return 'expired';
    }

    return 'ok';
  }

  /**
   * Check if tokens are valid (not expired)
   */
  isTokenValid(): boolean {
    return this.getAuthStatus() === 'ok';
  }

  /**
   * Force a token check (useful after manual refresh)
   */
  forceCheck(): void {
    this.checkTokens();
  }

  /**
   * Internal: Check tokens and notify if changed
   */
  private checkTokens(): void {
    const tokens = loadTokens();
    const tokensJson = tokens ? JSON.stringify(tokens) : '';

    // Only notify if tokens actually changed
    if (tokensJson !== this.lastTokensJson) {
      this.lastTokens = tokens;
      this.lastTokensJson = tokensJson;

      // Log state change
      if (tokens) {
        const status = this.getAuthStatus();
        console.error(`[tq-oauth] Token change detected, status: ${status}`);
      } else {
        console.error('[tq-oauth] Token file cleared or missing');
      }

      // Notify all callbacks
      this.callbacks.forEach((cb) => {
        try {
          cb(tokens);
        } catch (error) {
          console.error('[tq-oauth] Error in token change callback:', error);
        }
      });
    }
  }
}
