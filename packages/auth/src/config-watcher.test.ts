import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const state = vi.hoisted(() => ({ tmpDir: '' }));

vi.mock('os', async (importOriginal) => {
  const original = await importOriginal<typeof import('os')>();
  return { ...original, homedir: () => state.tmpDir };
});

import { withNonTestEnv } from './test-utils.js';

let ConfigWatcher: typeof import('./config-watcher.js').ConfigWatcher;
let writeConfig: typeof import('./config.js').writeConfig;
let PRESETS: typeof import('./config.js').PRESETS;

beforeEach(async () => {
  state.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tq-cfg-watch-'));
  vi.resetModules();

  const configMod = await import('./config.js');
  writeConfig = configMod.writeConfig;
  PRESETS = configMod.PRESETS;

  const watcherMod = await import('./config-watcher.js');
  ConfigWatcher = watcherMod.ConfigWatcher;
});

afterEach(() => {
  fs.rmSync(state.tmpDir, { recursive: true, force: true });
});

describe('ConfigWatcher', () => {
  it('starts and stops without error', () => {
    const watcher = new ConfigWatcher();
    watcher.start();
    watcher.stop();
  });

  it('does not notify on start (initial snapshot only)', () => {
    writeConfig(PRESETS.staging);
    const watcher = new ConfigWatcher();
    const cb = vi.fn();
    watcher.onConfigChange(cb);
    watcher.start();

    expect(cb).not.toHaveBeenCalled();
    watcher.stop();
  });

  it('notifies when config changes via forceCheck', () => {
    withNonTestEnv(() => {
      writeConfig(PRESETS.staging);
      const watcher = new ConfigWatcher();
      const cb = vi.fn();
      watcher.onConfigChange(cb);
      watcher.start();

      // Change config
      writeConfig(PRESETS.local);
      watcher.forceCheck();

      expect(cb).toHaveBeenCalledTimes(1);
      const changed = cb.mock.calls[0][0] as import('./config.js').TqConfig;
      expect(changed.environment).toBe('local');
      // Match what was written. PRESETS.local is a getter that returns
      // the HTTPS variant when DEV_TLS dev mode is detected, so this
      // assertion stays correct in both modes.
      expect(changed.apiUrl).toBe(PRESETS.local.apiUrl);
      watcher.stop();
    });
  });

  it('does not notify when config is unchanged', () => {
    writeConfig(PRESETS.staging);
    const watcher = new ConfigWatcher();
    const cb = vi.fn();
    watcher.onConfigChange(cb);
    watcher.start();

    watcher.forceCheck();
    expect(cb).not.toHaveBeenCalled();
    watcher.stop();
  });

  it('getCurrentConfig returns latest config', () => {
    withNonTestEnv(() => {
      writeConfig(PRESETS.production);
      const watcher = new ConfigWatcher();
      watcher.start();

      expect(watcher.getCurrentConfig()?.environment).toBe('production');

      writeConfig(PRESETS.local);
      watcher.forceCheck();

      expect(watcher.getCurrentConfig()?.environment).toBe('local');
      watcher.stop();
    });
  });

  it('offConfigChange removes callback', () => {
    withNonTestEnv(() => {
      writeConfig(PRESETS.staging);
      const watcher = new ConfigWatcher();
      const cb = vi.fn();
      watcher.onConfigChange(cb);
      watcher.offConfigChange(cb);
      watcher.start();

      writeConfig(PRESETS.local);
      watcher.forceCheck();

      expect(cb).not.toHaveBeenCalled();
      watcher.stop();
    });
  });

  it('handles callback errors without crashing', () => {
    withNonTestEnv(() => {
      writeConfig(PRESETS.staging);
      const watcher = new ConfigWatcher();
      const badCb = vi.fn(() => {
        throw new Error('callback error');
      });
      const goodCb = vi.fn();
      watcher.onConfigChange(badCb);
      watcher.onConfigChange(goodCb);
      watcher.start();

      writeConfig(PRESETS.local);
      watcher.forceCheck();

      expect(badCb).toHaveBeenCalledTimes(1);
      expect(goodCb).toHaveBeenCalledTimes(1);
      watcher.stop();
    });
  });
});
