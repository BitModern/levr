#!/usr/bin/env node
import { app, buildContext } from "./app-0F0Zyyt7.js";
import { run } from "@stricli/core";

//#region src/bin/cli.ts
let savedExitCode;
const processProxy = new Proxy(process, { set(target, prop, value) {
	if (prop === "exitCode" && typeof value === "number" && value !== 0) savedExitCode = value;
	return Reflect.set(target, prop, value);
} });
await run(app, process.argv.slice(2), buildContext(processProxy));
if (savedExitCode !== void 0) process.exitCode = savedExitCode;

//#endregion
export {  };