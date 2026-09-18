import { contextBridge, ipcRenderer } from 'electron';

export interface DesktopApi {
  getVersion: () => Promise<string>;
}

const desktopApi: DesktopApi = {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
};

contextBridge.exposeInMainWorld('desktopApi', desktopApi);
