import type { ConnectionIconName } from './appearance';
import type { ConnectionNode, ConnectionProtocol, RemoteConnectionNode } from './types';

export interface ProtocolInfo {
  label: string;
  /** Short label for tabs and lists. */
  short: string;
  defaultPort?: number;
  defaultIcon: ConnectionIconName;
}

export const PROTOCOLS: Record<ConnectionProtocol, ProtocolInfo> = {
  ssh: { label: 'SSH', short: 'SSH', defaultPort: 22, defaultIcon: 'terminal' },
  rdp: { label: 'Remotedesktop (RDP)', short: 'RDP', defaultPort: 3389, defaultIcon: 'desktop' },
  powershell: { label: 'PowerShell (lokal)', short: 'PowerShell', defaultIcon: 'terminal' },
  cmd: { label: 'Eingabeaufforderung CMD (lokal)', short: 'CMD', defaultIcon: 'terminal' },
};

/** Order of the "new connection" menus; planned kinds are shown but disabled. */
export const NEW_CONNECTION_KINDS: { protocol: ConnectionProtocol | 'sftp' | 'ftp'; label: string; planned?: boolean }[] = [
  { protocol: 'ssh', label: PROTOCOLS.ssh.label },
  { protocol: 'rdp', label: PROTOCOLS.rdp.label },
  { protocol: 'powershell', label: PROTOCOLS.powershell.label },
  { protocol: 'cmd', label: PROTOCOLS.cmd.label },
  { protocol: 'sftp', label: 'SFTP', planned: true },
  { protocol: 'ftp', label: 'FTP', planned: true },
];

export function isRemoteConnection(node: ConnectionNode): node is RemoteConnectionNode {
  return node.protocol === 'ssh' || node.protocol === 'rdp';
}

/** Display address without secrets, e.g. `user@host:22` or `Lokal · PowerShell`. */
export function connectionAddress(node: ConnectionNode): string {
  if (!isRemoteConnection(node)) return `Lokal · ${PROTOCOLS[node.protocol].short}`;
  return `${node.username ? `${node.username}@` : ''}${node.host}:${node.port}`;
}
