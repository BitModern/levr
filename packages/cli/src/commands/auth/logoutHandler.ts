import type { LocalContext } from '../../context.js';
import { deleteCredentials } from '../../auth/credentials.js';
import { clearWorkspace } from '../../workspace/workspace-store.js';
import { getPatToken } from '../../utils/env.js';

export function logoutHandler(this: LocalContext): void {
  const deleted = deleteCredentials();
  clearWorkspace();

  if (deleted) {
    this.logger.success('Logged out. Credentials removed.');
  } else {
    this.logger.info('No stored credentials found.');
  }

  if (getPatToken()) {
    this.process.stdout.write(
      'Note: LEVR_TOKEN environment variable is still set.\n',
    );
  }
}
