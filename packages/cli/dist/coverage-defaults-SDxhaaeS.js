//#region src/commands/gates/coverage-defaults.ts
/**
* Changed files `levr gates changed-coverage` never measures (ENG-7618 D4.2).
* A leaf module with no imports, so the command's `--help` text can print the
* list without loading the handler (commands stay lazily loaded).
* `--exclude` adds to it. Tests, declarations, generated code, fixtures,
* migrations, config files, Rust integration tests and build scripts.
*/
const COVERAGE_DEFAULT_EXCLUDES = [
	"*.test.ts",
	"*.test.tsx",
	"*.spec.ts",
	"*.e2e-spec.ts",
	"*.d.ts",
	"**/src/gen/**",
	"**/__fixtures__/**",
	"**/migrations/**",
	"*.config.ts",
	"**/tests/**/*.rs",
	"build.rs"
];

//#endregion
export { COVERAGE_DEFAULT_EXCLUDES };