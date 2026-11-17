import { describe, it, expect, vi } from 'vitest';
import {
  headlessReason,
  launchBrowserOrFallback,
  type LaunchHost,
} from './browser-launch.js';

/**
 * internal (D8): the authorize URL is always printed, the browser is opened
 * when the host can show one, and the caller falls back to the device-code
 * flow when it cannot (headless, or a launch error). Never throws.
 */
const URL_ = 'http://localhost:3021/auth/oauth/authorize?client_id=3';

/** A desktop host: a terminal and a display. */
const desktop: LaunchHost = {
  platform: 'darwin',
  env: {},
  stdoutIsTTY: true,
  osRelease: '24.0.0',
};

function run(
  host: Partial<LaunchHost>,
  openUrl = vi.fn(() => Promise.resolve()),
) {
  const out: string[] = [];
  const result = launchBrowserOrFallback(URL_, {
    write: (s) => out.push(s),
    host: { ...desktop, ...host },
    openUrl,
  });
  return { result, out, openUrl };
}

describe('launchBrowserOrFallback', () => {
  it('prints URL and falls back to device code', async () => {
    const openUrl = vi.fn(() =>
      Promise.reject(new Error('spawn xdg-open ENOENT')),
    );
    const { result, out } = run({}, openUrl);

    const r = await result;
    const text = out.join('');
    // The link is printed BEFORE the browser is tried.
    expect(text.indexOf(URL_)).toBeGreaterThanOrEqual(0);
    expect(out[0]).toContain("If your browser didn't open, visit:");
    expect(out[0]).toContain(URL_);
    expect(openUrl).toHaveBeenCalledWith(URL_);
    // A launch error is a fallback to the device code, not a throw.
    expect(r).toMatchObject({ opened: false, reason: 'launch_error' });
    expect(text).toContain('device code');
  });

  it('opens the browser on a desktop and asks for no device code', async () => {
    const { result, out, openUrl } = run({});
    expect(await result).toEqual({ opened: true });
    expect(openUrl).toHaveBeenCalledWith(URL_);
    expect(out.join('')).toContain(URL_);
    expect(out.join('')).not.toContain('device code');
  });

  it('Linux with neither DISPLAY nor WAYLAND_DISPLAY is headless: open is not called', async () => {
    const { result, out, openUrl } = run({ platform: 'linux', env: {} });
    expect(await result).toMatchObject({ opened: false, reason: 'headless' });
    expect(openUrl).not.toHaveBeenCalled();
    expect(out.join('')).toContain(URL_);
    expect(out.join('')).toContain('device code');
  });

  it('Linux with WAYLAND_DISPLAY set opens the browser', async () => {
    const { result, openUrl } = run({
      platform: 'linux',
      env: { WAYLAND_DISPLAY: 'wayland-0' },
    });
    expect(await result).toEqual({ opened: true });
    expect(openUrl).toHaveBeenCalled();
  });

  it('Linux with DISPLAY set opens the browser', async () => {
    const { result } = run({ platform: 'linux', env: { DISPLAY: ':0' } });
    expect(await result).toEqual({ opened: true });
  });

  it.each([
    ['WSL_DISTRO_NAME', { WSL_DISTRO_NAME: 'Ubuntu' }, '5.15.0'],
    ['WSL_INTEROP', { WSL_INTEROP: '/run/WSL/1_interop' }, '5.15.0'],
    ['a microsoft kernel', {}, '5.15.153.1-microsoft-standard-WSL2'],
  ])(
    'WSL (%s) with no display is exempt: open IS called and no device code is offered',
    async (_label, env, osRelease) => {
      const { result, out, openUrl } = run({
        platform: 'linux',
        env,
        osRelease,
      });
      expect(await result).toEqual({ opened: true });
      expect(openUrl).toHaveBeenCalledWith(URL_);
      expect(out.join('')).not.toContain('device code');
    },
  );

  it('WSL whose open is rejected still falls back', async () => {
    const openUrl = vi.fn(() =>
      Promise.reject(new Error('powershell.exe failed')),
    );
    const { result } = run(
      { platform: 'linux', env: { WSL_DISTRO_NAME: 'Ubuntu' } },
      openUrl,
    );
    expect(await result).toMatchObject({
      opened: false,
      reason: 'launch_error',
    });
  });

  it('an output that is not a terminal is headless', async () => {
    const { result, openUrl } = run({ stdoutIsTTY: false });
    expect(await result).toMatchObject({ opened: false, reason: 'headless' });
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('an SSH session with no display is headless, on any platform', async () => {
    const { result, openUrl } = run({
      platform: 'darwin',
      env: { SSH_CONNECTION: '10.0.0.1 5000 10.0.0.2 22' },
    });
    expect(await result).toMatchObject({ opened: false, reason: 'headless' });
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('an SSH session with a forwarded display may open', () => {
    expect(
      headlessReason({
        ...desktop,
        platform: 'linux',
        env: {
          SSH_CONNECTION: '10.0.0.1 5000 10.0.0.2 22',
          DISPLAY: 'localhost:10.0',
        },
      }),
    ).toBeNull();
  });
});
