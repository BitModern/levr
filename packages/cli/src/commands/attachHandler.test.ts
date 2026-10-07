import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LocalContext } from '../context.js';
import type { AttachCommandFlags } from './attach.js';

vi.mock('../utils/connect.js', () => ({
  connect: vi.fn().mockResolvedValue(true),
}));
vi.mock('../utils/sdk-client.js', () => ({
  uploadAttachment: vi.fn(),
  appendActualResult: vi.fn().mockResolvedValue(undefined),
  createComment: vi.fn().mockResolvedValue(undefined),
}));

import { attachHandler } from './attachHandler.js';
import {
  appendActualResult,
  createComment,
  uploadAttachment,
} from '../utils/sdk-client.js';

const mockUpload = vi.mocked(uploadAttachment);
const mockAppend = vi.mocked(appendActualResult);
const mockComment = vi.mocked(createComment);

const VARIANT = '01a10000-0000-7000-8000-0000000000d4';
const ISSUE_UUID = '01a10000-0000-7000-8000-0000000000b2';

function uploaded(targetId: string, name: string, n = 1) {
  return {
    status: 201,
    data: {
      id: `01a10000-0000-7000-8000-00000000010${n}`,
      url: `https://uploads.levr.test/files/p${n}/${name}`,
      private_url: null,
      original_file_name: name,
      mime_type: null,
      size: 4,
      is_public: true,
      created_at: '2026-10-05T12:00:00.000Z',
      related_type: 'issue' as const,
      target_id: targetId,
      kind: null,
      attempt_index: null,
      deduplicated: false,
    },
  };
}

describe('attachHandler (internal)', () => {
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
    extra: Partial<AttachCommandFlags> = {},
  ): AttachCommandFlags => ({
    embed: false,
    verbose: false,
    ...extra,
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'levr-attach-'));
    errors.length = 0;
    mockUpload.mockReset();
    mockAppend.mockClear();
    mockComment.mockClear();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const file = (name: string) => {
    const p = join(dir, name);
    writeFileSync(p, 'PNG!');
    return p;
  };

  it('embeds through server-side append', async () => {
    mockUpload.mockResolvedValue(uploaded(VARIANT, 'shot.png'));
    const c = ctx();

    await attachHandler.call(
      c,
      flags({ embed: true }),
      `run_result_variant:${VARIANT}`,
      file('shot.png'),
    );

    expect(c.process.exitCode).toBe(0);
    // One append, server-side, of exactly the markdown — never a
    // read-modify-write of actual_result.
    expect(mockAppend).toHaveBeenCalledTimes(1);
    expect(mockAppend).toHaveBeenCalledWith(
      VARIANT,
      '![shot.png](https://uploads.levr.test/files/p1/shot.png)',
    );
    expect(mockComment).not.toHaveBeenCalled();
  });

  it('embeds on an issue by posting a comment', async () => {
    mockUpload
      .mockResolvedValueOnce(uploaded(ISSUE_UUID, 'shot.png', 1))
      .mockResolvedValueOnce(uploaded(ISSUE_UUID, 'trace.zip', 2));
    const c = ctx();

    await attachHandler.call(
      c,
      flags({ embed: true }),
      'internal',
      file('shot.png'),
      file('trace.zip'),
    );

    expect(c.process.exitCode).toBe(0);
    // A NEW comment on the RESOLVED issue id the upload returned — the
    // identifier never needs a second lookup, and the description is never
    // rewritten.
    expect(mockComment).toHaveBeenCalledTimes(1);
    expect(mockComment).toHaveBeenCalledWith(
      'issue',
      ISSUE_UUID,
      '![shot.png](https://uploads.levr.test/files/p1/shot.png)\n' +
        '[trace.zip](https://uploads.levr.test/files/p2/trace.zip)',
    );
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it('uploads plain and embedded attachments private', async () => {
    // internal code review F-006: the embedded link renders for signed-in
    // members without making the file readable by anyone holding the link.
    mockUpload.mockResolvedValue(uploaded(ISSUE_UUID, 'shot.png'));

    await attachHandler.call(ctx(), flags(), 'internal', file('shot.png'));
    const plain = mockUpload.mock.calls[0]?.[0] as Record<string, unknown>;
    // is_public unset: the server default, private.
    expect(plain).not.toHaveProperty('is_public');

    mockUpload.mockClear();
    await attachHandler.call(
      ctx(),
      flags({ embed: true }),
      'internal',
      file('shot.png'),
    );
    const embedded = mockUpload.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(embedded).not.toHaveProperty('is_public');
  });

  it('exits 1 when a file fails, and when an embed write fails', async () => {
    mockUpload.mockResolvedValue({
      status: 404,
      error: { message: 'not found' },
    });
    const c1 = ctx();
    await attachHandler.call(c1, flags(), 'internal', file('shot.png'));
    expect(c1.process.exitCode).toBe(1);

    mockUpload.mockResolvedValue(uploaded(ISSUE_UUID, 'shot.png'));
    mockComment.mockRejectedValueOnce(new Error('Comment failed (403)'));
    const c2 = ctx();
    await attachHandler.call(
      c2,
      flags({ embed: true }),
      'internal',
      file('shot.png'),
    );
    expect(c2.process.exitCode).toBe(1);
    expect(errors.some((e) => e.includes('Embed failed'))).toBe(true);
  });

  it('refuses --embed on a target it cannot link from, before any upload', async () => {
    const c = ctx();
    await attachHandler.call(
      c,
      flags({ embed: true }),
      `automation_run_result:${VARIANT}`,
      file('trace.zip'),
    );
    expect(c.process.exitCode).toBe(1);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('attaches a --manifest batch with kind and attempt per entry', async () => {
    mockUpload.mockResolvedValue(uploaded(VARIANT, 'trace.zip'));
    const manifest = join(dir, 'manifest.json');
    writeFileSync(
      manifest,
      JSON.stringify([
        {
          target: `automation_run_result:${VARIANT}`,
          files: [file('trace.zip')],
          kind: 'trace',
          attempt: 1,
        },
      ]),
    );
    const c = ctx();
    await attachHandler.call(c, flags({ manifest }));
    expect(c.process.exitCode).toBe(0);
    expect(mockUpload.mock.calls[0]?.[0]).toMatchObject({
      related_type: 'automation_run_result',
      related_id: VARIANT,
      kind: 'trace',
      attempt_index: 1,
    });
  });
});
