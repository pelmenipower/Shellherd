import {
  contextBridge,
  ipcRenderer,
} from 'electron';

import type { DesktopApi } from '../shared/ipc';

const desktopApi: DesktopApi = {
  getVersion: () =>
    ipcRenderer.invoke('app:get-version'),

  saveVault: (request) =>
    ipcRenderer.invoke('vault:save', request),

  openVault: (request) =>
    ipcRenderer.invoke('vault:open', request),
};

contextBridge.exposeInMainWorld(
  'desktopApi',
  desktopApi,
);