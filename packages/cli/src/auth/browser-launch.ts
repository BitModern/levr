import { release } from 'node:os';

/**
 * Browser launch for `levr auth login` / `levr auth signup` (internal, D8).
 *
 * The authorize URL is ALWAYS printed first, so a person can open it by hand
 * whatever happens next. Then the browser is opened, unless this host plainly
 * has none, in which case the caller goes straight to the device-code flow.
 *
 * Why a headless check and not just a `catch`: `open` ^10 resolves as soon as
 * it has spawned `xdg-open` (`wait` defaults to false), so on a Linux host
 * with no display it never rejects and a `catch` alone would never fall back.
 */

/** What the launcher reads about its host. Injectable for tests. */
export interface LaunchHost {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  stdoutIsTTY: boolean;
  /** `os.release()`; WSL kernels contain "microsoft". */
  osRelease: string;
}

export interface LaunchOptions {
  /** Where the link and notices are printed. */
  write: (text: string) => void;
  /** Host facts; defaults to the running process. */
  host?: Partial<LaunchHost>;
  /** Opens the URL; defaults to the `open` package. */
  openUrl?: (url: string) => Promise<unknown>;
}

export type LaunchResult =
  | { opened: true }
  | { opened: false; reason: 'headless' | 'launch_error'; detail: string };

/**
 * True on Windows Subsystem for Linux. `open` ^10 reaches the Windows browser
 * there through `powershell.exe`, with no DISPLAY set, so WSL is exempt from
 * the Linux display rule.
 */
export function isWsl(host: LaunchHost): boolean {
  if (host.platform !== 'linux') return false;
  return Boolean(
    host.env['WSL_DISTRO_NAME'] ||
      host.env['WSL_INTEROP'] ||
      /microsoft/i.test(host.osRelease),
  );
}

/**
 * Why this host cannot show a browser, or null when it may. Headless means:
 * stdout is not a terminal; Linux (not WSL) with neither DISPLAY nor
 * WAYLAND_DISPLAY (containers, tmux and systemd sessions included); or an SSH
 * session with no forwarded display.
 */
export function headlessReason(host: LaunchHost): string | null {
  if (!host.stdoutIsTTY) return 'output is not a terminal';
  const hasDisplay = Boolean(
    host.env['DISPLAY'] || host.env['WAYLAND_DISPLAY'],
  );
  if (host.platform === 'linux' && !hasDisplay && !isWsl(host)) {
    return 'no display (DISPLAY and WAYLAND_DISPLAY are unset)';
  }
  if (host.env['SSH_CONNECTION'] && !hasDisplay) {
    return 'an SSH session with no display';
  }
  return null;
}

function currentHost(): LaunchHost {
  return {
    platform: process.platform,
    env: process.env,
    stdoutIsTTY: process.stdout.isTTY === true,
    osRelease: release(),
  };
}

async function openWithPackage(url: string): Promise<unknown> {
  const open = await import('open');
  return open.default(url);
}

/**
 * Print the URL, then open the browser, or report why the caller must use
 * the device-code flow instead. Never throws: a launch failure is a fallback,
 * not an error.
 */
export async function launchBrowserOrFallback(
  url: string,
  options: LaunchOptions,
): Promise<LaunchResult> {
  const host: LaunchHost = { ...currentHost(), ...options.host };
  const openUrl = options.openUrl ?? openWithPackage;

  options.write(`  If your browser didn't open, visit:\n  ${url}\n\n`);

  const headless = headlessReason(host);
  if (headless) {
    options.write(
      `No browser on this machine (${headless}). Using a device code instead.\n`,
    );
    return { opened: false, reason: 'headless', detail: headless };
  }

  try {
    await openUrl(url);
    return { opened: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    options.write(
      `Could not open a browser (${detail}). Using a device code instead.\n`,
    );
    return { opened: false, reason: 'launch_error', detail };
  }
}
