import { getApiUrl } from "./env-CHeKHu5S.js";
import { configureClient, testCaseImportCommitV1, testCaseImportPreviewV1 } from "./sdk-client-CMIYlzY7.js";
import "./workspace-store-DDOxnut1.js";
import { resolveWorkspace } from "./resolve-workspace-9bEIfK0D.js";
import "./token-refresh-Cu5RpkLJ.js";
import { resolveToken } from "./resolve-token-DbQsmn03.js";
import chalk from "chalk";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import ora from "ora";

//#region src/utils/import-mapping.ts
const IMPORT_TARGETS = [
	"row_type",
	"test_id",
	"test_key",
	"folder_id",
	"folder_path",
	"folder_name",
	"test_name",
	"test_description",
	"test_type",
	"case_type_id",
	"case_type_name",
	"test_priority",
	"estimate",
	"is_automated",
	"assignee_email",
	"labels",
	"attachment_filenames",
	"data_set_names",
	"sequence",
	"item_id",
	"method",
	"expected_result",
	"keyword",
	"shared_step_id",
	"shared_precondition_id",
	"data_table",
	"steps",
	"preconditions"
];
const REQUIRED_TARGETS = ["test_name"];
/**
* Parse a --map value: "Source Column=target", "Source Column=" (drop),
* or "Source Column=labels:prefix" (import-as-labels: each value becomes
* the label "prefix:value", preserving the column's provenance).
*/
function parseMapFlag(pair) {
	const separator = pair.indexOf("=");
	if (separator <= 0) throw new Error(`Invalid --map "${pair}" — expected "Source Column=target_field" (or "Source Column=" to drop, or "Source Column=labels:prefix" to import values as prefixed labels).`);
	const column = pair.slice(0, separator).trim();
	const raw = pair.slice(separator + 1).trim();
	if (raw === "") return {
		column,
		target: null
	};
	if (raw.startsWith("labels:")) {
		const labelPrefix = raw.slice(7).trim();
		if (!labelPrefix) throw new Error(`Invalid --map "${pair}" — "labels:" needs a prefix (e.g. "State=labels:state").`);
		return {
			column,
			target: "labels",
			labelPrefix
		};
	}
	const target = IMPORT_TARGETS.find((t) => t === raw);
	if (!target) throw new Error(`Invalid --map target "${raw}". Valid targets: ${IMPORT_TARGETS.join(", ")} (labels also accepts "labels:prefix")`);
	return {
		column,
		target
	};
}
/** Apply overrides (from --map / --mapping-file) onto the proposed mapping. */
function applyOverrides(mapping, overrides) {
	const result = mapping.map((entry) => ({ ...entry }));
	for (const override of overrides) {
		const entry = result.find((m) => m.originalName === override.column);
		if (!entry) throw new Error(`--map column "${override.column}" not found in the file. Columns: ${result.map((m) => m.originalName).join(", ")}`);
		entry.targetProperty = override.target;
		entry.matchType = override.target ? "manual" : "unmapped";
		entry.confidence = override.target ? 1 : 0;
		entry.labelPrefix = override.labelPrefix;
	}
	return result;
}
/** Required targets not covered by any mapped column. */
function missingRequired(mapping) {
	const covered = new Set(mapping.map((m) => m.targetProperty).filter(Boolean));
	return REQUIRED_TARGETS.filter((t) => !covered.has(t));
}
/** Columns worth walking interactively: unmapped, or LLM guesses < 0.7. */
function columnsNeedingReview(mapping) {
	return mapping.filter((m) => m.targetProperty === null || m.matchType === "llm" && m.confidence < .7);
}

//#endregion
//#region src/commands/importHandler.ts
const MATCH_COLORS = {
	exact: chalk.green,
	prefix: chalk.green,
	preset: chalk.green,
	fuzzy: chalk.yellow,
	llm: chalk.magenta,
	unmapped: chalk.red,
	manual: chalk.green
};
/** Stream the file into a Blob — no readFileSync, no sync stall. */
async function fileToBlob(path) {
	const chunks = [];
	for await (const chunk of createReadStream(path)) chunks.push(chunk);
	return new Blob(chunks);
}
function printMapping(logger, mapping) {
	const width = Math.max(...mapping.map((m) => m.originalName.length), 13);
	logger.info("");
	logger.info(chalk.bold(`  ${"SOURCE COLUMN".padEnd(width)}  →  ${"TARGET".padEnd(24)} MATCH`));
	for (const m of mapping) {
		const color = MATCH_COLORS[m.matchType] ?? chalk.white;
		const target = m.targetProperty ?? "— unmapped —";
		const badge = m.matchType === "unmapped" ? "unmapped" : `${m.matchType} ${Math.round(m.confidence * 100)}%`;
		logger.info(`  ${m.originalName.padEnd(width)}  →  ${target.padEnd(24)} ${color(badge)}`);
	}
	logger.info("");
}
async function pickTarget(rl, logger, column) {
	logger.info(chalk.bold(`"${column.originalName}" is ${column.targetProperty ? `mapped to ${column.targetProperty} (low confidence)` : "unmapped"}.`));
	const columns = 3;
	const cellWidth = 26;
	for (let i = 0; i < IMPORT_TARGETS.length; i += columns) logger.info("  " + IMPORT_TARGETS.slice(i, i + columns).map((t, j) => `${String(i + j + 1).padStart(2)}) ${t}`.padEnd(cellWidth)).join(""));
	for (;;) {
		const answer = (await rl.question("Target number or name (blank = skip/drop this column): ")).trim();
		if (answer === "") return null;
		const byNumber = IMPORT_TARGETS[Number(answer) - 1];
		if (byNumber && String(Number(answer)) === answer) return byNumber;
		const byName = IMPORT_TARGETS.find((t) => t === answer.toLowerCase());
		if (byName) return byName;
		logger.info(chalk.red(`  "${answer}" is not a valid target — try again.`));
	}
}
async function importHandler(flags, file) {
	if (flags.verbose) this.logger.setVerbose(true);
	if (!file && !flags["sheets-url"]) {
		this.logger.error("Provide a file path or --sheets-url.");
		this.process.exitCode = 1;
		return;
	}
	if (file && flags["sheets-url"]) {
		this.logger.error("Provide a file OR --sheets-url, not both.");
		this.process.exitCode = 1;
		return;
	}
	let auth;
	try {
		auth = await resolveToken();
	} catch (err) {
		this.logger.error(err instanceof Error ? err.message : "Authentication failed.");
		this.process.exitCode = 1;
		return;
	}
	configureClient(auth);
	if (flags.verbose) {
		this.logger.debug(`Auth: ${auth.type.toUpperCase()}`);
		this.logger.debug(`API:  ${getApiUrl()}`);
	}
	if (auth.type === "jwt") {
		if (!await resolveWorkspace.call(this, flags["workspace-id"])) {
			this.process.exitCode = 1;
			return;
		}
	}
	const spinner = ora("Uploading and analyzing the file…").start();
	let preview;
	try {
		const body = {
			team_id: flags["team-id"],
			format: flags.format,
			sheets_url: flags["sheets-url"]
		};
		if (file) {
			const blob = await fileToBlob(file);
			body["file"] = new File([blob], basename(file));
		}
		const result = await testCaseImportPreviewV1({
			body,
			requestValidator: void 0
		});
		if (result.error || !result.data) throw new Error(result.error?.message ?? `Preview failed (HTTP ${result.response?.status ?? "?"}).`);
		preview = result.data;
		spinner.succeed(`${preview.filename} (${preview.format}) — ${preview.row_count} data rows detected`);
	} catch (err) {
		spinner.fail(err instanceof Error ? err.message : "Preview failed.");
		this.process.exitCode = 1;
		return;
	}
	let mapping;
	try {
		const overrides = (flags.map ?? []).map(parseMapFlag);
		if (flags["mapping-file"]) {
			const saved = JSON.parse(await readFile(flags["mapping-file"], "utf8"));
			overrides.push(...saved);
		}
		mapping = applyOverrides(preview.proposed_mapping, overrides);
	} catch (err) {
		this.logger.error(err instanceof Error ? err.message : String(err));
		this.process.exitCode = 1;
		return;
	}
	printMapping(this.logger, mapping);
	if (!flags.yes && process.stdin.isTTY === true) {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout
		});
		try {
			for (const column of columnsNeedingReview(mapping)) {
				const target = await pickTarget(rl, this.logger, column);
				mapping = applyOverrides(mapping, [{
					column: column.originalName,
					target
				}]);
			}
			while (missingRequired(mapping).length > 0) {
				this.logger.info(chalk.red(`Required field(s) uncovered: ${missingRequired(mapping).join(", ")}. Every test case needs a name.`));
				const source = (await rl.question(`Which source column holds the test name? (${mapping.map((m) => m.originalName).join(", ")}): `)).trim();
				const entry = mapping.find((m) => m.originalName === source);
				if (!entry) {
					this.logger.info(chalk.red(`  "${source}" is not a column — try again.`));
					continue;
				}
				mapping = applyOverrides(mapping, [{
					column: entry.originalName,
					target: "test_name"
				}]);
			}
			printMapping(this.logger, mapping);
			const confirm = (await rl.question("Commit this import? [y/N]: ")).trim().toLowerCase();
			if (confirm !== "y" && confirm !== "yes") {
				this.logger.info("Aborted — nothing was written.");
				return;
			}
		} finally {
			rl.close();
		}
	} else if (missingRequired(mapping).length > 0) {
		this.logger.error(`Required field(s) uncovered: ${missingRequired(mapping).join(", ")}. Map them with --map "Source Column=test_name" (non-interactive runs cannot prompt).`);
		this.process.exitCode = 1;
		return;
	}
	if (flags["save-mapping"]) {
		await writeFile(flags["save-mapping"], JSON.stringify(mapping.map((m) => ({
			column: m.originalName,
			target: m.targetProperty
		})), null, 2) + "\n");
		this.logger.info(`Confirmed mapping saved to ${flags["save-mapping"]}`);
	}
	const commitSpinner = ora("Committing import…").start();
	let outcome;
	try {
		const result = await testCaseImportCommitV1({
			body: {
				token: preview.token,
				confirmed_mapping: mapping
			},
			requestValidator: void 0
		});
		if (result.error || !result.data) throw new Error(result.error?.message ?? `Commit failed (HTTP ${result.response?.status ?? "?"}).`);
		outcome = result.data;
	} catch (err) {
		commitSpinner.fail(err instanceof Error ? err.message : "Commit failed.");
		this.process.exitCode = 1;
		return;
	}
	const { stats } = outcome;
	if (outcome.status === "failed") commitSpinner.fail(`Import failed — 0 of ${stats.rows_processed} rows imported.`);
	else commitSpinner.succeed(`Import ${outcome.status.replace(/_/g, " ")}: ${stats.tests_created} tests, ${stats.folders_created} folders, ${stats.steps_created} steps, ${stats.preconditions_created} preconditions (${stats.rows_failed} rows failed)`);
	for (const warning of outcome.warnings) this.logger.info(chalk.yellow(`  warning: ${warning.message}`));
	for (const error of outcome.errors) this.logger.info(chalk.red(`  error: ${error.message}`));
	if (outcome.status === "failed") this.process.exitCode = 1;
}

//#endregion
export { importHandler };