// @ts-check
import eslint from '@eslint/js';
import importX from 'eslint-plugin-import-x';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'dist/**/*', 'tsdown.config.ts'],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // internal: every `@levr/*` this package VALUE-imports is inlined into
  // dist/ by tsdown `noExternal: [/^@testlm\//]`.
  //
  // This rule is NOT what keeps the export pipeline's lists in sync — that is
  // scripts/check-export-bundled-deps.ts, which walks the module graph and
  // never reads this package's declared dependencies at all. Deleting a
  // `@levr/*` entry from package.json would not change what that guard
  // derives. (An earlier design did walk declarations; this comment described
  // it long after that approach was dropped.)
  //
  // What the rule buys is narrower and still worth having: an import of a
  // workspace declared in NEITHER dependency section fails here, at lint time,
  // instead of at `yarn workspaces focus` inside the export build.
  //
  // `devDependencies` is deliberately left at its default (true). The bundled
  // `@levr/*` are build INPUTS, not runtime deps — `noExternal` inlines them
  // into dist/, nothing resolves them at runtime, and
  // scripts/export/levr.mjs strips all three from BOTH manifest sections of
  // the published package. devDependencies is their correct home, so the rule
  // must permit importing them from src/. It still errors on a workspace
  // declared in neither section, which is the case worth catching.
  //
  // `includeTypes` is left at its default (false) deliberately: a type-only
  // import is erased at build and never inlined, so it neither needs to be
  // declared nor belongs in the derived set. The rule's default exemption
  // matches the bundler's erasure semantics exactly.
  {
    plugins: { 'import-x': importX },
    rules: {
      'import-x/no-extraneous-dependencies': 'error',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
);
