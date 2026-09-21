import {
  BrowserWindow,
  dialog,
  ipcMain,
} from 'electron';
import { basename } from 'node:path';

import { IPC_CHANNELS } from '../../shared/ipc';
import { loadVault, saveVault } from './storage';

import type {
  OpenVaultRequest,
  OpenVaultResult,
  SaveVaultRequest,
  SaveVaultResult,
} from '../../shared/ipc';

import type { OpenDialogOptions } from 'electron';

function requirePassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Ein Vault-Passwort ist erforderlich.');
  }
}

export function registerVaultIpcHandlers(): void {
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

      return {
        canceled: false,
        filePath,
      };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.openVault,
    async (
      event,
      request: OpenVaultRequest,
    ): Promise<OpenVaultResult> => {
      requirePassword(request?.password);

      const parentWindow =
        BrowserWindow.fromWebContents(event.sender);

        const options: OpenDialogOptions = {
            title: 'Terminus-Vault öffnen',
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

      const vault = await loadVault(
        filePath,
        request.password,
      );

      return {
        canceled: false,
        filePath,
        vault,
      };
    },
  );
}