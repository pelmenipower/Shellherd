import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fileError, localFileSystem } from './file-system';
import { localListPath } from './ipc';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, shell: {}, webContents: { fromId: () => undefined } }));
vi.mock('../vault/ipc', () => ({ vaultSessionManager: { getSnapshot: vi.fn() } }));

describe('localListPath', () => {
  it('keeps drive and UNC folders, resolved', () => {
    expect(localListPath('C:\\x')).toBe('C:\\x');
    expect(localListPath('\\\\server\\share\\x')).toBe('\\\\server\\share\\x');
  });

  it('refuses device paths, also after normalisation', () => {
    // `\\?` and `\\.` alone resolve to `C:\?` and `C:\`, so they are refused by the schema, not here.
    for (const bad of ['\\\\?/C:/x', '\\\\./pipe/x', '\\\\?\\C:\\x', '\\\\.\\pipe\\x']) {
      expect(() => localListPath(bad), bad).toThrow();
    }
  });
});

describe('fileError', () => {
  it('maps ENOTDIR to files.notADirectory', () => {
    expect(fileError({ code: 'ENOTDIR' })).toEqual({ code: 'files.notADirectory' });
  });
});

describe('local list on a file', () => {
  const base = mkdtempSync(join(tmpdir(), 'shellherd-fs-'));
  const file = join(base, 'notes.txt');
  beforeAll(() => { writeFileSync(file, 'synthetic'); });
  afterAll(() => { rmSync(base, { recursive: true, force: true }); });

  it('refuses a file as folder with files.notADirectory', async () => {
    const failure = await localFileSystem.list(file).then(() => null, error => fileError(error));
    expect(failure).toEqual({ code: 'files.notADirectory' });
  });

  it('keeps the error for a missing folder', async () => {
    const failure = await localFileSystem.list(join(base, 'fehlt')).then(() => null, error => fileError(error));
    expect(failure).toEqual({ code: 'files.notFound' });
  });
});
