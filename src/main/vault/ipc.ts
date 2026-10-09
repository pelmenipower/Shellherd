import {
  BrowserWindow,
  dialog,
  ipcMain,
} from 'electron';
import { basename } from 'node:path';

import { IPC_CHANNELS } from '../../shared/ipc';
import { VaultSessionManager } from './session';
import { saveVault } from './storage';

import type {
  SaveVaultRequest,
  SaveVaultResult,
  SelectVaultFileResult,
  UnlockVaultRequest,
  UnlockVaultResult,
  SaveCurrentVaultRequest,
  VaultSessionResult,
} from '../../shared/ipc';

import type { OpenDialogOptions } from 'electron';

function requirePassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Ein Vault-Passwort ist erforderlich.');
  }
}

export const vaultSessionManager =
  new VaultSessionManager();

export function registerVaultIpcHandlers(onSessionChange: () => void = () => {}): void {
  ipcMain.handle(IPC_CHANNELS.selectPrivateKeyFile, async (event): Promise<SelectVaultFileResult> => {
    vaultSessionManager.getSnapshot();
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = { title: 'Privaten SSH-Schlüssel auswählen', properties: ['openFile'] };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths[0] ? { canceled: true } : { canceled: false, filePath: result.filePaths[0] };
  });
  ipcMain.handle(
    IPC_CHANNELS.saveVault,
    async (
      event,
      request: SaveVaultRequest,
    ): Promise<SaveVaultResult> => {
      requirePassword(request?.password);

      const parentWindow =
        BrowserWindow.fromWebContents(event.sender);

      const suggestedName =
        typeof request.suggestedName === 'string'
          ? basename(request.suggestedName)
          : 'vault.terminus';

      const options = {
        title: 'Terminus-Vault speichern',
        defaultPath: suggestedName,
        filters: [
          {
            name: 'Terminus Vault',
            extensions: ['terminus'],
          },
        ],
      };

      const result = parentWindow
        ? await dialog.showSaveDialog(parentWindow, options)
        : await dialog.showSaveDialog(options);

      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }

      const filePath = await saveVault(
        result.filePath,
        request.vault,
        request.password,
      );

      await vaultSessionManager.unlock(
        filePath,
        request.password,
      );

      onSessionChange();
      return {
        canceled: false,
        filePath,
      };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.selectVaultFile,
    async (event): Promise<SelectVaultFileResult> => {
      const parentWindow =
        BrowserWindow.fromWebContents(event.sender);

      const options: OpenDialogOptions = {
        title: 'Terminus-Vault auswählen',
        properties: ['openFile'],
        filters: [
          {
            name: 'Terminus Vault',
            extensions: ['terminus'],
          },
        ],
      };

      const result = parentWindow
        ? await dialog.showOpenDialog(parentWindow, options)
        : await dialog.showOpenDialog(options);

      const filePath = result.filePaths[0];

      if (result.canceled || !filePath) {
        return { canceled: true };
      }

      return {
        canceled: false,
        filePath,
      };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.unlockVault,
    async (
      _event,
      request: UnlockVaultRequest,
    ): Promise<UnlockVaultResult> => {
      requirePassword(request?.password);

      if (
        !request ||
        typeof request.filePath !== 'string' ||
        request.filePath.length === 0
      ) {
        throw new Error(
          'Es wurde keine Vault-Datei ausgewählt.',
        );
      }

      const snapshot = await vaultSessionManager.unlock(
        request.filePath,
        request.password,
      );

      onSessionChange();
      return {
        filePath: snapshot.filePath,
        vault: snapshot.vault,
      };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.saveCurrentVault,
    async (
      _event,
      request: SaveCurrentVaultRequest,
    ): Promise<VaultSessionResult> => {
      return vaultSessionManager.save(
        request.vault,
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.lockVault,
    () => {
      onSessionChange();
      vaultSessionManager.lock();
    },
  );
}
