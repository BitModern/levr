import { authGetSitesV1 } from '@levr/sdk';
import type { SitesResponseDto } from '@levr/sdk';
import chalk from 'chalk';
import type { LocalContext } from '../context.js';
import {
  resolveToken,
  CredentialsMismatchError,
} from '../auth/resolve-token.js';
import { performLogin } from './auth/loginHandler.js';
import { printSites } from './workspace/listHandler.js';
import { setSessionApiUrl } from '../utils/env.js';
import { configureClient } from '../utils/sdk-client.js';
import type { ResolvedAuth } from '../types/auth-types.js';

interface InitFlags {
  'device-code': boolean;
  url?: string;
}

/**
 * First-run onboarding: authenticate if needed, then list workspaces.
 * Composes the existing login flow (loginHandler's performLogin) with the
 * workspace listing (listHandler's printSites) — absorbs the retired
 * @levr-one/setup flow (internal).
 */
export async function initHandler(
  this: LocalContext,
  flags: InitFlags,
): Promise<void> {
  if (flags.url) {
    setSessionApiUrl(flags.url);
  }

  // 1. Auth-if-needed: reuse LEVR_TOKEN or stored credentials; only run the
  // interactive login flow when neither resolves.
  let auth: ResolvedAuth;
  try {
    auth = await resolveToken();
    this.logger.success('Already authenticated.');
  } catch (resolveError) {
    // For init, a cross-env mismatch is recoverable — a fresh login against
    // the new target is exactly what onboarding should do — but say so
    // instead of silently ignoring the stored session (tester TC-8070).
    if (resolveError instanceof CredentialsMismatchError) {
      this.logger.warning(resolveError.message);
    }
    const loggedIn = await performLogin(this, {
      deviceCode: flags['device-code'],
    });
    if (!loggedIn) {
      // performLogin printed the error and set the exit code.
      return;
    }
    try {
      auth = await resolveToken();
    } catch (error) {
      this.logger.error(
        error instanceof Error ? error.message : 'Authentication failed.',
      );
      this.process.exitCode = 1;
      return;
    }
  }

  if (auth.type === 'pat') {
    this.logger.info(
      'Authenticated via LEVR_TOKEN (PAT). Workspace listing requires JWT ' +
        "auth — run 'levr auth login' to browse workspaces.",
    );
    return;
  }

  // 2. List workspaces
  configureClient(auth);
  const result = await authGetSitesV1();
  if (result.error) {
    this.logger.error('Failed to list workspaces.');
    this.process.exitCode = 1;
    return;
  }
  printSites(this, (result.data as SitesResponseDto).sites);

  this.process.stdout.write(
    `Next: ${chalk.cyan("'levr workspace select <id>'")} to pick a workspace, then ${chalk.cyan("'levr push <file>'")} to upload results.\n`,
  );
}
