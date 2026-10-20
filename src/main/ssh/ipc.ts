import { app, BrowserWindow, dialog, ipcMain, webContents } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { spawn as spawnShell } from 'node-pty';
import { AppError } from '../../shared/errors';
import { IPC_CHANNELS } from '../../shared/ipc';
import { mainT } from '../i18n';
import { vaultSessionManager } from '../vault/ipc';
import { KnownHosts } from './known-hosts';
import { findConnection, SshSessionManager } from './session';
import type { SshDependencies } from './session';
import { SudoRejections } from '../containers/sudo-rejections';
import { AckSchema, InputSchema, PrepareSchema, ResizeSchema, SessionSchema, parseRequest } from './validation';

export function requireSshSender(event: IpcMainInvokeEvent): number {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || event.sender.isDestroyed() || event.senderFrame !== event.sender.mainFrame) {
    throw new AppError('ssh.senderNotAllowed');
  }
  return event.sender.id;
}

/** One instance for terminals and file transfers: it serializes confirmations and writes. */
export function createKnownHosts(): KnownHosts {
  return new KnownHosts(join(app.getPath('userData'), 'known-hosts.json'), async prompt => {
    const parent = BrowserWindow.getFocusedWindow();
    const options = {
      type: 'warning' as const,
      title: mainT('dialogs.hostKey.title'),
      message: mainT('dialogs.hostKey.message', { host: prompt.host, port: prompt.port }),
      detail: mainT('dialogs.hostKey.detail', { fingerprint: prompt.fingerprint }),
      buttons: [mainT('dialogs.cancel'), mainT('dialogs.hostKey.confirm')], defaultId: 0, cancelId: 0, noLink: true,
    };
    const result = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
    return result.response === 1;
  });
}

export function registerSshIpcHandlers(knownHosts: KnownHosts, sudoRejections = new SudoRejections(),
  openKubeTerminal?: SshDependencies['openKubeTerminal']): SshSessionManager {
  const manager = new SshSessionManager({
    sudoRejections,
    openKubeTerminal,
    getConnection: id => {
      const connection = findConnection(vaultSessionManager.getSnapshot().vault.nodes, id);
      if (!connection) throw new AppError('ssh.connectionNotFound');
      return connection;
    },
    spawnShell,
    verifyHost: (host, port, key, isActive) => knownHosts.verify(host, port, key, isActive),
    emit: (ownerId, event) => {
      const owner = webContents.fromId(ownerId);
      if (owner && !owner.isDestroyed()) owner.send(IPC_CHANNELS.sshEvent, event);
    },
  });
  ipcMain.handle(IPC_CHANNELS.sshPrepare, (event, request: unknown) => manager.prepare(requireSshSender(event), parseRequest(PrepareSchema, request)));
  ipcMain.handle(IPC_CHANNELS.sshConnect, (event, request: unknown) => manager.connect(requireSshSender(event), parseRequest(SessionSchema, request).sessionId));
  ipcMain.handle(IPC_CHANNELS.sshInput, (event, request: unknown) => {
    const ownerId = requireSshSender(event);
    const parsed = parseRequest(InputSchema, request);
    return manager.input(ownerId, parsed.sessionId, parsed.data);
  });
  ipcMain.handle(IPC_CHANNELS.sshResize, (event, request: unknown) => {
    const ownerId = requireSshSender(event);
    const parsed = parseRequest(ResizeSchema, request);
    manager.resize(ownerId, parsed.sessionId, parsed);
  });
  ipcMain.handle(IPC_CHANNELS.sshAck, (event, request: unknown) => {
    const ownerId = requireSshSender(event);
    const parsed = parseRequest(AckSchema, request);
    // A final output acknowledgment may arrive after a remote close.
    manager.acknowledge(ownerId, parsed.sessionId, parsed.sequence);
  });
  ipcMain.handle(IPC_CHANNELS.sshAttach, (event, request: unknown) => manager.attach(requireSshSender(event), parseRequest(SessionSchema, request).sessionId));
  ipcMain.handle(IPC_CHANNELS.sshClose, (event, request: unknown) => manager.close(requireSshSender(event), parseRequest(SessionSchema, request).sessionId));
  return manager;
}
