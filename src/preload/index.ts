import {
  contextBridge,
  ipcRenderer,
} from 'electron';

import type { IpcRendererEvent } from 'electron';
import type { SshEvent } from '../shared/ssh';
import type { RdpEvent } from '../shared/rdp';
import type { DesktopApi } from '../shared/ipc';

const desktopApi: DesktopApi = {
  readClipboardText: () => ipcRenderer.invoke('clipboard:read-text'),
  writeClipboardText: text => ipcRenderer.invoke('clipboard:write-text', text),
  sshPrepare: request => ipcRenderer.invoke('ssh:prepare', request),
  sshConnect: request => ipcRenderer.invoke('ssh:connect', request),
  sshInput: request => ipcRenderer.invoke('ssh:input', request),
  sshResize: request => ipcRenderer.invoke('ssh:resize', request),
  sshAck: request => ipcRenderer.invoke('ssh:ack', request),
  sshClose: request => ipcRenderer.invoke('ssh:close', request),
  onSshEvent: listener => {
    const handler = (_event: IpcRendererEvent, event: SshEvent): void => listener(event);
    ipcRenderer.on('ssh:event', handler);
    return () => ipcRenderer.removeListener('ssh:event', handler);
  },
  rdpOpen: request => ipcRenderer.invoke('rdp:open', request),
  rdpBounds: request => ipcRenderer.invoke('rdp:bounds', request),
  rdpVisible: request => ipcRenderer.invoke('rdp:visible', request),
  rdpFocus: request => ipcRenderer.invoke('rdp:focus', request),
  rdpClose: request => ipcRenderer.invoke('rdp:close', request),
  rdpDebugHang: request => ipcRenderer.invoke('rdp:debug-hang', request),
  onRdpEvent: listener => {
    const handler = (_event: IpcRendererEvent, event: RdpEvent): void => listener(event);
    ipcRenderer.on('rdp:event', handler);
    return () => ipcRenderer.removeListener('rdp:event', handler);
  },
  getVersion: () =>
    ipcRenderer.invoke('app:get-version'),

  saveVault: (request) =>
    ipcRenderer.invoke('vault:save', request),

  selectVaultFile: () =>
    ipcRenderer.invoke('vault:select-file'),
  selectPrivateKeyFile: () => ipcRenderer.invoke('ssh:select-key-file'),

  unlockVault: (request) =>
    ipcRenderer.invoke('vault:unlock', request),

  saveCurrentVault: (request) =>
    ipcRenderer.invoke('vault:save-current', request),

  lockVault: () =>
    ipcRenderer.invoke('vault:lock'),
};

contextBridge.exposeInMainWorld(
  'desktopApi',
  desktopApi,
);
