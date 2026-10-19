import { ipcMain, webContents } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc';
import { KubeActionRequestSchema, KubeDetailRequestSchema, KubeOpenRequestSchema, KubeProbeRequestSchema, KubeSubscribeRequestSchema, KubeViewRequestSchema } from '../../shared/kubernetes-schema';
import type { KubeProbeResult } from '../../shared/kubernetes';
import type { ConnectionNode, SshConnectionNode } from '../../shared/vault/types';
import { openRemoteHost } from '../containers/runner';
import type { SudoRejections } from '../containers/sudo-rejections';
import { vaultSessionManager } from '../vault/ipc';
import type { KnownHosts } from '../ssh/known-hosts';
import { requireSshSender } from '../ssh/ipc';
import { findConnection, publicError } from '../ssh/session';
import { parseRequest } from '../ssh/validation';
import { openAccess, readKubeconfig } from './access';
import { createKubeApi } from './client-api';
import { KubeSessions, userMessage } from './session';
import { openTunnel } from './tunnel';
import { listContexts } from './kubeconfig';

type Handler = (event: IpcMainInvokeEvent, request: unknown) => unknown;

/** Shows only messages that are meant for the user; anything else becomes the generic SSH message. */
function handle(channel: string, handler: Handler): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, request: unknown) => {
    try {
      return await handler(event, request);
    } catch (error) {
      throw new Error(userMessage(error) ?? publicError(error));
    }
  });
}

export function registerKubernetesIpcHandlers(knownHosts: KnownHosts, sudoRejections: SudoRejections): KubeSessions {
  const getConnection = (id: string): ConnectionNode | undefined => findConnection(vaultSessionManager.getSnapshot().vault.nodes, id);
  const openRemote = (connection: SshConnectionNode) =>
    openRemoteHost(connection, (host, port, key, isActive) => knownHosts.verify(host, port, key, isActive));

  const sessions = new KubeSessions({
    getCluster: id => {
      const node = getConnection(id);
      if (node?.protocol !== 'kubernetes') throw new Error('Der Cluster wurde nicht gefunden.');
      return node;
    },
    openAccess: cluster => openAccess(cluster, { getConnection, openRemote, sudoRejections }),
    openTunnel: (access, target) => openTunnel((host, port) => access.host.forward(host, port), target),
    createApi: createKubeApi,
    emit: (ownerId, event) => {
      const owner = webContents.fromId(ownerId);
      if (owner && !owner.isDestroyed()) owner.send(IPC_CHANNELS.kubeEvent, event);
    },
  });

  handle(IPC_CHANNELS.kubeOpen, (event, request) => sessions.open(requireSshSender(event), parseRequest(KubeOpenRequestSchema, request).clusterId));
  handle(IPC_CHANNELS.kubeSubscribe, (event, request) => {
    const ownerId = requireSshSender(event);
    const parsed = parseRequest(KubeSubscribeRequestSchema, request);
    return sessions.subscribe(ownerId, parsed.viewId, parsed.query);
  });
  handle(IPC_CHANNELS.kubeDetail, (event, request) => {
    const ownerId = requireSshSender(event);
    const parsed = parseRequest(KubeDetailRequestSchema, request);
    return sessions.detail(ownerId, parsed.viewId, parsed.ref, parsed.mode);
  });
  handle(IPC_CHANNELS.kubeAction, (event, request) => {
    const ownerId = requireSshSender(event);
    const parsed = parseRequest(KubeActionRequestSchema, request);
    return sessions.action(ownerId, parsed.viewId, { ref: parsed.ref, action: parsed.action, replicas: parsed.replicas });
  });
  handle(IPC_CHANNELS.kubeClose, (event, request) => {
    const ownerId = requireSshSender(event);
    sessions.close(ownerId, parseRequest(KubeViewRequestSchema, request).viewId);
  });
  // Reads the contexts of a kubeconfig on an SSH host; the config text itself never leaves the main process.
  handle(IPC_CHANNELS.kubeProbe, async (event, request): Promise<KubeProbeResult> => {
    requireSshSender(event);
    const connection = getConnection(parseRequest(KubeProbeRequestSchema, request).connectionId);
    if (connection?.protocol !== 'ssh') throw new Error('Bitte wähle eine SSH-Verbindung.');
    if (connection.disabled) throw new Error('Diese Verbindung ist deaktiviert.');
    const host = await openRemote(connection);
    try {
      const { text, source } = await readKubeconfig(host, connection, { source: 'auto' }, sudoRejections);
      return { source, ...listContexts(text) };
    } finally {
      host.close();
    }
  });
  return sessions;
}

