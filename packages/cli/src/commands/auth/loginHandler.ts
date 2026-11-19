import { randomBytes } from 'node:crypto';
import chalk from 'chalk';
import type { LocalContext } from '../../context.js';
import {
  generateCodeVerifier,
  generateCodeChallenge,
} from '../../auth/pkce.js';
import { startCallbackServer } from '../../auth/localhost-server.js';
import { launchBrowserOrFallback } from '../../auth/browser-launch.js';
import {
  requestDeviceCode,
  pollForDeviceToken,
} from '../../auth/device-flow.js';
import { writeCredentials } from '../../auth/credentials.js';
import { resolveMcpUrl, scopedMcpUrl } from '../../mcp/url.js';
import {
  findWorkspaceByKeyOrName,
  looksLikeUrlKey,
  type WorkspaceSite,
} from '../../workspace/find-workspace.js';
import {
  autoSelectWorkspace,
  fetchSites,
} from '../../workspace/resolve-workspace.js';
import { saveWorkspace } from '../../workspace/workspace-store.js';
import {
  getApiUrl,
  getAuthUrl,
  setSessionApiUrl,
  CLI_CLIENT_ID,
} from '../../utils/env.js';
import { configureClient } from '../../utils/sdk-client.js';
import type {
  OAuthTokenResponse,
  StoredCredentials,
} from '../../types/auth-types.js';

interface LoginFlags {
  'device-code': boolean;
  /** `levr auth login --signup`: open auth-web on the signup page. */
  signup: boolean;
  /** `levr auth login --admin`: also request `workspace:admin` (internal). */
  admin: boolean;
  url?: string;
  workspace?: string;
}

type SignupFlags = Omit<LoginFlags, 'signup' | 'admin'>;

/** Scopes a plain login requests. */
export const DEFAULT_LOGIN_SCOPE = 'read:own write:own';
/**
 * Scopes `levr auth login --admin` requests (internal). `workspace:admin`
 * gates workspace administration and is granted only by explicit step-up.
 */
export const ADMIN_LOGIN_SCOPE = `${DEFAULT_LOGIN_SCOPE} workspace:admin`;

/** Exit code for a run the user cancelled with Ctrl-C (128 + SIGINT). */
const EXIT_CANCELLED = 130;
/** Byte a raw-mode terminal delivers for Ctrl-C (it is no longer SIGINT). */
const CTRL_C = 0x03;

export interface LoginOptions {
  deviceCode: boolean;
  url?: string;
  /**
   * Workspace to select once logged in, by url_key or name (internal). A
   * url_key is also sent with the authorize request so auth-web can skip
   * its workspace picker for a member. Never stored on a token.
   */
  workspace?: string;
  /**
   * internal: `'signup'` sends `screen_hint=signup`, so auth-web shows an
   * anonymous user the signup page; once the account exists the same
   * authorize flow returns the token to this CLI. Unset for a plain login.
   */
  screenHint?: 'signup';
  /**
   * internal: also request `workspace:admin`, on every path (browser,
   * device code, and the fallbacks between them). Unset for a plain login.
   */
  admin?: boolean;
}

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export async function loginHandler(
  this: LocalContext,
  flags: LoginFlags,
): Promise<void> {
  await performLogin(this, {
    deviceCode: flags['device-code'],
    url: flags.url,
    workspace: flags.workspace,
    admin: flags.admin,
    ...(flags.signup ? { screenHint: 'signup' as const } : {}),
  });
}

/** `levr auth signup`: the login flow, opened on the signup page. */
export async function signupHandler(
  this: LocalContext,
  flags: SignupFlags,
): Promise<void> {
  await performLogin(this, {
    deviceCode: flags['device-code'],
    url: flags.url,
    workspace: flags.workspace,
    screenHint: 'signup',
  });
}

type WaitKey = 'device' | 'restart' | 'cancel';

/**
 * While the browser flow waits, read single keys from a terminal: `d`
 * switches to the device code, Ctrl-C (byte 0x03 — raw mode stops the
 * terminal turning it into SIGINT) cancels and, when `restart` is set, `r`
 * opens the browser again. `restore()` puts the terminal back and must run
 * on every exit. Without a TTY nothing is read.
 */
function watchWaitKeys(
  ctx: LocalContext,
  options: { restart?: boolean } = {},
): {
  key: Promise<WaitKey> | null;
  restore: () => void;
} {
  const stdin = ctx.process.stdin as NodeJS.ReadStream | undefined;
  if (!stdin?.isTTY || typeof stdin.setRawMode !== 'function') {
    return { key: null, restore: () => {} };
  }
  let onData: ((chunk: Buffer | string) => void) | undefined;
  const key = new Promise<WaitKey>((resolve) => {
    onData = (chunk) => {
      const bytes =
        typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      if (bytes.includes(CTRL_C)) resolve('cancel');
      // Only a lone `d`/`D` switches. An escape sequence (an arrow key is
      // ESC [ D, which ends in `D`) or pasted text is ignored.
      else if (bytes.length === 1 && (bytes[0] === 0x64 || bytes[0] === 0x44))
        resolve('device');
      else if (
        options.restart === true &&
        bytes.length === 1 &&
        (bytes[0] === 0x72 || bytes[0] === 0x52)
      )
        resolve('restart');
    };
  });
  stdin.setRawMode(true);
  stdin.on('data', onData!);
  stdin.resume();
  let restored = false;
  return {
    key,
    restore: () => {
      if (restored) return;
      restored = true;
      stdin.setRawMode(false);
      stdin.off('data', onData!);
      stdin.pause();
    },
  };
}

function isCallbackTimeout(err: unknown): boolean {
  return err instanceof Error && /timed out/i.test(err.message);
}

/**
 * Run the login flow (PKCE or device code). Reusable outside the Stricli
 * handler. Returns true on success; on failure the error has been printed
 * and `exitCode` set.
 */
export async function performLogin(
  ctx: LocalContext,
  options: LoginOptions,
): Promise<boolean> {
  if (options.url) {
    setSessionApiUrl(options.url);
  }
  const scope = options.admin ? ADMIN_LOGIN_SCOPE : DEFAULT_LOGIN_SCOPE;
  if (options.deviceCode) {
    return deviceCodeLogin(ctx, scope, options.workspace);
  }
  return pkceLogin(ctx, scope, options.workspace, options.screenHint);
}

async function pkceLogin(
  ctx: LocalContext,
  scope: string,
  workspace?: string,
  screenHint?: 'signup',
): Promise<boolean> {
  const apiUrl = getApiUrl();
  let authUrl: string;
  try {
    authUrl = getAuthUrl();
  } catch (err) {
    ctx.logger.error(
      err instanceof Error ? err.message : 'Invalid auth server configuration.',
    );
    ctx.process.exitCode = 1;
    return false;
  }

  // internal: a url_key names the workspace's MCP URL as the RFC 8707
  // `resource`, which auth-web already reads to skip its picker for a
  // member (internal). Only the picker is affected: tokens stay account-only.
  // An MCP URL that cannot carry it (unusable, or already pinned to a
  // workspace) just leaves the picker in place; the login does not need it.
  let resource: string | undefined;
  if (workspace !== undefined && looksLikeUrlKey(workspace)) {
    try {
      resource = scopedMcpUrl(resolveMcpUrl().url, workspace);
    } catch (err) {
      ctx.logger.debug(
        `Workspace picker not skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 1. Generate PKCE pair + state
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = randomBytes(16).toString('hex');

  // 2. Start localhost callback server (validates state on callback)
  const {
    port: portPromise,
    code: codePromise,
    close,
  } = startCallbackServer({ timeout: 120_000, expectedState: state });
  const port = await portPromise;

  const redirectUri = `http://127.0.0.1:${port}/callback`;

  // 3. Build authorization URL
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLI_CLIENT_ID,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    scope,
    state,
  });
  if (resource) params.append('resource', resource);
  // internal: auth-web sends an anonymous user to signup, then back to this
  // same authorize request; a signed-in user goes straight to consent.
  if (screenHint) params.append('screen_hint', screenHint);
  // auth-web uses React Router basename '/auth/' — all routes resolve under
  // /auth/, so the consent page is at /auth/oauth/authorize.
  const authorizeUrl = `${authUrl}/auth/oauth/authorize?${params.toString()}`;

  // 4. Print the link, then open the browser (internal). A host with no
  // browser, or a launch that fails, goes to the device code instead.
  ctx.process.stdout.write(
    screenHint === 'signup'
      ? 'Opening browser to sign up...\n\n'
      : 'Opening browser to authenticate...\n\n',
  );
  const launch = await launchBrowserOrFallback(authorizeUrl, {
    write: (text) => ctx.process.stdout.write(text),
    host: { stdoutIsTTY: ctx.process.stdout.isTTY === true },
  });
  if (!launch.opened) {
    close();
    // Nothing is listening for this rejection any more.
    codePromise.catch(() => {});
    return deviceCodeLogin(ctx, scope, workspace);
  }

  // 5. Wait for callback with countdown. On a terminal, `d` switches to the
  // device code and Ctrl-C cancels; a callback timeout offers the device
  // code rather than only failing.
  const timeoutMs = 120_000;
  const deadline = Date.now() + timeoutMs;
  const keys = watchWaitKeys(ctx);
  if (keys.key) {
    ctx.process.stdout.write(
      `Browser not showing the page? Press d to use a device code instead, Ctrl-C to cancel.\n`,
    );
  }
  const countdownTimer = setInterval(() => {
    const remaining = deadline - Date.now();
    ctx.process.stdout.write(
      `\rWaiting for authentication... ${chalk.dim(`(${formatCountdown(remaining)})`)}`,
    );
  }, 1000);
  ctx.process.stdout.write(
    `Waiting for authentication... ${chalk.dim(`(${formatCountdown(timeoutMs)})`)}`,
  );

  type WaitOutcome =
    | { kind: 'code'; code: string }
    | { kind: 'key'; key: WaitKey }
    | { kind: 'error'; err: unknown };
  const waiters: Promise<WaitOutcome>[] = [
    codePromise.then(
      (result): WaitOutcome => ({ kind: 'code', code: result.code }),
      (err: unknown): WaitOutcome => ({ kind: 'error', err }),
    ),
  ];
  if (keys.key) {
    waiters.push(keys.key.then((key): WaitOutcome => ({ kind: 'key', key })));
  }
  const outcome = await Promise.race(waiters);
  keys.restore();
  clearInterval(countdownTimer);

  if (outcome.kind !== 'code') {
    close();
    ctx.process.stdout.write('\n');
    if (outcome.kind === 'key' && outcome.key === 'cancel') {
      ctx.logger.error('Cancelled.');
      ctx.process.exitCode = EXIT_CANCELLED;
      return false;
    }
    if (outcome.kind === 'key') {
      // `d` pressed: the device code instead of the browser.
      return deviceCodeLogin(ctx, scope, workspace);
    }
    if (isCallbackTimeout(outcome.err)) {
      const waited = `${Math.round(timeoutMs / 60_000)} minutes`;
      // On a terminal the user chooses: a signup can take longer than the
      // wait, and the browser may still be open on the form.
      const choice = watchWaitKeys(ctx, { restart: true });
      if (choice.key) {
        ctx.process.stdout.write(
          `No response from the browser after ${waited}.\n` +
            `Press r to open the browser again, d to use a device code, Ctrl-C to cancel.\n`,
        );
        const key = await choice.key;
        choice.restore();
        if (key === 'restart')
          return pkceLogin(ctx, scope, workspace, screenHint);
        if (key === 'device') return deviceCodeLogin(ctx, scope, workspace);
        ctx.logger.error('Cancelled.');
        ctx.process.exitCode = EXIT_CANCELLED;
        return false;
      }
      ctx.process.stdout.write(
        `No response from the browser after ${waited}. Using a device code instead.\n`,
      );
      return deviceCodeLogin(ctx, scope, workspace);
    }
    ctx.logger.error(
      outcome.err instanceof Error
        ? outcome.err.message
        : 'Authentication failed.',
    );
    ctx.process.exitCode = 1;
    return false;
  }
  const authCode = outcome.code;

  // 6. Exchange code for tokens
  try {
    const tokenRes = await fetch(`${apiUrl}/v1/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: redirectUri,
        client_id: CLI_CLIENT_ID,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      throw new Error(`Token exchange failed (${tokenRes.status}): ${errBody}`);
    }

    const tokenData = (await tokenRes.json()) as OAuthTokenResponse;

    return await saveTokensAndFinish(ctx, tokenData, workspace);
  } catch (err) {
    ctx.process.stdout.write('\n');
    ctx.logger.error(
      err instanceof Error ? err.message : 'Token exchange failed.',
    );
    ctx.process.exitCode = 1;
    return false;
  }
}

async function deviceCodeLogin(
  ctx: LocalContext,
  scope: string,
  workspace?: string,
): Promise<boolean> {
  try {
    // 1. Request device code
    const device = await requestDeviceCode(scope);

    // 2. Display code and URL. A url_key rides on the URL so auth-web can
    // skip its workspace picker for a member (internal); the approval itself
    // names no workspace.
    let visit = device.verification_uri;
    if (workspace !== undefined && looksLikeUrlKey(workspace)) {
      try {
        const url = new URL(device.verification_uri);
        url.searchParams.set('workspace', workspace);
        visit = url.toString();
      } catch {
        // Not a URL we can extend: the picker stays, the login still works.
      }
    }
    ctx.process.stdout.write(`\nVisit: ${chalk.cyan(visit)}\n`);
    ctx.process.stdout.write(
      `Enter code: ${chalk.bold.yellow(device.user_code)}\n\n`,
    );

    const deviceDeadline = Date.now() + device.expires_in * 1000;
    const deviceTimer = setInterval(() => {
      const remaining = deviceDeadline - Date.now();
      ctx.process.stdout.write(
        `\rWaiting for authorization... ${chalk.dim(`(${formatCountdown(remaining)})`)}`,
      );
    }, 1000);
    ctx.process.stdout.write(
      `Waiting for authorization... ${chalk.dim(`(${formatCountdown(device.expires_in * 1000)})`)}`,
    );

    // 3. Poll for approval
    let tokenData: OAuthTokenResponse;
    try {
      tokenData = await pollForDeviceToken({
        deviceCode: device.device_code,
        interval: device.interval,
        expiresIn: device.expires_in,
      });
    } catch (err) {
      clearInterval(deviceTimer);
      throw err;
    }
    clearInterval(deviceTimer);

    return await saveTokensAndFinish(ctx, tokenData, workspace);
  } catch (err) {
    ctx.process.stdout.write('\n');
    ctx.logger.error(
      err instanceof Error ? err.message : 'Device flow failed.',
    );
    ctx.process.exitCode = 1;
    return false;
  }
}

async function saveTokensAndFinish(
  ctx: LocalContext,
  tokenData: OAuthTokenResponse,
  workspace?: string,
): Promise<boolean> {
  const apiUrl = getApiUrl();

  // Configure SDK client with the new token
  configureClient({ token: tokenData.access_token, type: 'jwt' });

  // User info comes from the enriched token response (identity from UserAccount)
  const user = tokenData.user;
  if (!user) {
    ctx.process.stdout.write('\n');
    ctx.logger.error('Token response missing user data.');
    ctx.process.exitCode = 1;
    return false;
  }

  // internal: the hint is resolved BEFORE anything is written, by key or
  // name exactly as `mcp add --workspace` resolves it. An unknown workspace
  // is fail_closed: no credentials, no selection — a bad --workspace has no
  // effect on any surface.
  let selected: WorkspaceSite | undefined;
  if (workspace !== undefined) {
    let sites: WorkspaceSite[];
    try {
      sites = await fetchSites();
    } catch (err) {
      // A lookup that failed is not a workspace that does not exist: say so,
      // and keep nothing either way.
      ctx.process.stdout.write('\n');
      ctx.logger.error(
        `${err instanceof Error ? err.message : 'Could not list your workspaces.'}\n` +
          'Nothing was saved. Try again.',
      );
      ctx.process.exitCode = 1;
      return false;
    }
    try {
      selected = findWorkspaceByKeyOrName(sites, workspace);
    } catch (err) {
      ctx.process.stdout.write('\n');
      ctx.logger.error(
        `${err instanceof Error ? err.message : 'Unknown workspace.'}\n` +
          "Nothing was saved. Run 'levr auth login --workspace <url_key>' " +
          "with one of them, or 'levr auth login' to choose later.",
      );
      ctx.process.exitCode = 1;
      return false;
    }
  }

  const creds: StoredCredentials = {
    version: 1,
    api_url: apiUrl,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: new Date(
      Date.now() + tokenData.expires_in * 1000,
    ).toISOString(),
    user: {
      id: user.id,
      email: user.email,
      workspace_id: user.workspace_id,
    },
  };

  writeCredentials(creds);

  ctx.process.stdout.write(` ${chalk.green('done')}\n\n`);
  ctx.logger.success(`Logged in as ${chalk.bold(user.email)}`);
  ctx.process.stdout.write('Credentials saved.\n');

  if (selected) {
    saveWorkspace(selected.workspace_id);
    ctx.process.stdout.write(
      `Workspace: ${chalk.bold(selected.workspace_name)} (${selected.workspace_url_key})\n`,
    );
    return true;
  }

  // Auto-select workspace if only one available
  const wsResult = await autoSelectWorkspace();
  if (wsResult.kind === 'single') {
    ctx.process.stdout.write(
      `Workspace: ${chalk.bold(wsResult.workspaceName)}\n`,
    );
  } else if (wsResult.kind === 'multiple') {
    ctx.process.stdout.write(
      `\n${wsResult.count} workspaces available. Run ${chalk.cyan("'levr workspace list'")} to see them.\n`,
    );
  }

  return true;
}
