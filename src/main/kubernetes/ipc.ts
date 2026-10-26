import { ipcMain, shell, webContents } from 'electron';
import { AppError } from '../../shared/errors';
import type { IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc';
import { KubeAccessRequestSchema, KubeActionRequestSchema, KubeArgoRequestSchema, KubeDetailRequestSchema, KubeDiagnoseRequestSchema, KubeForwardStartRequestSchema, KubeForwardStopRequestSchema, KubeLogsStartRequestSchema, KubeLogsStopRequestSchema, KubeOpenLinkRequestSchema, KubeOpenRequestSchema, KubeProbeRequestSchema, KubeSubscribeRequestSchema, KubeViewRequestSchema } from '../../shared/kubernetes-schema';
import type { KubeProbeResult } from '../../shared/kubernetes';
import type { ConnectionNode, SshConnectionNode } from '../../shared/vault/types';
import { openRemoteWithJump } from '../containers/ipc';
import type { SudoRejections } from '../containers/sudo-rejections';
import { vaultSessionManager } from '../vault/ipc';
import type { AuthPrompts } from '../ssh/auth-prompts';
import type { KnownHosts } from '../ssh/known-hosts';
import { requireSshSender } from '../ssh/ipc';
import { findConnection, publicError } from '../ssh/session';
import { parseRequest } from '../ssh/validation';
import { openAccess, readKubeconfig } from './access';
import { createKubeApi } from './client-api';
import { KubeSessions, openableHref, userError } from './session';
import { openTunnel } from './tunnel';
import { listContexts } from './kubeconfig';

type Handler = (event: IpcMainInvokeEvent, request: unknown) => unknown;

/** Throws only coded errors that are meant for the user; anything else becomes the generic SSH code. */
function handle(channel: string, handler: Handler): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, request: unknown) => {
    try {
      return await handler(event, request);
    } catch (error) {
      throw AppError.from(userError(error) ?? publicError(error));
    }
  });
}

export function registerKubernetesIpcHandlers(knownHosts: KnownHosts, prompts: AuthPrompts, sudoRejections: SudoRejections): KubeSessions {
  const getConnection = (id: string): ConnectionNode | undefined => findConnection(vaultSessionManager.getSnapshot().vault.nodes, id);
  const openRemote = (connection: SshConnectionNode) => openRemoteWithJump(connection, knownHosts, prompts);

  const sessions = new KubeSessions({
    getCluster: id => {
      const node = getConnection(id);
      if (node?.protocol !== 'kubernetes') throw new AppError('kubernetes.clusterNotFound');
      return node;
    },
    openAccess: (cluster, onTry) => openAccess(cluster, { getConnection, openRemote, sudoRejections }, onTry),
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
  handle(IPC_CHANNELS.kubeForwardStart, (event, request) => {
    const ownerId = requireSshSender(event);
    const parsed = parseRequest(KubeForwardStartRequestSchema, request);
    return sessions.startForward(ownerId, parsed.viewId, parsed.target, parsed.localPort);
  });
  handle(IPC_CHANNELS.kubeForwardStop, (event, request) => {
    const ownerId = requireSshSender(event);
    const parsed = parseRequest(KubeForwardStopRequestSchema, request);
    sessions.stopForward(ownerId, parsed.viewId, parsed.forwardId);
  });
  handle(IPC_CHANNELS.kubeLogsStart, (event, request) => {
    const ownerId = requireSshSender(event);
    const parsed = parseRequest(KubeLogsStartRequestSchema, request);
    return sessions.startLogs(ownerId, parsed.viewId, { id: parsed.id, namespace: parsed.namespace, selector: parsed.selector, format: parsed.format });
  });
  handle(IPC_CHANNELS.kubeLogsStop, (event, request) => {
    const ownerId = requireSshSender(event);
    const parsed = parseRequest(KubeLogsStopRequestSchema, request);
    sessions.stopLogs(ownerId, parsed.viewId, parsed.id);
  });
  handle(IPC_CHANNELS.kubeAccess, (event, request) => {
    const ownerId = requireSshSender(event);
    const parsed = parseRequest(KubeAccessRequestSchema, request);
    return sessions.access(ownerId, parsed.viewId, parsed.namespace);
  });
  handle(IPC_CHANNELS.kubeDiagnose, (event, request) => {
    const ownerId = requireSshSender(event);
    const parsed = parseRequest(KubeDiagnoseRequestSchema, request);
    return sessions.diagnose(ownerId, parsed.viewId, parsed.ref, parsed.event);
  });
  // The address comes from the vault entry only; the renderer names the app or image, never the host.
  handle(IPC_CHANNELS.kubeOpenLink, async (event, request) => {
    const ownerId = requireSshSender(event);
    const parsed = parseRequest(KubeOpenLinkRequestSchema, request);
    const { href, base } = sessions.linkTarget(ownerId, parsed.viewId, parsed.link);
    // Checked again right before the browser opens: https only, on the host of the vault address.
    const safe = openableHref(href, base);
    if (!safe) throw new AppError('kubernetes.linkRefused');
    await shell.openExternal(safe);
  });
  handle(IPC_CHANNELS.kubeArgoApp, (event, request) => {
    const ownerId = requireSshSender(event);
    const parsed = parseRequest(KubeArgoRequestSchema, request);
    return sessions.argoApp(ownerId, parsed.viewId, parsed.app);
  });
  // Reads the contexts of a kubeconfig on an SSH host; the config text itself never leaves the main process.
  handle(IPC_CHANNELS.kubeProbe, async (event, request): Promise<KubeProbeResult> => {
    requireSshSender(event);
    const connection = getConnection(parseRequest(KubeProbeRequestSchema, request).connectionId);
    if (connection?.protocol !== 'ssh') throw new AppError('kubernetes.sshConnectionRequired');
    if (connection.disabled) throw new AppError('kubernetes.disabled');
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
