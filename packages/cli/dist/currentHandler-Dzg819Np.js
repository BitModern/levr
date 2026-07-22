import { loadWorkspace } from "./workspace-store-BcyMJAht.js";

//#region src/commands/workspace/currentHandler.ts
function currentHandler() {
	const workspaceId = loadWorkspace();
	if (workspaceId) this.process.stdout.write(`Current workspace: ${workspaceId}\n`);
	else this.process.stdout.write("No workspace selected.\n");
}

//#endregion
export { currentHandler };