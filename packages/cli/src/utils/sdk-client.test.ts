import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@levr/sdk', () => ({
  client: { setConfig: vi.fn() },
  importCreateV1: vi.fn(),
}));

import { importCreateV1 } from '@levr/sdk';
import { uploadImport } from './sdk-client.js';

const mockImportCreate = vi.mocked(importCreateV1);

// internal — the wire field names are what the server's exactly-one rule
// reads; a misspelt key would 400 every push while routing tests stay green.
describe('uploadImport request body', () => {
  beforeEach(() => {
    mockImportCreate.mockReset();
    mockImportCreate.mockResolvedValue({
      data: { status: 'completed' },
    } as never);
  });

  const file = new Blob(['<testsuites/>']);

  it('sends a source UUID as automation_source_id and no name', async () => {
    await uploadImport({
      file,
      fileName: 'r.xml',
      automationSourceId: 'src-uuid',
    });

    const body = mockImportCreate.mock.calls[0]![0].body;
    expect(body.automation_source_id).toBe('src-uuid');
    expect(body.automation_source).toBeUndefined();
  });

  it('sends a source name as automation_source and no UUID', async () => {
    await uploadImport({
      file,
      fileName: 'r.xml',
      automationSource: 'backend-unit',
    });

    const body = mockImportCreate.mock.calls[0]![0].body;
    expect(body.automation_source).toBe('backend-unit');
    expect(body.automation_source_id).toBeUndefined();
  });

  // internal: ignored server-side since internal, so never sent.
  it('never sends parent_folder_id or update_mode', async () => {
    await uploadImport({
      file,
      fileName: 'r.xml',
      automationSource: 'backend-unit',
    });

    const body = mockImportCreate.mock.calls[0]![0].body as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty('parent_folder_id');
    expect(body).not.toHaveProperty('update_mode');
  });
});
