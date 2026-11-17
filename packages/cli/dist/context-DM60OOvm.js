import chalk from "chalk";

//#region src/utils/logger.ts
var Logger = class {
	verbose;
	stdout;
	stderr;
	constructor(options) {
		this.verbose = options.verbose ?? false;
		this.stdout = options.stdout ?? process.stdout;
		this.stderr = options.stderr ?? process.stderr;
	}
	info(message) {
		this.stdout.write(`${chalk.blue("info")}  ${message}\n`);
	}
	success(message) {
		this.stdout.write(`${chalk.green("ok")}    ${message}\n`);
	}
	error(message) {
		this.stderr.write(`${chalk.red("error")} ${message}\n`);
	}
	warning(message) {
		this.stdout.write(`${chalk.yellow("warn")}  ${message}\n`);
	}
	debug(message) {
		if (this.verbose) this.stdout.write(`${chalk.gray("debug")} ${message}\n`);
	}
	setVerbose(verbose) {
		this.verbose = verbose;
	}
};

//#endregion
//#region src/context.ts
function buildContext(process$1) {
	return {
		process: process$1,
		logger: new Logger({
			verbose: false,
			stdout: process$1.stdout,
			stderr: process$1.stderr
		})
	};
}

//#endregion
export { buildContext };