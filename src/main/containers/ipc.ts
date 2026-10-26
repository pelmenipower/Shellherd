import { ipcMain } from 'electron';
import { AppError } from '../../shared/errors';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { SshConnectionNode } from '../../shared/vault/types';
import { effectiveTimeouts } from '../../shared/vault/timeouts';
import { vaultSessionManager } from '../vault/ipc';
import type { AuthPrompts } from '../ssh/auth-prompts';
import type { KnownHosts } from '../ssh/known-hosts';
import { openJump } from '../ssh/jump';
import { requireSshSender } from '../ssh/ipc';
import { findConnection } from '../ssh/session';
import { parseRequest } from '../ssh/validation';
import { ContainerDiscovery } from './discovery';
import { openRemoteHost, runLocal } from './runner';
import type { RemoteHost, VerifyHost } from './runner';
import { SudoRejections } from './sudo-rejections';
import { ActionRequestSchema, InspectRequestSchema, InventoryActionRequestSchema, InventoryRequestSchema, ListRequestSchema } from './validation';

/** Opens an SSH host for container and cluster work, through its jump host when it has one; closing it closes the hop too. */
export async function openRemoteWithJump(connection: SshConnectionNode, knownHosts: KnownHosts, prompts: AuthPrompts): Promise<RemoteHost> {
  const verify: VerifyHost = (h, p, k, a) => knownHosts.verify(h, p, k, a);
  const timeouts = (c: SshConnectionNode) => effectiveTimeouts(vaultSessionManager.getSnapshot().vault.settings, c);
  const jump = await openJump(connection, {
    getConnection: id => findConnection(vaultSessionManager.getSnapshot().vault.nodes, id),
    openRemote: j => openRemoteHost(j, verify, undefined, timeouts(j), { ask: prompts.ask }),
  });
  let host: RemoteHost;
  try {
    host = await openRemoteHost(connection, verify, undefined, timeouts(connection), { ask: prompts.ask, sock: jump?.sock });
  } catch (error) {
    jump?.close();
    throw error;
  }
  if (!jump) return host;
  return {
    get closed() { return host.closed; },
    close: () => { host.close(); jump.close(); },
    run: (command, timeoutMs, sudo, outputLimit) => host.run(command, timeoutMs, sudo, outputLimit),
    forward: (h, p) => host.forward(h, p),
  };
}

export function registerContainerIpcHandlers(knownHosts: KnownHosts, prompts: AuthPrompts, sudoRejections = new SudoRejections()): ContainerDiscovery {
  const discovery = new ContainerDiscovery({
    sudoRejections,
    getConnection: id => {
      const connection = findConnection(vaultSessionManager.getSnapshot().vault.nodes, id);
      if (!connection) throw new AppError('containers.connectionNotFound');
      return connection;
    },
    openRemote: connection => openRemoteWithJump(connection, knownHosts, prompts),
    runLocal: (file, args, timeoutMs) => runLocal(file, args, timeoutMs),
  });
  ipcMain.handle(IPC_CHANNELS.containersList, (event, request: unknown) => {
    requireSshSender(event);
    return discovery.list(parseRequest(ListRequestSchema, request).hostId);
  });
  ipcMain.handle(IPC_CHANNELS.containersAction, (event, request: unknown) => {
    requireSshSender(event);
    const inventory = InventoryActionRequestSchema.safeParse(request);
    if (inventory.success) return discovery.inventoryAction(inventory.data.hostId, inventory.data.target, inventory.data.action);
    const parsed = parseRequest(ActionRequestSchema, request);
    return discovery.action(parsed.hostId, parsed.target, parsed.action);
  });
  ipcMain.handle(IPC_CHANNELS.containersInventory, (event, request: unknown) => {
    requireSshSender(event);
    const parsed = parseRequest(InventoryRequestSchema, request);
    return discovery.inventory(parsed.hostId, parsed.runtime);
  });
  ipcMain.handle(IPC_CHANNELS.containersInspect, (event, request: unknown) => {
    requireSshSender(event);
    const parsed = parseRequest(InspectRequestSchema, request);
    return discovery.inspect(parsed.hostId, parsed.ref);
  });
  return discovery;
}
