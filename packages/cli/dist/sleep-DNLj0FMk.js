//#region src/utils/sleep.ts
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

//#endregion
export { sleep };