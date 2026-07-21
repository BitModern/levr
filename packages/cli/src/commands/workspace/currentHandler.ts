import type { LocalContext } from '../../context.js';
import { loadWorkspace } from '../../workspace/workspace-store.js';

export function currentHandler(this: LocalContext): void {
  const workspaceId = loadWorkspace();

  if (workspaceId) {
    this.process.stdout.write(`Current workspace: ${workspaceId}\n`);
  } else {
    this.process.stdout.write('No workspace selected.\n');
  }
}
