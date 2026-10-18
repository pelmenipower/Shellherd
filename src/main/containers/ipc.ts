import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc';
import { vaultSessionManager } from '../vault/ipc';
import type { KnownHosts } from '../ssh/known-hosts';
import { requireSshSender } from '../ssh/ipc';
import { findConnection } from '../ssh/session';
import { parseRequest } from '../ssh/validation';
import { ContainerDiscovery } from './discovery';
import { openRemoteHost, runLocal } from './runner';
import { SudoRejections } from './sudo-rejections';
import { ActionRequestSchema, InspectRequestSchema, InventoryActionRequestSchema, InventoryRequestSchema, ListRequestSchema } from './validation';

export function registerContainerIpcHandlers(knownHosts: KnownHosts, sudoRejections = new SudoRejections()): ContainerDiscovery {
  const discovery = new ContainerDiscovery({
    sudoRejections,
    getConnection: id => {
      const connection = findConnection(vaultSessionManager.getSnapshot().vault.nodes, id);
      if (!connection) throw new Error('Die Verbindung wurde nicht gefunden.');
      return connection;
    },
    openRemote: connection => openRemoteHost(connection, (host, port, key, isActive) => knownHosts.verify(host, port, key, isActive)),
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
