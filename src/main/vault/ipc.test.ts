import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../shared/ipc';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>(),
  userData: '',
  read: vi.fn(),
  showOpen: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { getPath: () => mocks.userData },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showOpenDialog: mocks.showOpen, showSaveDialog: vi.fn() },
  ipcMain: { handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => mocks.handlers.set(channel, handler) },
}));
vi.mock('./storage', () => ({ readEncryptedVaultFile: mocks.read, writeEncryptedVaultFile: vi.fn(), backupVaultFile: vi.fn(), saveVault: vi.fn() }));

import { registerVaultIpcHandlers } from './ipc';

const invoke = (channel: string, ...args: unknown[]): Promise<unknown> => mocks.handlers.get(channel)!({} as IpcMainInvokeEvent, ...args);

describe('vault path grants in the IPC handlers', () => {
  beforeAll(() => {
    mocks.userData = mkdtempSync(join(tmpdir(), 'shellherd-vault-ipc-'));
    registerVaultIpcHandlers();
  });
  beforeEach(() => {
    mocks.read.mockReset();
    mocks.read.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  });

  it('refuses network, device and unknown paths before any file access', async () => {
    for (const filePath of ['\\\\srv\\s\\v.term', '//srv/s/v.term', '\\/srv\\s\\v.term', '\\\\?\\UNC\\srv\\s\\v.term', '\\\\.\\pipe\\v.term', 'C:\\never\\granted.term']) {
      await expect(invoke(IPC_CHANNELS.unlockVault, { filePath, password: 'x' })).rejects.toMatchObject({ code: 'core.vaultPathNotAllowed' });
    }
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('grants a dropped local file and opens it in another spelling', async () => {
    await expect(invoke(IPC_CHANNELS.vaultDropFile, '\\\\srv\\s\\v.term')).rejects.toMatchObject({ code: 'core.vaultPathNotAllowed' });
    expect(await invoke(IPC_CHANNELS.vaultDropFile, 'C:/drop/v.term')).toBe('C:\\drop\\v.term');
    await expect(invoke(IPC_CHANNELS.unlockVault, { filePath: 'c:\\DROP\\v.term', password: 'x' })).rejects.toMatchObject({ code: 'core.vaultFileNotFound' });
    expect(mocks.read.mock.calls[0]?.[0]).toBe('c:\\DROP\\v.term');
  });

  it('grants the file picked in the native dialog, also on a share', async () => {
    mocks.showOpen.mockResolvedValue({ canceled: false, filePaths: ['\\\\srv\\share\\picked.term'] });
    expect(await invoke(IPC_CHANNELS.selectVaultFile)).toEqual({ canceled: false, filePath: '\\\\srv\\share\\picked.term' });
    await expect(invoke(IPC_CHANNELS.unlockVault, { filePath: '\\\\srv\\share\\picked.term', password: 'x' })).rejects.toMatchObject({ code: 'core.vaultFileNotFound' });
    expect(mocks.read.mock.calls[0]?.[0]).toBe('\\\\srv\\share\\picked.term');
  });
});
