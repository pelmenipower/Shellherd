import type { ConnectionIconName } from './appearance';
import type { ConnectionNode, ConnectionProtocol, RemoteConnectionNode, Vault, VaultNode } from './types';

/** Protocol data only; display texts live in the `vault` catalog (see `connection-labels.ts`). */
export interface ProtocolInfo {
  defaultPort?: number;
  defaultIcon: ConnectionIconName;
}

export const PROTOCOLS: Record<ConnectionProtocol, ProtocolInfo> = {
  ssh: { defaultPort: 22, defaultIcon: 'terminal' },
  sftp: { defaultPort: 22, defaultIcon: 'files' },
  rdp: { defaultPort: 3389, defaultIcon: 'desktop' },
  powershell: { defaultIcon: 'terminal' },
  cmd: { defaultIcon: 'terminal' },
  aicli: { defaultIcon: 'terminal' },
  kubernetes: { defaultIcon: 'network' },
};

/** Order of the "new connection" menus; planned kinds are shown but disabled. */
export const NEW_CONNECTION_KINDS: { protocol: ConnectionProtocol | 'ftp'; planned?: boolean }[] = [
  { protocol: 'ssh' },
  { protocol: 'rdp' },
  { protocol: 'powershell' },
  { protocol: 'cmd' },
  { protocol: 'aicli' },
  { protocol: 'sftp' },
  { protocol: 'kubernetes' },
  { protocol: 'ftp', planned: true },
];

/** Copy for windows that only display connections: SSH credentials and RDP passwords removed. */
export function redactSecrets(nodes: VaultNode[]): VaultNode[] {
  return nodes.map((node): VaultNode => {
    if (node.type === 'folder') return { ...node, children: redactSecrets(node.children) };
    if (node.protocol === 'ssh' || node.protocol === 'sftp') return { ...node, authentication: { method: 'agent' } };
    if (node.protocol === 'rdp') { const { password: _password, ...rest } = node; return rest; }
    return node;
  });
}

/** Copy without secrets for the locked renderer: SSH/SFTP auth → agent, RDP password and AI settings removed. */
export function redactVault(vault: Vault): Vault {
  const { ai: _ai, ...rest } = vault;
  return { ...rest, nodes: redactSecrets(vault.nodes) };
}

/** Connections of a folder tree that may be opened, plus how many were skipped as disabled. */
export function connectionsIn(nodes: VaultNode[]): { connections: ConnectionNode[]; disabled: number } {
  const all = (items: VaultNode[]): ConnectionNode[] => items.flatMap(node => node.type === 'folder' ? all(node.children) : [node]);
  const found = all(nodes);
  const connections = found.filter(node => !node.disabled);
  return { connections, disabled: found.length - connections.length };
}

export function isRemoteConnection(node: ConnectionNode): node is RemoteConnectionNode {
  return node.protocol === 'ssh' || node.protocol === 'sftp' || node.protocol === 'rdp';
}
