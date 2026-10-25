import type { IpcMainInvokeEvent } from 'electron';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../shared/errors';
import { MAX_IMPORT_BYTES } from '../../shared/import';
import { IPC_CHANNELS } from '../../shared/ipc';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>(),
  showOpen: vi.fn(),
  getSnapshot: vi.fn(),
  stat: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showOpenDialog: mocks.showOpen },
  ipcMain: { handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => mocks.handlers.set(channel, handler) },
}));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, stat: mocks.stat, readFile: mocks.readFile };
});
vi.mock('../vault/ipc', () => ({ vaultSessionManager: { getSnapshot: mocks.getSnapshot } }));
vi.mock('../windows', () => ({ windowRegistry: { requireMain: vi.fn() } }));

import { registerKnownHostsIpc } from './known-hosts-ipc';
import type { KnownHosts } from './known-hosts';

const knownHosts = { list: vi.fn(), remove: vi.fn(), importKeys: vi.fn() };
// Async like Electron's invoke: a synchronous throw in a handler becomes a rejection.
const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => mocks.handlers.get(channel)!({} as IpcMainInvokeEvent, ...args);

describe('known-hosts IPC handlers', () => {
  beforeAll(() => {
    registerKnownHostsIpc(knownHosts as unknown as KnownHosts);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSnapshot.mockReturnValue({ filePath: 'C:\\v.term', vault: {} });
    mocks.stat.mockResolvedValue({ size: 10 });
    mocks.readFile.mockResolvedValue(Buffer.from(''));
    mocks.showOpen.mockResolvedValue({ canceled: false, filePaths: ['C:\\ssh\\known_hosts'] });
  });

  it('refuses the list while the vault is locked', async () => {
    mocks.getSnapshot.mockImplementation(() => { throw new AppError('core.vaultLocked'); });
    await expect(invoke(IPC_CHANNELS.knownHostsList)).rejects.toMatchObject({ code: 'core.vaultLocked' });
    expect(knownHosts.list).not.toHaveBeenCalled();
  });

  it('rejects a remove with an invalid id before touching the store', async () => {
    await expect(invoke(IPC_CHANNELS.knownHostsRemove, 'x')).rejects.toMatchObject({ code: 'core.invalidRequest' });
    expect(knownHosts.remove).not.toHaveBeenCalled();
  });

  it('reads nothing when the vault was locked while the dialog was open', async () => {
    mocks.getSnapshot
      .mockReturnValueOnce({ filePath: 'C:\\v.term', vault: {} })
      .mockImplementationOnce(() => { throw new AppError('core.vaultLocked'); });
    await expect(invoke(IPC_CHANNELS.knownHostsImport)).rejects.toMatchObject({ code: 'core.vaultLocked' });
    expect(mocks.stat).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(knownHosts.importKeys).not.toHaveBeenCalled();
  });

  it('rejects a file larger than the import limit before reading it', async () => {
    mocks.stat.mockResolvedValue({ size: MAX_IMPORT_BYTES + 1 });
    await expect(invoke(IPC_CHANNELS.knownHostsImport)).rejects.toMatchObject({ code: 'core.importTooLarge' });
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it('answers a cancelled dialog with canceled without touching the file', async () => {
    mocks.showOpen.mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await invoke(IPC_CHANNELS.knownHostsImport)).toEqual({ canceled: true });
    expect(mocks.stat).not.toHaveBeenCalled();
  });
});
