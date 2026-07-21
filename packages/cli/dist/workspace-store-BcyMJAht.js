import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

//#region src/workspace/workspace-store.ts
const WORKSPACE_PATH = join(join(homedir(), ".config", "levr"), "workspace.json");
function loadWorkspace() {
	try {
		const raw = readFileSync(WORKSPACE_PATH, "utf8");
		const data = JSON.parse(raw);
		return typeof data.workspace_id === "string" ? data.workspace_id : null;
	} catch {
		return null;
	}
}
function saveWorkspace(workspaceId) {
	mkdirSync(dirname(WORKSPACE_PATH), { recursive: true });
	const tmp = WORKSPACE_PATH + ".tmp";
	writeFileSync(tmp, JSON.stringify({ workspace_id: workspaceId }, null, 2), { mode: 384 });
	renameSync(tmp, WORKSPACE_PATH);
}
function clearWorkspace() {
	try {
		unlinkSync(WORKSPACE_PATH);
	} catch {}
}

//#endregion
export { clearWorkspace, loadWorkspace, saveWorkspace };