import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
} from 'electron';
import { basename, join } from 'node:path';
import { RecentVaults } from './recent-vaults';

import { AppError } from '../../shared/errors';
import { IPC_CHANNELS } from '../../shared/ipc';
import { mainT } from '../i18n';
import { toVaultAppError } from './ipc-error';
import { vaultWriteCode } from '../../shared/vault/write-errors';
import { VaultSessionManager, resumesLocked } from './session';
import { droppedVaultPath, vaultPathAllowed, vaultPathGrants } from './path-grants';
import { readEncryptedVaultFile, saveVault } from './storage';
import { HelloVaults } from './hello';
import { createHelloSigner } from './hello-helper';

import type { LockedVault, VaultSessionSnapshot } from './session';
import type {
  HelloUnlockRequest,
  LockVaultRequest,
  SaveVaultRequest,
  SaveVaultResult,
  SelectVaultFileResult,
  UnlockVaultRequest,
  UnlockVaultResult,
  SaveCurrentVaultRequest,
  VaultSessionResult,
} from '../../shared/ipc';

import type { IpcMainInvokeEvent, OpenDialogOptions } from 'electron';

function requirePassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length === 0) {
    throw new AppError('core.vaultPasswordRequired');
  }
}

export const vaultSessionManager =
  new VaultSessionManager();

export interface VaultIpcOptions {
  /** A new vault, another file or vault, or an explicit disconnect: sessions of the previous vault must end. */
  onSessionChange?: () => void;
  /** After every successful unlock or new vault (resume or switch). */
  onUnlock?: () => void;
  /** After a lock that keeps sessions: windows show the lock screen. */
  onLock?: () => void;
  /** Called after the vault content changed (unlock or save). */
  onVaultChange?: () => void;
  /** Rejects senders that may not use vault commands (e.g. detached windows). */
  guard?: (event: IpcMainInvokeEvent) => void;
}

export function registerVaultIpcHandlers({ onSessionChange = () => {}, onUnlock = () => {}, onLock = () => {}, onVaultChange = () => {}, guard = () => {} }: VaultIpcOptions = {}): void {
  const handle = (channel: string, listener: (event: IpcMainInvokeEvent, ...args: never[]) => unknown): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        guard(event);
        return await listener(event, ...(args as never[]));
      } catch (error) {
        throw toVaultAppError(error);
      }
    });
  };
  const recent = new RecentVaults(join(app.getPath('userData'), 'settings.json'), join(app.getPath('userData'), 'last-vault.json'));
  // Packaged builds ship the helper as an extra resource, like the RDP helper.
  const hello = new HelloVaults(join(app.getPath('userData'), 'hello-unlock.json'), createHelloSigner(
    app.isPackaged ? join(process.resourcesPath, 'hello', 'Shellherd.Hello.exe') : join(__dirname, '../hello/Shellherd.Hello.exe'),
    app.isPackaged));
  // Renderer paths are untrusted: a UNC path alone would send the Windows login hash to its server.
  const requireAllowedPath = async (filePath: string, previous: LockedVault | undefined): Promise<void> => {
    if (!await vaultPathAllowed(filePath, vaultPathGrants, previous?.filePath, path => recent.has(path))) {
      throw new AppError('core.vaultPathNotAllowed');
    }
  };
  // Shared end of every unlock (password or Windows Hello).
  const finishUnlock = async (previous: LockedVault | undefined, snapshot: VaultSessionSnapshot): Promise<UnlockVaultResult> => {
    await recent.touch(snapshot.filePath);
    if (!resumesLocked(previous, snapshot)) onSessionChange();
    onUnlock();
    onVaultChange();
    return { filePath: snapshot.filePath, vault: snapshot.vault };
  };
  handle(IPC_CHANNELS.lastVaultFile, () => recent.latest());
  handle(IPC_CHANNELS.recentVaults, () => recent.list());
  handle(IPC_CHANNELS.removeRecentVault, async (_event, id: unknown) => {
    const list = await recent.remove(id);
    hello.forgetRecent(id);
    return list;
  });
  handle(IPC_CHANNELS.vaultDropFile, (_event, raw: unknown) => {
    const filePath = droppedVaultPath(raw);
    if (!filePath) throw new AppError('core.vaultPathNotAllowed');
    vaultPathGrants.grant(filePath);
    return filePath;
  });

  handle(IPC_CHANNELS.selectPrivateKeyFile, async (event): Promise<SelectVaultFileResult> => {
    vaultSessionManager.getSnapshot();
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = { title: mainT('dialogs.privateKey.title'), properties: ['openFile'] };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths[0] ? { canceled: true } : { canceled: false, filePath: result.filePaths[0] };
  });
  handle(
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
          : 'vault.term';

      const options = {
        title: mainT('dialogs.vaultSave.title'),
        defaultPath: suggestedName,
        filters: [
          {
            name: mainT('dialogs.vaultFilter'),
            extensions: ['term', 'terminus'],
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
      // A new vault file has a new salt: a stored Hello key for this path can never fit.
      hello.forgetQuietly(filePath);

      await vaultSessionManager.unlock(
        filePath,
        request.password,
      );
      await recent.touch(filePath);

      onSessionChange();
      onUnlock();
      return {
        canceled: false,
        filePath,
      };
    },
  );

  handle(
    IPC_CHANNELS.selectVaultFile,
    async (event): Promise<SelectVaultFileResult> => {
      const parentWindow =
        BrowserWindow.fromWebContents(event.sender);

      const options: OpenDialogOptions = {
        title: mainT('dialogs.vaultOpen.title'),
        // Starts in the folder of the last vault; any other file can still be picked.
        ...(await recent.latest().then(last => last ? { defaultPath: last } : {})),
        properties: ['openFile'],
        filters: [
          {
            name: mainT('dialogs.vaultFilter'),
            extensions: ['term', 'terminus'],
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

      vaultPathGrants.grant(filePath);
      return {
        canceled: false,
        filePath,
      };
    },
  );

  handle(
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
        throw new AppError('core.vaultFileMissing');
      }

      const previous = vaultSessionManager.lockedVault();
      await requireAllowedPath(request.filePath, previous);
      return finishUnlock(previous, await vaultSessionManager.unlock(request.filePath, request.password));
    },
  );

  handle(IPC_CHANNELS.helloStatus, (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096) throw new AppError('core.invalidRequest');
    return hello.status(filePath);
  });
  handle(IPC_CHANNELS.helloEnable, () => {
    const { filePath, salt } = vaultSessionManager.helloTarget();
    // The key is copied only after the prompt: a lock during the prompt leaves no copy behind and stores nothing.
    return hello.enable(filePath, salt, () => vaultSessionManager.keyCopy(filePath, salt));
  });
  handle(IPC_CHANNELS.helloDisable, () => {
    const { filePath } = vaultSessionManager.helloTarget();
    hello.forget(filePath);
    return hello.status(filePath);
  });
  handle(IPC_CHANNELS.helloUnlock, async (_event, request: HelloUnlockRequest | undefined): Promise<UnlockVaultResult> => {
    const filePath = request?.filePath;
    if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096) throw new AppError('core.vaultFileMissing');
    const previous = vaultSessionManager.lockedVault();
    await requireAllowedPath(filePath, previous);
    const file = await readEncryptedVaultFile(filePath);
    const key = await hello.unwrap(filePath, file.kdf.salt);
    let snapshot: VaultSessionSnapshot;
    try {
      snapshot = vaultSessionManager.openWithKey(filePath, file, key);
    } catch (error) {
      // Same salt, but the key does not open the file: the stored key is useless.
      if (error instanceof AppError && error.code === 'core.wrongPassword') {
        hello.forgetQuietly(filePath);
        throw new AppError('core.helloStale');
      }
      throw error;
    }
    return finishUnlock(previous, snapshot);
  });

  handle(
    IPC_CHANNELS.saveCurrentVault,
    async (
      _event,
      request: SaveCurrentVaultRequest,
    ): Promise<VaultSessionResult> => {
      let result: VaultSessionResult;
      try {
        result = await vaultSessionManager.save(
          request.vault,
        );
      } catch (error) {
        // Coded cause without path or raw text; unknown errors go through the generic mapping.
        const code = vaultWriteCode((error as NodeJS.ErrnoException)?.code);
        throw code ? new AppError(code) : error;
      }
      // save may have renamed the file (extension added), so the stored path must follow.
      await recent.touch(result.filePath);
      onVaultChange();
      return result;
    },
  );

  handle(
    IPC_CHANNELS.lockVault,
    (_event, request: LockVaultRequest | undefined) => {
      // Anything but a literal true keeps the sessions.
      const disconnect = request?.disconnect === true;
      if (disconnect) onSessionChange();
      vaultSessionManager.lock();
      // A switch announces nothing: secondary windows are closed and the main window navigates itself.
      if (!disconnect) onLock();
    },
  );
}
