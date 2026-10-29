import { Readable, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { RemoteEdits } from './remote-edit';
import type { RemoteFileSystem } from './sftp-file-system';

vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>(), mkdtemp: vi.fn() }));

describe('RemoteEdits', () => {
  it.runIf(process.platform === 'win32')('refuses server names that are unsafe as local file names before creating a temp folder', async () => {
    const fs = { stat: async () => ({ name: 'x', type: 'file', size: 1, modified: 0 }),
      read: () => new Readable({ read() { this.destroy(new Error('read')); } }) } as unknown as RemoteFileSystem;
    const openFile = vi.fn();
    const edits = new RemoteEdits(fs, { openFile, emit: () => {} });
    await expect(edits.open('/srv/..\\x')).rejects.toMatchObject({ code: 'files.unsafeName' });
    expect(mkdtemp).not.toHaveBeenCalled();
    expect(openFile).not.toHaveBeenCalled();
  });

  it('keeps the server file mode when uploading an edit', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(mkdtemp).mockImplementationOnce(actual.mkdtemp);
    const write = vi.fn(() => new Writable({ write(_chunk, _encoding, callback) { callback(); } }));
    const fs = { stat: async () => ({ name: 'run.sh', type: 'file', size: 1, modified: 0, mode: 0o755 }),
      read: () => Readable.from([Buffer.from('x')]), write } as unknown as RemoteFileSystem;
    const edits = new RemoteEdits(fs, { openFile: async () => {}, emit: () => {} });
    const { editId } = await edits.open('/srv/run.sh');
    await edits.upload(editId, true);
    await edits.close(editId);
    expect(write).toHaveBeenCalledWith('/srv/run.sh', 0o755);
  });
});
