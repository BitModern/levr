/**
 * ConfigWatcher - Environment Change Detection
 *
 * Watches ~/.tq/config.json for changes and notifies subscribers.
 * This enables MCP servers to auto-reconfigure when the user runs
 * `yarn tq:env <preset>` without requiring a restart.
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, getConfigFilePath } from './config.js';
import { getTqDir } from './token-store.js';
import type { TqConfig } from './config.js';

export type ConfigChangeCallback = (config: TqConfig) => void;

export interface ConfigWatcherOptions {
  /** Polling interval in milliseconds (backup if fs.watch misses events) */
  pollInterval?: number;
}

const DEFAULT_OPTIONS: Required<ConfigWatcherOptions> = {
  pollInterval: 10000, // 10 seconds
};

/**
 * ConfigWatcher for environment change detection
 *
 * Usage:
 * ```typescript
 * const watcher = new ConfigWatcher();
 * watcher.onConfigChange((config) => {
 *   console.log(`Environment changed to ${config.environment} (${config.apiUrl})`);
 *   client.setConfig({ baseUrl: config.apiUrl });
 * });
 * watcher.start();
 * ```
 */
export class ConfigWatcher {
  private watcher: fs.FSWatcher | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastConfigJson: string = '';
  private lastConfig: TqConfig | null = null;
  private callbacks: Set<ConfigChangeCallback> = new Set();
  private options: Required<ConfigWatcherOptions>;
  private isRunning: boolean = false;

  constructor(options?: ConfigWatcherOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Start watching for config changes
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const tqDir = getTqDir();

    // Ensure directory exists for watching
    if (!fs.existsSync(tqDir)) {
      try {
        fs.mkdirSync(tqDir, { recursive: true, mode: 0o700 });
      } catch {
        console.error(
          '[levr-auth] Failed to create .tq directory for config watching',
        );
      }
    }

    // Watch the directory (file may not exist yet)
    const configFileName = path.basename(getConfigFilePath());
    try {
      this.watcher = fs.watch(tqDir, (_eventType, filename) => {
        if (filename === configFileName) {
          this.checkConfig();
        }
      });

      this.watcher.on('error', (error) => {
        console.error('[levr-auth] Config watch error:', error);
      });
    } catch (error) {
      console.error('[levr-auth] Failed to start config watcher:', error);
    }

    // Poll as backup (unref so timer doesn't keep the process alive)
    this.pollTimer = setInterval(() => {
      this.checkConfig();
    }, this.options.pollInterval);
    this.pollTimer.unref();

    // Initial snapshot (don't notify — caller already has initial config)
    this.lastConfig = loadConfig();
    this.lastConfigJson = JSON.stringify(this.lastConfig);
  }

  /**
   * Stop watching
   */
  stop(): void {
    this.isRunning = false;

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Register a callback for config changes
   */
  onConfigChange(callback: ConfigChangeCallback): void {
    this.callbacks.add(callback);
  }

  /**
   * Remove a callback
   */
  offConfigChange(callback: ConfigChangeCallback): void {
    this.callbacks.delete(callback);
  }

  /**
   * Get current config snapshot
   */
  getCurrentConfig(): TqConfig | null {
    return this.lastConfig;
  }

  /**
   * Force a config check
   */
  forceCheck(): void {
    this.checkConfig();
  }

  /**
   * Internal: Check config and notify if changed
   */
  private checkConfig(): void {
    const config = loadConfig();
    const configJson = JSON.stringify(config);

    if (configJson !== this.lastConfigJson) {
      const prev = this.lastConfig;
      this.lastConfig = config;
      this.lastConfigJson = configJson;

      console.error(
        `[levr-auth] Config change detected: ${prev?.environment ?? 'unknown'} (${prev?.apiUrl ?? '?'}) → ${config.environment} (${config.apiUrl})`,
      );

      this.callbacks.forEach((cb) => {
        try {
          cb(config);
        } catch (error) {
          console.error('[levr-auth] Error in config change callback:', error);
        }
      });
    }
  }
}
