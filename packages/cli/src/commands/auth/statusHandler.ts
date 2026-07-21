import chalk from 'chalk';
import type { LocalContext } from '../../context.js';
import { getPatToken, getApiUrl } from '../../utils/env.js';
import { readCredentials } from '../../auth/credentials.js';
import { isTokenExpired } from '../../auth/token-refresh.js';
import { configureClient } from '../../utils/sdk-client.js';
import { authGetProfileV1 } from '@levr/sdk';

export async function statusHandler(this: LocalContext): Promise<void> {
  const apiUrl = getApiUrl();
  const pat = getPatToken();

  // 1. Check PAT
  if (pat) {
    const reachable = await checkApiReachable(pat, 'pat');
    if (reachable) {
      this.process.stdout.write(
        `${chalk.green('ok')}    Authenticated via LEVR_TOKEN (PAT)\n`,
      );
      this.process.stdout.write(`  API:  ${apiUrl} (reachable)\n`);
    } else {
      this.process.stdout.write(
        `${chalk.yellow('warn')}  LEVR_TOKEN is set but API is unreachable\n`,
      );
      this.process.stdout.write(`  API:  ${apiUrl}\n`);
    }
    return;
  }

  // 2. Check stored credentials
  const creds = readCredentials();
  if (!creds) {
    this.process.stdout.write(
      `${chalk.red('error')} Not authenticated. Run 'levr auth login' or set LEVR_TOKEN.\n`,
    );
    this.process.exitCode = 1;
    return;
  }

  if (isTokenExpired(creds)) {
    this.process.stdout.write(
      `${chalk.red('error')} Token expired. Run 'levr auth login' to re-authenticate.\n`,
    );
    this.process.exitCode = 1;
    return;
  }

  // 3. Validate token and show status
  const reachable = await checkApiReachable(creds.access_token, 'jwt');
  const expiresAt = new Date(creds.expires_at);
  const hoursLeft = Math.max(
    0,
    Math.round((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60)),
  );

  this.process.stdout.write(
    `${chalk.green('ok')}    Authenticated as ${chalk.bold(creds.user.email)}\n`,
  );
  this.process.stdout.write(
    `  API:   ${apiUrl}${reachable ? ' (reachable)' : ' (unreachable)'}\n`,
  );
  this.process.stdout.write(
    `  Auth:  JWT via credentials file (expires in ${hoursLeft}h)\n`,
  );
}

async function checkApiReachable(
  token: string,
  type: 'pat' | 'jwt',
): Promise<boolean> {
  try {
    configureClient({ token, type });
    const result = await authGetProfileV1();
    return !result.error;
  } catch {
    return false;
  }
}
