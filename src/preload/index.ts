import {
  contextBridge,
  ipcRenderer,
  webUtils,
} from 'electron';

import type { IpcRendererEvent } from 'electron';
import type { KubeEvent } from '../shared/kubernetes';
import type { DesktopApi } from '../shared/ipc';
import { LOCALE_ARG } from '../shared/locale';

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T): void => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const localeArg = process.argv.find(arg => arg.startsWith(LOCALE_ARG))?.slice(LOCALE_ARG.length);

const desktopApi: DesktopApi = {
  windowReady: () => ipcRenderer.invoke('window:ready'),
  windowCloseReady: () => ipcRenderer.invoke('window:close-ready'),
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
  vaultLaunchFile: () => ipcRenderer.invoke('vault:launch-file'),
  lastVaultFile: () => ipcRenderer.invoke('vault:last-file'),
  connectionTest: connection => ipcRenderer.invoke('connection:test', connection),
  containersList: request => ipcRenderer.invoke('containers:list', request),
  containersAction: request => ipcRenderer.invoke('containers:action', request),
  containersInventory: request => ipcRenderer.invoke('containers:inventory', request),
  containersInspect: request => ipcRenderer.invoke('containers:inspect', request),
  aiCatalog: () => ipcRenderer.invoke('ai:catalog'),
  onAiCatalog: listener => subscribe('ai:catalog-changed', listener),
  aiAsk: request => ipcRenderer.invoke('ai:ask', request),
  aiCancel: request => ipcRenderer.invoke('ai:cancel', request),
  onAiEvent: listener => subscribe('ai:event', listener),
  aiTest: provider => ipcRenderer.invoke('ai:test', provider),
  vaultActivity: () => ipcRenderer.send('vault:activity'),
  onVaultLocked: listener => subscribe('vault:locked', listener),
  onVaultUnlocked: listener => subscribe('vault:unlocked', listener),
  onVaultOpenFile: listener => subscribe('vault:open-file', listener),
  fileTypeStatus: () => ipcRenderer.invoke('app:file-type-status'),
  fileTypeRegister: () => ipcRenderer.invoke('app:file-type-register'),
  fileTypeUnregister: () => ipcRenderer.invoke('app:file-type-unregister'),
  initialLocale: localeArg === 'en-US' ? 'en-US' : 'de-DE',
  getLanguage: () => ipcRenderer.invoke('app:get-language'),
  setLanguage: setting => ipcRenderer.invoke('app:set-language', setting),
  onLocaleChanged: listener => subscribe('app:locale-changed', listener),
  readClipboardText: () => ipcRenderer.invoke('clipboard:read-text'),
  writeClipboardText: text => ipcRenderer.invoke('clipboard:write-text', text),
  sshPrepare: request => ipcRenderer.invoke('ssh:prepare', request),
  sshConnect: request => ipcRenderer.invoke('ssh:connect', request),
  sshInput: request => ipcRenderer.invoke('ssh:input', request),
  sshResize: request => ipcRenderer.invoke('ssh:resize', request),
  sshAck: request => ipcRenderer.invoke('ssh:ack', request),
  sshClose: request => ipcRenderer.invoke('ssh:close', request),
  sshAttach: request => ipcRenderer.invoke('ssh:attach', request),
  onSshEvent: listener => subscribe('ssh:event', listener),
  rdpOpen: request => ipcRenderer.invoke('rdp:open', request),
  rdpBounds: request => ipcRenderer.invoke('rdp:bounds', request),
  rdpVisible: request => ipcRenderer.invoke('rdp:visible', request),
  rdpFocus: request => ipcRenderer.invoke('rdp:focus', request),
  rdpClose: request => ipcRenderer.invoke('rdp:close', request),
  rdpAction: request => ipcRenderer.invoke('rdp:action', request),
  onRdpEvent: listener => subscribe('rdp:event', listener),
  kubeOpen: request => ipcRenderer.invoke('k8s:open', request),
  kubeSubscribe: request => ipcRenderer.invoke('k8s:subscribe', request),
  kubeDetail: request => ipcRenderer.invoke('k8s:detail', request),
  kubeAction: request => ipcRenderer.invoke('k8s:action', request),
  kubeClose: request => ipcRenderer.invoke('k8s:close', request),
  kubeProbe: request => ipcRenderer.invoke('k8s:probe', request),
  onKubeEvent: listener => subscribe('k8s:event', listener),
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
  sftpSyncStart: request => ipcRenderer.invoke('sftp:sync-start', request),
  sftpSyncStop: request => ipcRenderer.invoke('sftp:sync-stop', request),
  sftpSyncForce: request => ipcRenderer.invoke('sftp:sync-force', request),
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

  lockVault: (request) =>
    ipcRenderer.invoke('vault:lock', request),
};

contextBridge.exposeInMainWorld(
  'desktopApi',
  desktopApi,
);
