import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';

import { IPC_CHANNELS } from '../shared/ipc';
import { registerVaultIpcHandlers } from './vault/ipc';

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
    },
  });

  window.webContents.openDevTools({
    mode: 'detach',
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

  registerVaultIpcHandlers();
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