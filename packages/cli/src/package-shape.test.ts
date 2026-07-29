import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pkg = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
    'utf8',
  ),
) as { name: string; bin: Record<string, string> };

/**
 * `npx @levr-one/cli <cmd>` — the form used throughout both READMEs and the
 * CI snippets — resolves to a bin by npm's rules in
 * libnpmexec/lib/get-bin-from-manifest.js:
 *
 *   1. exactly one distinct bin target  -> use it, whatever it is named
 *   2. else a bin named after the UNSCOPED package name -> use that
 *   3. else throw "could not determine executable to run"
 *
 * We publish as `@levr-one/cli`, whose unscoped name is `cli`, and our bin is
 * named `levr`. So rule 2 can never save us: we depend entirely on rule 1.
 *
 * Adding a second bin with a different target would therefore break every
 * documented `npx @levr-one/cli …` invocation at once — for users, not at
 * build time. Verified against npm 10.8.2, 10.9.8, 11.16.0 and 12.0.1.
 *
 * If you genuinely need a second bin, the docs must move to the explicit
 * `npx -p @levr-one/cli levr …` form first.
 */
describe('published package shape', () => {
  it('declares exactly one bin target so `npx @levr-one/cli` can resolve it', () => {
    const targets = new Set(Object.values(pkg.bin));

    expect(targets.size).toBe(1);
  });

  it('names that bin `levr`', () => {
    expect(Object.keys(pkg.bin)).toEqual(['levr']);
  });

  // Belt and braces: if a future rename ever makes the unscoped package name
  // match a bin key, rule 2 would start covering us and the constraint above
  // could be relaxed deliberately rather than by accident.
  it('cannot rely on npm rule 2 — the unscoped name is not a bin key', () => {
    const unscoped = pkg.name.replace(/^@[^/]+\//, '');

    expect(unscoped).toBe('cli');
    expect(Object.keys(pkg.bin)).not.toContain(unscoped);
  });
});
