import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { executeInspect } from './inspect.js';

let root = '';

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

describe('gates inspect', () => {
  it('exits 1 when the inspected file lacks the keyword', () => {
    root = mkdtempSync(join(tmpdir(), 'gates-inspect-cmd-'));
    writeFileSync(join(root, 'note.txt'), 'alpha only\n');
    const result = executeInspect(
      JSON.stringify({
        op: 'inspect',
        check: 'contains',
        params: { path: 'note.txt', pattern: 'beta' },
      }),
      root,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout.trim()).toBe('0');
  });

  it('exits 2 when the op does not parse', () => {
    expect(executeInspect('not json').exitCode).toBe(2);
    expect(
      executeInspect(JSON.stringify({ op: 'argv', cwd: '.', argv: ['yarn'] }))
        .exitCode,
    ).toBe(2);
    expect(
      executeInspect(
        JSON.stringify({ op: 'inspect', check: 'nope', params: {} }),
      ).exitCode,
    ).toBe(2);
  });
});
