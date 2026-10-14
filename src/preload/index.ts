import {
  contextBridge,
  ipcRenderer,
  webUtils,
} from 'electron';

import type { IpcRendererEvent } from 'electron';
import type { SshEvent } from '../shared/ssh';
import type { RdpEvent } from '../shared/rdp';
import type { DesktopApi } from '../shared/ipc';

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T): void => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const desktopApi: DesktopApi = {
  windowReady: () => ipcRenderer.invoke('window:ready'),
  windowCloseReady: () => ipcRenderer.invoke('window:close-ready'),
  onWindowEvacuate: listener => subscribe('window:evacuate', listener),
  connectionCatalog: () => ipcRenderer.invoke('window:connection-catalog'),
  onConnectionCatalog: listener => subscribe('window:connection-catalog-changed', listener),
  transferTab: request => ipcRenderer.invoke('tabs:transfer', request),
  onIncomingTab: listener => subscribe('tabs:incoming', listener),
  transferView: request => ipcRenderer.invoke('views:transfer', request),
  onIncomingView: listener => subscribe('views:incoming', listener),
  tabDragMove: point => ipcRenderer.send('tabs:drag-move', point),
  onTabDragHover: listener => subscribe('tabs:drag-hover', listener),
  workspaceWindows: () => ipcRenderer.invoke('workspace:windows'),
  onWorkspaceCollect: listener => subscribe('workspace:collect', listener),
  workspaceReport: report => ipcRenderer.invoke('workspace:report', report),
  openWorkspaceWindows: windows => ipcRenderer.invoke('workspace:open-windows', windows),
  onWorkspaceRestore: listener => subscribe('workspace:restore', listener),
  closeSecondaryWindows: () => ipcRenderer.invoke('window:close-secondaries'),
  readClipboardText: () => ipcRenderer.invoke('clipboard:read-text'),
  writeClipboardText: text => ipcRenderer.invoke('clipboard:write-text', text),
  sshPrepare: request => ipcRenderer.invoke('ssh:prepare', request),
  sshConnect: request => ipcRenderer.invoke('ssh:connect', request),
  sshInput: request => ipcRenderer.invoke('ssh:input', request),
  sshResize: request => ipcRenderer.invoke('ssh:resize', request),
  sshAck: request => ipcRenderer.invoke('ssh:ack', request),
  sshClose: request => ipcRenderer.invoke('ssh:close', request),
  sshAttach: request => ipcRenderer.invoke('ssh:attach', request),
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
  rdpAction: request => ipcRenderer.invoke('rdp:action', request),
  onRdpEvent: listener => {
    const handler = (_event: IpcRendererEvent, event: RdpEvent): void => listener(event);
    ipcRenderer.on('rdp:event', handler);
    return () => ipcRenderer.removeListener('rdp:event', handler);
  },
  sftpOpen: request => ipcRenderer.invoke('sftp:open', request),
  sftpHome: request => ipcRenderer.invoke('sftp:home', request),
  sftpList: request => ipcRenderer.invoke('sftp:list', request),
  sftpMkdir: request => ipcRenderer.invoke('sftp:mkdir', request),
  sftpRename: request => ipcRenderer.invoke('sftp:rename', request),
  sftpDelete: request => ipcRenderer.invoke('sftp:delete', request),
  sftpTransfer: request => ipcRenderer.invoke('sftp:transfer', request),
  sftpCancel: request => ipcRenderer.invoke('sftp:cancel', request),
  sftpResolve: request => ipcRenderer.invoke('sftp:resolve', request),
  sftpClearFinished: request => ipcRenderer.invoke('sftp:clear-finished', request),
  sftpState: request => ipcRenderer.invoke('sftp:state', request),
  sftpClose: request => ipcRenderer.invoke('sftp:close', request),
  sftpChmod: request => ipcRenderer.invoke('sftp:chmod', request),
  sftpEdit: request => ipcRenderer.invoke('sftp:edit', request),
  sftpCreateFile: request => ipcRenderer.invoke('sftp:create-file', request),
  localCreateFile: request => ipcRenderer.invoke('local:create-file', request),
  localOpen: request => ipcRenderer.invoke('local:open', request),
  sftpEditOpen: request => ipcRenderer.invoke('sftp:edit-open', request),
  sftpEditUpload: request => ipcRenderer.invoke('sftp:edit-upload', request),
  sftpEditClose: request => ipcRenderer.invoke('sftp:edit-close', request),
  onSftpEvent: listener => subscribe('sftp:event', listener),
  localPlaces: () => ipcRenderer.invoke('local:places'),
  localList: request => ipcRenderer.invoke('local:list', request),
  localMkdir: request => ipcRenderer.invoke('local:mkdir', request),
  localRename: request => ipcRenderer.invoke('local:rename', request),
  localDelete: request => ipcRenderer.invoke('local:delete', request),
  pathForFile: file => webUtils.getPathForFile(file),
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
