import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import type { IpcMainInvokeEvent, OpenDialogOptions } from 'electron';

import { AppError } from '../../shared/errors';
import { MAX_IMPORT_BYTES } from '../../shared/import';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { KnownHostsImportReply } from '../../shared/known-hosts';
import { mainT } from '../i18n';
import { decodeImport } from '../import-source';
import { vaultSessionManager } from '../vault/ipc';
import { windowRegistry } from '../windows';
import type { KnownHosts } from './known-hosts';
import { parseKnownHosts } from './known-hosts-parse';

const ID = /^[0-9a-f]{16}$/;

/** Server key list for the main window, only while a vault is unlocked: host names reveal what the user works on. */
export function registerKnownHostsIpc(knownHosts: KnownHosts): void {
  const guard = (event: IpcMainInvokeEvent): void => { windowRegistry.requireMain(event); vaultSessionManager.getSnapshot(); };
  ipcMain.handle(IPC_CHANNELS.knownHostsList, event => { guard(event); return knownHosts.list(); });
  ipcMain.handle(IPC_CHANNELS.knownHostsRemove, (event, id: unknown) => {
    guard(event);
    if (typeof id !== 'string' || !ID.test(id)) throw new AppError('core.invalidRequest');
    return knownHosts.remove(id);
  });
  // Reads only the file picked in the native dialog; ~/.ssh is a suggestion, never read on its own.
  ipcMain.handle(IPC_CHANNELS.knownHostsImport, async (event): Promise<KnownHostsImportReply> => {
    guard(event);
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: mainT('dialogs.importKnownHosts.title'),
      defaultPath: join(homedir(), '.ssh', 'known_hosts'),
      properties: ['openFile', 'showHiddenFiles'],
    };
    const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    const file = picked.filePaths[0];
    if (picked.canceled || !file) return { canceled: true };
    // Locked while the dialog was open: read nothing and send no host names.
    vaultSessionManager.getSnapshot();
    let bytes: Buffer;
    try {
      if ((await stat(file)).size > MAX_IMPORT_BYTES) throw new AppError('core.importTooLarge');
      bytes = await readFile(file);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('core.importUnreadable');
    }
    return { canceled: false, ...(await knownHosts.importKeys(parseKnownHosts(decodeImport(bytes)))) };
  });
}
