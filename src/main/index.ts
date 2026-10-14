import { app, BrowserWindow, clipboard, dialog, ipcMain } from 'electron';
import type { Rectangle } from 'electron';
import { join } from 'node:path';

import { createKnownHosts, registerSshIpcHandlers, requireSshSender } from './ssh/ipc';
import { registerFileIpcHandlers } from './files/ipc';
import type { SftpSessionManager } from './files/sftp-session';
import type { SshSessionManager } from './ssh/session';
import { rdpSurfaceMode, registerRdpIpcHandlers } from './rdp/ipc';
import type { RdpSessionManager } from './rdp/host';
import { windowRegistry } from './windows';
import type { WindowRole } from './windows';
import { registerWindowIpcHandlers } from './window-ipc';
import { FileAssociation, vaultFileFromArgs } from './file-association';
import { testConnection } from './connection-test';
import { ConnectionNodeSchema } from '../shared/vault/schema';

import { IPC_CHANNELS } from '../shared/ipc';
import {
  registerVaultIpcHandlers,
  vaultSessionManager,
} from './vault/ipc';


let sshSessionManager: SshSessionManager;
let rdpSessionManager: RdpSessionManager;
let sftpSessionManager: SftpSessionManager;

// SSH, local shells, RDP and SFTP share every lifecycle path: crash, navigation, close, lock and quit.
const closeOwnerSessions = (ownerId: number): void => {
  sshSessionManager.closeOwner(ownerId); rdpSessionManager.closeOwner(ownerId); sftpSessionManager.closeOwner(ownerId);
};
const closeAllSessions = (): void => { sshSessionManager?.closeAll(); rdpSessionManager?.closeAll(); sftpSessionManager?.closeAll(); };
const hasOwnerSessions = (ownerId: number): boolean =>
  sshSessionManager.hasOwner(ownerId) || rdpSessionManager.hasOwner(ownerId) || sftpSessionManager.hasOwner(ownerId);
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

/** Closing a detached window ends its connections; with the vault setting on, after a confirmation. */
function guardSecondaryWindowClose(window: BrowserWindow, ownerId: number): void {
  let confirming = false;
  const closeNow = (): void => {
    closeOwnerSessions(ownerId);
    windowRegistry.allowClose(ownerId);
    if (!window.isDestroyed()) window.close();
  };
  window.on('close', event => {
    if (windowRegistry.closeAllowed(ownerId) || !hasOwnerSessions(ownerId)) { closeOwnerSessions(ownerId); return; }
    let confirm = true;
    try { confirm = vaultSessionManager.getSnapshot().vault.settings.confirmBeforeClosingSession; } catch { /* locked */ }
    if (!confirm) { closeOwnerSessions(ownerId); return; }
    event.preventDefault();
    if (confirming) return;
    confirming = true;
    void dialog.showMessageBox(window, {
      type: 'question', title: 'Fenster schließen', message: 'Alle Verbindungen in diesem Fenster trennen und das Fenster schließen?',
      detail: 'Tabs, die du behalten willst, ziehst du vorher in ein anderes Fenster.',
      buttons: ['Abbrechen', 'Trennen und schließen'], defaultId: 0, cancelId: 0, noLink: true,
    }).then(result => { if (result.response === 1) closeNow(); }).catch(() => {}).finally(() => { confirming = false; });
  });
}

// One Terminus per user: a vault opened from Explorer goes to the running window.
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
let launchFile = vaultFileFromArgs(process.argv);
app.on('second-instance', (_event, argv) => {
  const main = windowRegistry.main();
  if (!main) return;
  if (main.isMinimized()) main.restore();
  main.focus();
  const file = vaultFileFromArgs(argv);
  if (file) main.webContents.send(IPC_CHANNELS.vaultOpenFile, file);
});

// Experimental variant A only: child windows from the helper are invisible under DirectComposition.
if (rdpSurfaceMode() === 'child') app.commandLine.appendSwitch('disable-direct-composition');

app.whenReady().then(() => {
  if (!singleInstance) return;
  const association = new FileAssociation(process.execPath, process.defaultApp ? app.getAppPath() : null);
  ipcMain.handle(IPC_CHANNELS.vaultLaunchFile, event => {
    windowRegistry.requireMain(event);
    const file = launchFile;
    launchFile = null;
    return file;
  });
  ipcMain.handle(IPC_CHANNELS.fileTypeStatus, event => { windowRegistry.requireMain(event); return association.registered(); });
  ipcMain.handle(IPC_CHANNELS.fileTypeRegister, async event => { windowRegistry.requireMain(event); await association.register(); });
  ipcMain.handle(IPC_CHANNELS.fileTypeUnregister, async event => { windowRegistry.requireMain(event); await association.unregister(); });

  ipcMain.handle(
    IPC_CHANNELS.getVersion,
    () => app.getVersion(),
  );

  const knownHosts = createKnownHosts();
  sshSessionManager = registerSshIpcHandlers(knownHosts);
  rdpSessionManager = registerRdpIpcHandlers();
  sftpSessionManager = registerFileIpcHandlers(knownHosts);
  // Dry run with the form's current values; only the main window may test, nothing is stored or logged.
  ipcMain.handle(IPC_CHANNELS.connectionTest, (event, request: unknown) => {
    windowRegistry.requireMain(event);
    vaultSessionManager.getSnapshot();
    const parsed = ConnectionNodeSchema.safeParse(request);
    if (!parsed.success) throw new Error('Bitte prüfe die Verbindungsdaten.');
    return testConnection(parsed.data, { verifyHost: (host, port, key, isActive) => knownHosts.verify(host, port, key, isActive) });
  });
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
    registry: windowRegistry, ssh: sshSessionManager, rdp: rdpSessionManager, sftp: sftpSessionManager, closeOwnerSessions,
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
