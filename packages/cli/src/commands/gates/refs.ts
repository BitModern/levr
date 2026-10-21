import { buildCommand } from '@stricli/core';

export const gatesRefsCommand = buildCommand({
  docs: {
    brief:
      'Check that a symbol is declared in a scope and referenced elsewhere',
    fullDescription: `Find where a symbol is declared under --scope and count the references to it
from other modules, through the language's own tooling. This is the command a
symbol_referenced gate runs.

Exit code 0 when the symbol is declared in the scope and referenced from
outside its declaring file, 1 when it is not referenced or not found, and 2 for
a usage, scope or toolchain error.

--scope must be a directory (or file) inside the repository, narrower than the
repository root. References from test code are not counted unless
--include-tests is set.

Languages:
  ts    tsgo --lsp. Needs typescript and @typescript/native-preview installed
        in the checkout.
  rust  rust-analyzer. Needs \`rustup component add rust-analyzer\`; waits for
        indexing to finish (CODE_INTEL_RA_TIMEOUT_MS, default 300000).

Examples:
  levr gates refs --lang ts --symbol GateDefinitionSeeder --scope packages/db-core/src
  levr gates refs --lang rust --symbol used_helper --scope crates/core/src`,
  },
  parameters: {
    flags: {
      lang: {
        kind: 'parsed',
        parse: String,
        brief: 'Language engine: ts or rust',
        placeholder: 'lang',
      },
      symbol: {
        kind: 'parsed',
        parse: String,
        brief: 'Symbol name to resolve',
        placeholder: 'name',
      },
      scope: {
        kind: 'parsed',
        parse: String,
        brief: 'Directory to search for the declaration, inside the repository',
        placeholder: 'dir',
      },
      'include-tests': {
        kind: 'boolean',
        default: false,
        brief: 'Count references from test code',
      },
    },
  },
  loader: async () => {
    const { gatesRefsHandler } = await import('./refsHandler.js');
    return gatesRefsHandler;
  },
});
