import { app, BrowserWindow, clipboard, dialog, ipcMain } from 'electron';
import type { Rectangle } from 'electron';
import { join } from 'node:path';

import { registerSshIpcHandlers, requireSshSender } from './ssh/ipc';
import type { SshSessionManager } from './ssh/session';
import { rdpSurfaceMode, registerRdpIpcHandlers } from './rdp/ipc';
import type { RdpSessionManager } from './rdp/host';
import { windowRegistry } from './windows';
import type { WindowRole } from './windows';
import { registerWindowIpcHandlers } from './window-ipc';

import { IPC_CHANNELS } from '../shared/ipc';
import {
  registerVaultIpcHandlers,
  vaultSessionManager,
} from './vault/ipc';


let sshSessionManager: SshSessionManager;
let rdpSessionManager: RdpSessionManager;

// SSH, local shells and RDP share every lifecycle path: crash, navigation, close, lock and quit.
const closeOwnerSessions = (ownerId: number): void => { sshSessionManager.closeOwner(ownerId); rdpSessionManager.closeOwner(ownerId); };
const closeAllSessions = (): void => { sshSessionManager?.closeAll(); rdpSessionManager?.closeAll(); };
const hasOwnerSessions = (ownerId: number): boolean => sshSessionManager.hasOwner(ownerId) || rdpSessionManager.hasOwner(ownerId);
const hasAnySessions = (): boolean => BrowserWindow.getAllWindows().some(window => !window.isDestroyed() && hasOwnerSessions(window.webContents.id));

/** Detached windows close without moving their tabs (vault lock, workspace replacement, app exit). */
function closeSecondaryWindows(): void {
  for (const window of windowRegistry.secondaries()) {
    closeOwnerSessions(window.webContents.id);
    windowRegistry.allowClose(window.webContents.id);
    window.close();
  }
}

function createWindow(role: WindowRole, bounds?: Rectangle): BrowserWindow {
  const window = new BrowserWindow({
    ...(bounds ?? { width: 1280, height: 800 }),
    minWidth: role === 'main' ? 900 : 480,
    minHeight: role === 'main' ? 600 : 320,
    title: role === 'main' ? 'Terminus' : 'Terminus – Sitzungen',
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
  windowRegistry.register(window, role);

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('render-process-gone', () => closeOwnerSessions(window.webContents.id));
  const ownerId = window.webContents.id;
  window.webContents.on('destroyed', () => closeOwnerSessions(ownerId));
  window.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) closeOwnerSessions(ownerId);
  });
  if (role === 'main') guardMainWindowClose(window, ownerId);
  else guardSecondaryWindowClose(window, ownerId);

  window.once('ready-to-show', () => window.show());

  const query = role === 'secondary' ? { role: 'secondary' } : undefined;
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}${query ? '?role=secondary' : ''}`);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), query ? { query } : undefined);
  }
  return window;
}

/** Closing the main window ends the app; sessions in all windows are confirmed together. */
function guardMainWindowClose(window: BrowserWindow, ownerId: number): void {
  let closing = false;
  let confirmingClose = false;
  window.on('close', event => {
    if (closing || !hasAnySessions()) { closeSecondaryWindows(); return; }
    let confirm = true;
    try { confirm = vaultSessionManager.getSnapshot().vault.settings.confirmBeforeClosingSession; } catch { /* locked */ }
    if (!confirm) { closeAllSessions(); closeSecondaryWindows(); return; }
    event.preventDefault();
    if (confirmingClose) return;
    confirmingClose = true;
    void dialog.showMessageBox(window, {
      type: 'question', title: 'Terminus schließen', message: 'Alle aktiven Verbindungen in allen Fenstern trennen und Terminus schließen?',
      buttons: ['Abbrechen', 'Trennen und schließen'], defaultId: 0, cancelId: 0, noLink: true,
    }).then(result => {
      if (result.response === 1 && !window.isDestroyed()) {
        closing = true;
        closeOwnerSessions(ownerId);
        closeAllSessions();
        window.close();
      }
    }).catch(() => {}).finally(() => { confirmingClose = false; });
  });
}

/** A detached window first moves its tabs to the main window; a timeout guarantees it closes anyway. */
function guardSecondaryWindowClose(window: BrowserWindow, ownerId: number): void {
  let evacuating = false;
  window.on('close', event => {
    if (windowRegistry.closeAllowed(ownerId) || !hasOwnerSessions(ownerId) || !windowRegistry.main()) return;
    event.preventDefault();
    if (evacuating) return;
    evacuating = true;
    window.webContents.send(IPC_CHANNELS.windowEvacuate);
    setTimeout(() => {
      if (window.isDestroyed()) return;
      windowRegistry.allowClose(ownerId);
      window.close();
    }, 5_000).unref();
  });
}

// Experimental variant A only: child windows from the helper are invisible under DirectComposition.
if (rdpSurfaceMode() === 'child') app.commandLine.appendSwitch('disable-direct-composition');

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
  const { broadcastCatalog } = registerWindowIpcHandlers({
    registry: windowRegistry, ssh: sshSessionManager, rdp: rdpSessionManager, closeOwnerSessions,
    createSecondary: bounds => createWindow('secondary', bounds),
  });
  registerVaultIpcHandlers({
    onSessionChange: () => { closeAllSessions(); closeSecondaryWindows(); },
    onVaultChange: () => { broadcastCatalog(); rdpSessionManager.prewarm(); },
    guard: event => windowRegistry.requireMain(event),
  });
  createWindow('main');

  app.on('activate', () => {
    if (!windowRegistry.main()) {
      createWindow('main');
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
