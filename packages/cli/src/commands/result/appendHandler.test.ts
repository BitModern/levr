import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LocalContext } from '../../context.js';
import type { ResultAppendCommandFlags } from './append.js';

vi.mock('../../utils/connect.js', () => ({
  connect: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../utils/sdk-client.js', () => ({
  uploadAttachment: vi.fn(),
  appendActualResult: vi.fn().mockResolvedValue(undefined),
}));

import { resultAppendHandler } from './appendHandler.js';
import {
  appendActualResult,
  uploadAttachment,
} from '../../utils/sdk-client.js';

const mockUpload = vi.mocked(uploadAttachment);
const mockAppend = vi.mocked(appendActualResult);
const VARIANT = '01a10000-0000-7000-8000-0000000000d4';

describe('resultAppendHandler (internal)', () => {
  let dir: string;
  const errors: string[] = [];

  function ctx(): LocalContext {
    return {
      process: {
        stdout: { write: vi.fn(() => true) },
        stderr: { write: vi.fn() },
        exitCode: 0,
      },
      logger: {
        error: (m: string) => errors.push(m),
        warning: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
        debug: vi.fn(),
        setVerbose: vi.fn(),
      },
    } as unknown as LocalContext;
  }

  const flags = (
    extra: Partial<ResultAppendCommandFlags> = {},
  ): ResultAppendCommandFlags => ({ verbose: false, ...extra });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'levr-append-'));
    errors.length = 0;
    mockUpload.mockReset();
    mockAppend.mockClear();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends the text in one server-side call', async () => {
    const c = ctx();
    await resultAppendHandler.call(
      c,
      flags({ text: 'Checkout returns 500' }),
      `run_result_variant:${VARIANT}`,
    );
    expect(c.process.exitCode).toBe(0);
    expect(mockAppend).toHaveBeenCalledWith(VARIANT, 'Checkout returns 500');
  });

  it('uploads --attach files private first, then appends text plus their links', async () => {
    const shot = join(dir, 'shot.png');
    writeFileSync(shot, 'PNG!');
    mockUpload.mockResolvedValue({
      status: 201,
      data: {
        id: '01a10000-0000-7000-8000-000000000101',
        url: 'https://uploads.levr.test/files/p1/shot.png',
        private_url: null,
        original_file_name: 'shot.png',
        mime_type: 'image/png',
        size: 4,
        is_public: true,
        created_at: '2026-10-05T12:00:00.000Z',
        related_type: 'run_result_variant',
        target_id: VARIANT,
        kind: null,
        attempt_index: null,
        deduplicated: false,
      },
    });
    const notes = join(dir, 'observed.md');
    writeFileSync(notes, 'Observed: spinner never stops\n');

    const c = ctx();
    await resultAppendHandler.call(
      c,
      flags({ file: notes, attach: [shot] }),
      `run_result_variant:${VARIANT}`,
    );

    expect(c.process.exitCode).toBe(0);
    expect(mockUpload.mock.calls[0]?.[0]).toMatchObject({
      related_type: 'run_result_variant',
      related_id: VARIANT,
    });
    // Private (internal code review F-006): is_public is never sent.
    expect(mockUpload.mock.calls[0]?.[0]).not.toHaveProperty('is_public');
    expect(mockAppend).toHaveBeenCalledTimes(1);
    expect(mockAppend).toHaveBeenCalledWith(
      VARIANT,
      'Observed: spinner never stops\n![shot.png](https://uploads.levr.test/files/p1/shot.png)',
    );
  });

  it('appends nothing when an attached file fails', async () => {
    const c = ctx();
    await resultAppendHandler.call(
      c,
      flags({ text: 'x', attach: [join(dir, 'missing.png')] }),
      `run_result_variant:${VARIANT}`,
    );
    expect(c.process.exitCode).toBe(1);
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it('rejects a non-variant target and needs exactly one of --text/--file', async () => {
    const c1 = ctx();
    await resultAppendHandler.call(c1, flags({ text: 'x' }), 'internal');
    expect(c1.process.exitCode).toBe(1);

    const c2 = ctx();
    await resultAppendHandler.call(
      c2,
      flags(),
      `run_result_variant:${VARIANT}`,
    );
    expect(c2.process.exitCode).toBe(1);
    expect(mockAppend).not.toHaveBeenCalled();
  });
});
