import { describe, it, expect } from 'vitest';
import { proposeCompletionLines } from './completion.js';
import { buildContext } from './context.js';

const ctx = buildContext(process);

// rawArgs mirrors process.argv.slice(2) for `levr __complete <COMP_LINE>`:
// ['__complete', <targetName='levr'>, ...wordsBeingCompleted].
describe('proposeCompletionLines (levr __complete)', () => {
  it('completes top-level commands on a trailing space', async () => {
    const lines = await proposeCompletionLines(
      ['__complete', 'levr'],
      'levr ',
      ctx,
    );
    expect(lines).toEqual(
      expect.arrayContaining(['auth', 'workspace', 'push']),
    );
  });

  it('completes push flags', async () => {
    const lines = await proposeCompletionLines(
      ['__complete', 'levr', 'push', '--'],
      'levr push --',
      ctx,
    );
    expect(lines).toEqual(
      expect.arrayContaining(['--team-id', '--source', '--format']),
    );
  });

  it('completes auth subcommands', async () => {
    const lines = await proposeCompletionLines(
      ['__complete', 'levr', 'auth'],
      'levr auth ',
      ctx,
    );
    expect(lines).toEqual(
      expect.arrayContaining(['login', 'logout', 'status']),
    );
  });

  it('returns an array (never throws) on unknown input', async () => {
    const lines = await proposeCompletionLines(
      ['__complete', 'levr', '??nonexistent'],
      'levr ??nonexistent',
      ctx,
    );
    expect(Array.isArray(lines)).toBe(true);
  });
});
