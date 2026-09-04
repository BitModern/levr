/**
 * The inlined logos must match the assets auth-web actually ships.
 *
 * internal rebranded auth-web to Levr. `Logo.tsx` moved to
 * `levr-logo-{light,dark}.png`; this package's hand-pasted base64 copy did
 * not, so the CLI's OAuth success page still showed the "TestQuality AI"
 * wordmark. Nothing caught it: the tsdown brand SCRUB rewrites string
 * literals, and a wordmark inside a PNG is pixels, so the stale logo shipped
 * in the published binary too.
 *
 * Comparing bytes is the only check that can see this. A test asserting "the
 * data URI is non-empty", or that the HTML contains an <img>, passes happily
 * on the wrong brand.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(here, 'localhost-server.ts');
const IMAGES = resolve(here, '../../../../apps/auth-web/public/images');

function embedded(name: string): Buffer {
  const src = readFileSync(SOURCE, 'utf8');
  const m = new RegExp(
    `${name} = 'data:image/png;base64,([A-Za-z0-9+/=]+)'`,
  ).exec(src);
  if (!m) throw new Error(`${name} not found in localhost-server.ts`);
  return Buffer.from(m[1]!, 'base64');
}

const sha = (b: Buffer): string => createHash('sha1').update(b).digest('hex');

describe('inlined OAuth-page logos', () => {
  const cases: [string, string][] = [
    ['LOGO_LIGHT_DATA_URI', 'levr-logo-light.png'],
    ['LOGO_DARK_DATA_URI', 'levr-logo-dark.png'],
  ];

  it.each(cases)('%s is byte-identical to %s', (constant, file) => {
    // Deliberately NO existsSync skip. The first version of this test skipped
    // when the asset was missing, reasoning that the published package is
    // extracted without the monorepo around it — but `files` is
    // ["dist","README.md"], so tests never ship and that case cannot happen.
    // What the skip DID do was make the whole guard vacuous whenever the
    // images moved: with the directory renamed it reported "3 passed" while
    // asserting nothing. readFileSync throwing ENOENT is the correct, loud
    // failure.
    const asset = readFileSync(resolve(IMAGES, file));
    expect(asset.byteLength, `${file} is empty`).toBeGreaterThan(0);
    expect(
      sha(embedded(constant)),
      `${constant} no longer matches ${file} — re-inline it after a rebrand`,
    ).toBe(sha(asset));
  });

  it('embeds no retired TestQuality wordmark', () => {
    // Pinned by literal SHA, NOT by reading the files.
    //
    // Reading them made this guard depend on assets that are SCHEDULED FOR
    // DELETION: specs/plans/auth-web-levr-rebrand-internal/plan.md defers
    // removing the legacy tq-logo-*.png to a follow-up commit. The `continue`
    // that guarded the read would then skip every entry and this test would
    // assert NOTHING while still reporting green — disarmed by an unrelated
    // cleanup, which is the worst way for a guard to die.
    //
    // A hash of a retired file is a fact that does not expire.
    const RETIRED: [string, string][] = [
      ['tq-logo-light-ai.png', '2d08b8af520326b4f4d356c9148f33fa1303d804'],
      ['tq-logo-dark-ai.png', '0005211bbfd5aee6417a414d339f66da68e5fbca'],
    ];
    for (const [name, retiredSha] of RETIRED) {
      for (const [constant] of cases) {
        expect(
          sha(embedded(constant)),
          `${constant} is still the retired ${name}`,
        ).not.toBe(retiredSha);
      }
    }
  });
});
