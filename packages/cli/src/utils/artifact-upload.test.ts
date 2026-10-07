import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  openSync,
  ftruncateSync,
  closeSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('./sdk-client.js', () => ({
  uploadAttachment: vi.fn(),
}));

import { uploadAttachment } from './sdk-client.js';
import {
  MAX_ARTIFACT_BYTES,
  TargetParseError,
  parseTarget,
  resolveArtifactPath,
  uploadArtifactFile,
} from './artifact-upload.js';

const mockUpload = vi.mocked(uploadAttachment);
const RESULT_ID = '01a10000-0000-7000-8000-0000000000c3';
const noSleep = () => Promise.resolve();

/** A 201 the way the SDK wrapper reports it — inside the real contract. */
const created = (over: Record<string, unknown> = {}) => ({
  status: 201,
  data: {
    id: '01a10000-0000-7000-8000-0000000000aa',
    url: 'https://uploads.levr.test/files/p/shot.png',
    private_url: null,
    original_file_name: 'shot.png',
    mime_type: 'image/png',
    size: 4,
    is_public: false,
    created_at: '2026-10-05T12:00:00.000Z',
    related_type: 'issue' as const,
    target_id: '01a10000-0000-7000-8000-0000000000b2',
    kind: null,
    attempt_index: null,
    deduplicated: false,
    ...over,
  },
});

describe('artifact-upload (internal)', () => {
  let dir: string;

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'levr-artifacts-')));
    mockUpload.mockReset();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const file = (name: string, content = 'PNG!') => {
    const p = join(dir, name);
    writeFileSync(p, content);
    return p;
  };

  it('parses typed and human targets', () => {
    expect(parseTarget('internal')).toEqual({
      relatedType: 'issue',
      relatedId: 'internal',
    });
    expect(parseTarget('TC-5')).toEqual({
      relatedType: 'test',
      relatedId: 'TC-5',
    });
    expect(parseTarget('TR-3')).toEqual({
      relatedType: 'run',
      relatedId: 'TR-3',
    });
    expect(parseTarget(`automation_run_result:${RESULT_ID}`)).toEqual({
      relatedType: 'automation_run_result',
      relatedId: RESULT_ID,
    });
    // Spoke identifiers, and an explicit type for a TC/TR team key (F-010).
    expect(parseTarget('ENG-JP-5')).toEqual({
      relatedType: 'issue',
      relatedId: 'ENG-JP-5',
    });
    expect(parseTarget('TC-ROD-40')).toEqual({
      relatedType: 'test',
      relatedId: 'TC-ROD-40',
    });
    expect(parseTarget('issue:TC-12')).toEqual({
      relatedType: 'issue',
      relatedId: 'TC-12',
    });
    for (const bad of [
      'eng-42',
      'issue:eng-12',
      'ENG42',
      `folder:${RESULT_ID}`,
      'run_result_variant:not-a-uuid',
      '',
    ]) {
      expect(() => parseTarget(bad), bad).toThrow(TargetParseError);
    }
  });

  it('skips files over 50 MiB without throwing', async () => {
    const big = join(dir, 'video.webm');
    const fd = openSync(big, 'w');
    ftruncateSync(fd, MAX_ARTIFACT_BYTES + 1); // sparse: no 50 MiB of RAM
    closeSync(fd);

    const result = await uploadArtifactFile({
      target: parseTarget('internal'),
      filePath: big,
    });

    expect(result).toEqual({
      status: 'skipped',
      reason: 'too_large',
      size: MAX_ARTIFACT_BYTES + 1,
    });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('sends fields before the file part', async () => {
    mockUpload.mockResolvedValue(created());
    await uploadArtifactFile({
      target: parseTarget(`automation_run_result:${RESULT_ID}`),
      filePath: file('trace.zip'),
      kind: 'trace',
      attemptIndex: 1,
      isPublic: false,
    });

    const body = mockUpload.mock.calls[0]?.[0] as Record<string, unknown>;
    // Insertion order is the multipart part order the SDK serializer emits.
    expect(Object.keys(body)).toEqual([
      'related_type',
      'related_id',
      'kind',
      'attempt_index',
      'is_public',
      'file',
    ]);
    expect(body['file']).toBeInstanceOf(File);
    expect((body['file'] as File).name).toBe('trace.zip');
  });

  it('sends kind and attempt_index only for automation results', async () => {
    mockUpload.mockResolvedValue(created());
    await uploadArtifactFile({
      target: parseTarget('internal'),
      filePath: file('shot.png'),
      kind: 'screenshot',
      attemptIndex: 2,
    });
    const body = mockUpload.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body).not.toHaveProperty('kind');
    expect(body).not.toHaveProperty('attempt_index');

    mockUpload.mockClear();
    await uploadArtifactFile({
      target: parseTarget(`automation_run_result:${RESULT_ID}`),
      filePath: file('shot.png'),
      kind: 'screenshot',
      attemptIndex: 2,
    });
    expect(mockUpload.mock.calls[0]?.[0]).toMatchObject({
      kind: 'screenshot',
      attempt_index: 2,
    });
  });

  it('rejects artifact paths outside the working directory', () => {
    const root = join(dir, 'repo');
    const reports = join(root, 'e2e-reports');
    mkdirSync(reports, { recursive: true });
    writeFileSync(join(dir, 'secret.txt'), 'outside');

    // A ../ escape past the root.
    expect(resolveArtifactPath('../../secret.txt', reports, root)).toBeNull();
    // A symlink inside the root pointing out of it.
    symlinkSync(join(dir, 'secret.txt'), join(reports, 'link.png'));
    expect(resolveArtifactPath('link.png', reports, root)).toBeNull();
    // A missing path outside the root is still a rejection, not "missing".
    expect(resolveArtifactPath('../../nope.png', reports, root)).toBeNull();

    // Playwright's sibling layout stays inside the root and resolves.
    mkdirSync(join(root, 'test-results', 't'), { recursive: true });
    writeFileSync(join(root, 'test-results', 't', 'shot.png'), 'PNG!');
    expect(
      resolveArtifactPath('../test-results/t/shot.png', reports, root),
    ).toMatchObject({
      status: 'ok',
      path: join(root, 'test-results/t/shot.png'),
    });
  });

  it('keeps an in-root name that starts with two dots (F-015)', () => {
    const root = join(dir, 'repo');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, '..trace.zip'), 'PK');
    expect(resolveArtifactPath('..trace.zip', root, root)).toMatchObject({
      status: 'ok',
      path: join(root, '..trace.zip'),
    });
  });

  it('turns an I/O error on the open handle into a failed status (F-002)', async () => {
    // A directory opens fine but cannot be read as a file: the read throws
    // EISDIR inside the open handle, which used to escape.
    const d = join(dir, 'a-directory');
    mkdirSync(d);
    const st = statSync(d);
    const result = await uploadArtifactFile({
      target: parseTarget('internal'),
      filePath: d,
      validated: { path: d, dev: st.dev, ino: st.ino },
    });
    expect(result.status).toBe('failed');
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('rejects an opened file that is outside the recorded root (F-005)', async () => {
    const root = join(dir, 'repo');
    mkdirSync(root, { recursive: true });
    const outside = file('outside.png');
    const st = statSync(outside);
    // Identity matches, but the descriptor lives outside the root it was
    // supposedly confined to: what a parent-directory swap produces.
    const result = await uploadArtifactFile({
      target: parseTarget('internal'),
      filePath: outside,
      validated: { path: outside, dev: st.dev, ino: st.ino, root },
    });
    expect(result).toEqual({
      status: 'rejected',
      message: 'the opened file is outside the working directory',
    });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('accepts an absolute path inside the working directory', () => {
    const root = join(dir, 'repo');
    mkdirSync(root, { recursive: true });
    const abs = join(root, 'shot.png');
    writeFileSync(abs, 'PNG!');
    const st = statSync(abs);
    expect(resolveArtifactPath(abs, '/elsewhere', root)).toEqual({
      status: 'ok',
      path: abs,
      dev: st.dev,
      ino: st.ino,
      root,
    });
    expect(resolveArtifactPath(join(dir, 'x.png'), root, root)).toBeNull();
  });

  it('counts a missing file as missing without throwing', async () => {
    expect(resolveArtifactPath('gone.png', dir, dir)).toEqual({
      status: 'missing',
    });
    await expect(
      uploadArtifactFile({
        target: parseTarget('internal'),
        filePath: join(dir, 'gone.png'),
      }),
    ).resolves.toEqual({ status: 'missing' });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('reads through a no-follow handle and rejects a swapped file', async () => {
    const real = file('shot.png');
    const other = file('other.png', 'different');
    const otherStat = statSync(other);

    // Validated as one file, then the path holds another (dev/ino differ).
    const result = await uploadArtifactFile({
      target: parseTarget('internal'),
      filePath: real,
      validated: { path: real, dev: otherStat.dev, ino: otherStat.ino },
    });
    expect(result).toEqual({
      status: 'rejected',
      message: 'the file changed after it was validated',
    });

    // The final component turned into a symlink after validation: O_NOFOLLOW.
    if (process.platform !== 'win32') {
      const st = statSync(real);
      rmSync(real);
      symlinkSync(other, real);
      const swapped = await uploadArtifactFile({
        target: parseTarget('internal'),
        filePath: real,
        validated: { path: real, dev: st.dev, ino: st.ino },
      });
      expect(swapped.status).toBe('rejected');
    }
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('retries an ambiguous failure only for automation results', async () => {
    // A 5xx after the request was sent: retried for an automation result
    // (the server deduplicates) …
    mockUpload
      .mockResolvedValueOnce({ status: 502, error: { message: 'bad gateway' } })
      .mockResolvedValueOnce(created({ deduplicated: true }));
    const auto = await uploadArtifactFile({
      target: parseTarget(`automation_run_result:${RESULT_ID}`),
      filePath: file('trace.zip'),
      sleep: noSleep,
    });
    expect(auto.status).toBe('deduplicated');
    expect(mockUpload).toHaveBeenCalledTimes(2);

    // … but never for an issue, where a retry could duplicate the file.
    mockUpload.mockReset();
    mockUpload.mockResolvedValue({
      status: 502,
      error: { message: 'bad gateway' },
    });
    const issue = await uploadArtifactFile({
      target: parseTarget('internal'),
      filePath: file('shot.png'),
      sleep: noSleep,
    });
    expect(issue).toEqual({
      status: 'failed',
      message: 'outcome unknown, not retried to avoid a duplicate attachment',
    });
    expect(mockUpload).toHaveBeenCalledTimes(1);

    // A failure the server never received is retried for any target:
    // a 429 …
    mockUpload.mockReset();
    mockUpload
      .mockResolvedValueOnce({ status: 429, error: {} })
      .mockResolvedValueOnce(created());
    expect(
      (
        await uploadArtifactFile({
          target: parseTarget('internal'),
          filePath: file('shot.png'),
          sleep: noSleep,
        })
      ).status,
    ).toBe('uploaded');
    expect(mockUpload).toHaveBeenCalledTimes(2);

    // … and a refused connection (fetch rejects with cause.code).
    mockUpload.mockReset();
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ECONNREFUSED' },
    });
    mockUpload.mockRejectedValueOnce(refused).mockResolvedValueOnce(created());
    expect(
      (
        await uploadArtifactFile({
          target: parseTarget('internal'),
          filePath: file('shot.png'),
          sleep: noSleep,
        })
      ).status,
    ).toBe('uploaded');

    // Retries stop at two: three attempts in all, then a failed status.
    mockUpload.mockReset();
    mockUpload.mockResolvedValue({ status: 429, error: {} });
    const exhausted = await uploadArtifactFile({
      target: parseTarget('internal'),
      filePath: file('shot.png'),
      sleep: noSleep,
    });
    expect(exhausted.status).toBe('failed');
    expect(mockUpload).toHaveBeenCalledTimes(3);
  });

  it('reports the resolved target and maps a 200 to deduplicated', async () => {
    mockUpload.mockResolvedValue({
      ...created({ deduplicated: true }),
      status: 200,
    });
    const result = await uploadArtifactFile({
      target: parseTarget('internal'),
      filePath: file('shot.png'),
    });
    expect(result).toEqual({
      status: 'deduplicated',
      id: '01a10000-0000-7000-8000-0000000000aa',
      url: 'https://uploads.levr.test/files/p/shot.png',
      target_id: '01a10000-0000-7000-8000-0000000000b2',
    });
  });

  it('never retries a definite 4xx', async () => {
    mockUpload.mockResolvedValue({
      status: 404,
      error: { message: 'issue internal not found in workspace' },
    });
    const result = await uploadArtifactFile({
      target: parseTarget(`automation_run_result:${RESULT_ID}`),
      filePath: file('shot.png'),
      sleep: noSleep,
    });
    expect(result).toEqual({
      status: 'failed',
      message: 'HTTP 404: issue internal not found in workspace',
    });
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });
});
