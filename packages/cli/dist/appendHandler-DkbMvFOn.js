import { appendActualResult } from "./sdk-client-B_urshDp.js";
import "./env-CdwyPHGV.js";
import "./token-refresh-DeusLK8H.js";
import "./resolve-token-7xb7kG7h.js";
import "./workspace-store-CnrxyYRB.js";
import "./resolve-workspace-Dsm8Xzut.js";
import { connect } from "./connect-CPybjrXT.js";
import "./sleep-BpJ39Ypm.js";
import { embedMarkdown, parseTarget, uploadArtifactFile } from "./artifact-upload-BnqeVY_b.js";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

//#region src/commands/result/appendHandler.ts
/**
* `levr result append` (ENG-6164 D4, DD4). Uploads the --attach files first
* (private: Levr serves their url to signed-in members, so the embedded
* links render there; ENG-6165 code review F-006), then sends ONE server-side
* `append_actual_result` carrying the text plus a markdown link per file,
* through PATCH /v1/run/run-result-variant/:id — the only public append that
* needs no run or run-result id (audit A2). fail_closed: any failed upload
* or a failed append exits 1; nothing is appended when an upload failed.
*/
async function resultAppendHandler(flags, targetArg) {
	if (flags.verbose) this.logger.setVerbose(true);
	let target;
	try {
		target = parseTarget(targetArg);
	} catch (err) {
		this.logger.error(err instanceof Error ? err.message : String(err));
		this.process.exitCode = 1;
		return;
	}
	if (target.relatedType !== "run_result_variant") {
		this.logger.error("levr result append takes run_result_variant:<uuid> (an execution result id).");
		this.process.exitCode = 1;
		return;
	}
	if (flags.text === void 0 === (flags.file === void 0)) {
		this.logger.error("Provide exactly one of --text or --file.");
		this.process.exitCode = 1;
		return;
	}
	let text;
	try {
		text = flags.text ?? readFileSync(flags.file, "utf8");
	} catch (err) {
		this.logger.error(`Cannot read ${flags.file}: ${err instanceof Error ? err.message : String(err)}`);
		this.process.exitCode = 1;
		return;
	}
	if (!await connect(this, flags["workspace-id"])) return;
	const links = [];
	for (const file of flags.attach ?? []) {
		const result = await uploadArtifactFile({
			target,
			filePath: file
		});
		if ((result.status === "uploaded" || result.status === "deduplicated") && result.url) {
			links.push(embedMarkdown(basename(file), result.url));
			this.process.stdout.write(`  attached ${file} (${result.id})\n`);
			continue;
		}
		const why = result.status === "skipped" ? "larger than 50 MiB" : result.status === "missing" ? "not found" : "message" in result ? result.message : result.status;
		this.logger.error(`failed ${file}: ${why}`);
		this.process.exitCode = 1;
		return;
	}
	const appendText = [text.trimEnd(), ...links].filter((t) => t).join("\n");
	try {
		await appendActualResult(target.relatedId, appendText);
	} catch (err) {
		this.logger.error(err instanceof Error ? err.message : String(err));
		this.process.exitCode = 1;
		return;
	}
	this.process.stdout.write(`Appended to ${target.relatedId}${links.length ? ` with ${links.length} attachment(s)` : ""}.\n`);
}

//#endregion
export { resultAppendHandler };