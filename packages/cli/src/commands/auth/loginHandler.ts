import { randomBytes } from 'node:crypto';
import chalk from 'chalk';
import type { LocalContext } from '../../context.js';
import {
  generateCodeVerifier,
  generateCodeChallenge,
} from '../../auth/pkce.js';
import { startCallbackServer } from '../../auth/localhost-server.js';
import {
  requestDeviceCode,
  pollForDeviceToken,
} from '../../auth/device-flow.js';
import { writeCredentials } from '../../auth/credentials.js';
import { autoSelectWorkspace } from '../../workspace/resolve-workspace.js';
import { getApiUrl, getAuthUrl, CLI_CLIENT_ID } from '../../utils/env.js';
import { configureClient } from '../../utils/sdk-client.js';
import type {
  OAuthTokenResponse,
  StoredCredentials,
} from '../../types/auth-types.js';

interface LoginFlags {
  'device-code': boolean;
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
  if (flags['device-code']) {
    await deviceCodeLogin(this);
    return;
  }

  await pkceLogin(this);
}

async function pkceLogin(ctx: LocalContext): Promise<void> {
  const apiUrl = getApiUrl();
  const authUrl = getAuthUrl();

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
    scope: 'read:own write:own',
    state,
  });
  // auth-web uses React Router basename '/auth/' — all routes resolve under
  // /auth/, so the consent page is at /auth/oauth/authorize.
  const authorizeUrl = `${authUrl}/auth/oauth/authorize?${params.toString()}`;

  // 4. Open browser
  ctx.process.stdout.write('Opening browser to authenticate...\n\n');
  ctx.process.stdout.write(
    `  If the browser doesn't open, visit:\n  ${chalk.cyan(authorizeUrl)}\n\n`,
  );

  try {
    const open = await import('open');
    await open.default(authorizeUrl);
  } catch {
    // Browser open failed — user can manually visit the URL
  }

  // 5. Wait for callback with countdown
  const timeoutMs = 120_000;
  const deadline = Date.now() + timeoutMs;
  const countdownTimer = setInterval(() => {
    const remaining = deadline - Date.now();
    ctx.process.stdout.write(
      `\rWaiting for authentication... ${chalk.dim(`(${formatCountdown(remaining)})`)}`,
    );
  }, 1000);
  ctx.process.stdout.write(
    `Waiting for authentication... ${chalk.dim(`(${formatCountdown(timeoutMs)})`)}`,
  );

  let authCode: string;
  try {
    const result = await codePromise;
    authCode = result.code;
  } catch (err) {
    close();
    clearInterval(countdownTimer);
    ctx.process.stdout.write('\n');
    ctx.logger.error(
      err instanceof Error ? err.message : 'Authentication failed.',
    );
    ctx.process.exitCode = 1;
    return;
  }
  clearInterval(countdownTimer);

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

    await saveTokensAndFinish(ctx, tokenData);
  } catch (err) {
    ctx.process.stdout.write('\n');
    ctx.logger.error(
      err instanceof Error ? err.message : 'Token exchange failed.',
    );
    ctx.process.exitCode = 1;
  }
}

async function deviceCodeLogin(ctx: LocalContext): Promise<void> {
  try {
    // 1. Request device code
    const device = await requestDeviceCode();

    // 2. Display code and URL
    ctx.process.stdout.write(
      `\nVisit: ${chalk.cyan(device.verification_uri)}\n`,
    );
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

    await saveTokensAndFinish(ctx, tokenData);
  } catch (err) {
    ctx.process.stdout.write('\n');
    ctx.logger.error(
      err instanceof Error ? err.message : 'Device flow failed.',
    );
    ctx.process.exitCode = 1;
  }
}

async function saveTokensAndFinish(
  ctx: LocalContext,
  tokenData: OAuthTokenResponse,
): Promise<void> {
  const apiUrl = getApiUrl();

  // Configure SDK client with the new token
  configureClient({ token: tokenData.access_token, type: 'jwt' });

  // User info comes from the enriched token response (identity from UserAccount)
  const user = tokenData.user;
  if (!user) {
    ctx.process.stdout.write('\n');
    ctx.logger.error('Token response missing user data.');
    ctx.process.exitCode = 1;
    return;
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
}
