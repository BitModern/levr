#!/usr/bin/env node
import { app, buildContext } from "./app-0F0Zyyt7.js";
import { proposeCompletions } from "@stricli/core";

//#region src/bin/bash-complete.ts
const inputs = process.argv.slice(3);
if (process.env["COMP_LINE"]?.endsWith(" ")) inputs.push("");
try {
	for (const { completion } of await proposeCompletions(app, inputs, buildContext(process))) process.stdout.write(`${completion}\n`);
} catch {}

//#endregion
export {  };