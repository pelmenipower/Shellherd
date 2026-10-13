import { app, BrowserWindow, clipboard, dialog, ipcMain } from 'electron';
import { join } from 'node:path';

import { registerSshIpcHandlers, requireSshSender } from './ssh/ipc';
import type { SshSessionManager } from './ssh/session';
import { registerRdpIpcHandlers } from './rdp/ipc';
import type { RdpSessionManager } from './rdp/host';

import { IPC_CHANNELS } from '../shared/ipc';
import {
  registerVaultIpcHandlers,
  vaultSessionManager,
} from './vault/ipc';


let sshSessionManager: SshSessionManager;
let rdpSessionManager: RdpSessionManager;

// SSH and RDP share every lifecycle path: crash, navigation, close, lock and quit.
const closeOwnerSessions = (ownerId: number): void => { sshSessionManager.closeOwner(ownerId); rdpSessionManager.closeOwner(ownerId); };
const closeAllSessions = (): void => { sshSessionManager?.closeAll(); rdpSessionManager?.closeAll(); };
const hasOwnerSessions = (ownerId: number): boolean => sshSessionManager.hasOwner(ownerId) || rdpSessionManager.hasOwner(ownerId);

function createMainWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b1120',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('render-process-gone', () => closeOwnerSessions(window.webContents.id));
  const ownerId = window.webContents.id;
  window.webContents.on('destroyed', () => closeOwnerSessions(ownerId));
  window.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) closeOwnerSessions(ownerId);
  });
  let closing = false;
  let confirmingClose = false;
  window.on('close', event => {
    if (closing || !hasOwnerSessions(ownerId)) return;
    let confirm = true;
    try { confirm = vaultSessionManager.getSnapshot().vault.settings.confirmBeforeClosingSession; } catch { /* locked */ }
    if (!confirm) { closeOwnerSessions(ownerId); return; }
    event.preventDefault();
    if (confirmingClose) return;
    confirmingClose = true;
    void dialog.showMessageBox(window, {
      type: 'question', title: 'Terminus schließen', message: 'Alle aktiven Verbindungen trennen und Terminus schließen?',
      buttons: ['Abbrechen', 'Trennen und schließen'], defaultId: 0, cancelId: 0, noLink: true,
    }).then(result => {
      if (result.response === 1 && !window.isDestroyed()) {
        closing = true;
        closeOwnerSessions(ownerId);
        window.close();
      }
    }).catch(() => {}).finally(() => { confirmingClose = false; });
  });

  window.once('ready-to-show', () => window.show());

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(
      join(__dirname, '../renderer/index.html'),
    );
  }
}

app.whenReady().then(() => {
  ipcMain.handle(
    IPC_CHANNELS.getVersion,
    () => app.getVersion(),
  );

  sshSessionManager = registerSshIpcHandlers();
  rdpSessionManager = registerRdpIpcHandlers();
  ipcMain.handle(IPC_CHANNELS.readClipboardText, event => {
    requireSshSender(event);
    vaultSessionManager.getSnapshot();
    return clipboard.readText();
  });
  ipcMain.handle(IPC_CHANNELS.writeClipboardText, (event, text: unknown) => {
    requireSshSender(event);
    vaultSessionManager.getSnapshot();
    if (typeof text !== 'string' || text.length > 4 * 1024 * 1024) throw new Error('Der markierte Text ist zu groß.');
    clipboard.writeText(text);
  });
  registerVaultIpcHandlers(closeAllSessions);
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  closeAllSessions();
  rdpSessionManager?.dispose();
  vaultSessionManager.lock();
});
