import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { UnlockVaultResult } from '../../shared/ipc';
import type { EncryptedVaultFile } from '../../shared/vault/file-format';
import { exampleVault } from '../../shared/vault/example';
import { encryptVault } from './crypto';
import { recentId } from './recent-vaults';

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

  it('does not open a granted path through a Kelvin sign look-alike', async () => {
    expect(await invoke(IPC_CHANNELS.vaultDropFile, 'C:\\\u212A\\kelvin\\v.term')).toBe('C:\\\u212A\\kelvin\\v.term');
    await expect(invoke(IPC_CHANNELS.unlockVault, { filePath: 'C:\\k\\kelvin\\v.term', password: 'x' })).rejects.toMatchObject({ code: 'core.vaultPathNotAllowed' });
    expect(mocks.read).not.toHaveBeenCalledWith('C:\\k\\kelvin\\v.term');
  });

  it('grants the file picked in the native dialog, also on a share', async () => {
    mocks.showOpen.mockResolvedValue({ canceled: false, filePaths: ['\\\\srv\\share\\picked.term'] });
    expect(await invoke(IPC_CHANNELS.selectVaultFile)).toEqual({ canceled: false, filePath: '\\\\srv\\share\\picked.term' });
    await expect(invoke(IPC_CHANNELS.unlockVault, { filePath: '\\\\srv\\share\\picked.term', password: 'x' })).rejects.toMatchObject({ code: 'core.vaultFileNotFound' });
    expect(mocks.read.mock.calls[0]?.[0]).toBe('\\\\srv\\share\\picked.term');
  });
});

describe('Windows Hello in the IPC handlers (run-app fake)', () => {
  const filePath = 'C:\\hello\\v.term';
  const password = 'synthetic-hello-pw';
  const options = { memoryKiB: 16_384, iterations: 1, parallelism: 1 };
  let file: EncryptedVaultFile;
  beforeAll(async () => {
    process.env.SHELLHERD_HELLO_FAKE = 'ok';
    file = await encryptVault(exampleVault, password, options);
    expect(await invoke(IPC_CHANNELS.vaultDropFile, filePath)).toBe(filePath);
  });
  afterAll(() => { delete process.env.SHELLHERD_HELLO_FAKE; });
  beforeEach(async () => {
    process.env.SHELLHERD_HELLO_FAKE = 'ok';
    mocks.read.mockResolvedValue(file);
    await invoke(IPC_CHANNELS.unlockVault, { filePath, password });
    await invoke(IPC_CHANNELS.helloDisable);
  });

  it('refuses network, device and unknown paths before any file access', async () => {
    mocks.read.mockClear();
    for (const path of ['\\\\srv\\s\\v.term', '//srv/s/v.term', '\\\\?\\UNC\\srv\\s\\v.term', '\\\\.\\pipe\\v.term', 'C:\\never\\granted.term']) {
      await expect(invoke(IPC_CHANNELS.helloUnlock, { filePath: path })).rejects.toMatchObject({ code: 'core.vaultPathNotAllowed' });
    }
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('enables, locks and unlocks the same vault with Windows Hello', async () => {
    expect(await invoke(IPC_CHANNELS.helloEnable)).toEqual({ available: true, enrolled: true });
    expect(await invoke(IPC_CHANNELS.helloStatus, filePath)).toEqual({ available: true, enrolled: true });
    expect(readFileSync(join(mocks.userData, 'hello-unlock.json'), 'utf8')).not.toContain(password);
    await invoke(IPC_CHANNELS.lockVault);
    const result = await invoke(IPC_CHANNELS.helloUnlock, { filePath }) as UnlockVaultResult;
    expect(result.vault).toEqual(exampleVault);
    expect(result.filePath).toBe(filePath);
  });

  it('stores nothing when the vault is locked during the enable prompt', async () => {
    const enabling = invoke(IPC_CHANNELS.helloEnable);
    await invoke(IPC_CHANNELS.lockVault);
    await expect(enabling).rejects.toMatchObject({ code: 'core.vaultLocked' });
    expect(await invoke(IPC_CHANNELS.helloStatus, filePath)).toEqual({ available: true, enrolled: false });
  });

  it('drops the entry of a replaced file without a prompt', async () => {
    await invoke(IPC_CHANNELS.helloEnable);
    await invoke(IPC_CHANNELS.lockVault);
    mocks.read.mockResolvedValue(await encryptVault(exampleVault, password, options));
    process.env.SHELLHERD_HELLO_FAKE = 'cancel';   // a prompt would end in core.helloCanceled
    await expect(invoke(IPC_CHANNELS.helloUnlock, { filePath })).rejects.toMatchObject({ code: 'core.helloStale' });
    expect(await invoke(IPC_CHANNELS.helloStatus, filePath)).toEqual({ available: true, enrolled: false });
  });

  it('drops the entry after a re-created Windows Hello key', async () => {
    await invoke(IPC_CHANNELS.helloEnable);
    await invoke(IPC_CHANNELS.lockVault);
    process.env.SHELLHERD_HELLO_FAKE = 'reset';
    await expect(invoke(IPC_CHANNELS.helloUnlock, { filePath })).rejects.toMatchObject({ code: 'core.helloStale' });
    expect(await invoke(IPC_CHANNELS.helloStatus, filePath)).toEqual({ available: true, enrolled: false });
  });

  it('keeps the entry after a canceled prompt', async () => {
    await invoke(IPC_CHANNELS.helloEnable);
    await invoke(IPC_CHANNELS.lockVault);
    process.env.SHELLHERD_HELLO_FAKE = 'cancel';
    await expect(invoke(IPC_CHANNELS.helloUnlock, { filePath })).rejects.toMatchObject({ code: 'core.helloCanceled' });
    process.env.SHELLHERD_HELLO_FAKE = 'ok';
    expect(await invoke(IPC_CHANNELS.helloStatus, filePath)).toEqual({ available: true, enrolled: true });
  });

  it('disables, rejects bad input and needs an unlocked vault to enable', async () => {
    await invoke(IPC_CHANNELS.helloEnable);
    expect(await invoke(IPC_CHANNELS.helloDisable)).toEqual({ available: true, enrolled: false });
    await expect(invoke(IPC_CHANNELS.helloStatus, 42)).rejects.toMatchObject({ code: 'core.invalidRequest' });
    await expect(invoke(IPC_CHANNELS.helloUnlock, { filePath: 42 })).rejects.toMatchObject({ code: 'core.vaultFileMissing' });
    await invoke(IPC_CHANNELS.lockVault);
    await expect(invoke(IPC_CHANNELS.helloEnable)).rejects.toMatchObject({ code: 'core.vaultLocked' });
  });

  it('forgets the entry with the recent-list entry', async () => {
    await invoke(IPC_CHANNELS.helloEnable);
    await invoke(IPC_CHANNELS.removeRecentVault, recentId(filePath));
    expect(await invoke(IPC_CHANNELS.helloStatus, filePath)).toEqual({ available: true, enrolled: false });
  });
});
