import type { ConnectionNode, ConnectionProtocol } from '../../shared/vault/types';
import { isRemoteConnection } from '../../shared/vault/connections';
import { aiCliLabel } from '../../shared/ai-cli';
import { t } from './i18n';

const LABEL_KEYS = {
  ssh: 'vault:protocols.ssh.label',
  sftp: 'vault:protocols.sftp.label',
  rdp: 'vault:protocols.rdp.label',
  powershell: 'vault:protocols.powershell.label',
  cmd: 'vault:protocols.cmd.label',
  bash: 'vault:protocols.bash.label',
  zsh: 'vault:protocols.zsh.label',
  fish: 'vault:protocols.fish.label',

  aicli: 'vault:protocols.aicli.label',
  kubernetes: 'vault:protocols.kubernetes.label',
  ftp: 'vault:protocols.ftp.label',
} as const satisfies Record<ConnectionProtocol | 'ftp', string>;

const SHORT_KEYS = {
  ssh: 'vault:protocols.ssh.short',
  sftp: 'vault:protocols.sftp.short',
  rdp: 'vault:protocols.rdp.short',
  powershell: 'vault:protocols.powershell.short',
  cmd: 'vault:protocols.cmd.short',
  bash: 'vault:protocols.bash.short',
  zsh: 'vault:protocols.zsh.short',
  fish: 'vault:protocols.fish.short',

  aicli: 'vault:protocols.aicli.short',
  kubernetes: 'vault:protocols.kubernetes.short',
} as const satisfies Record<ConnectionProtocol, string>;

/** Full protocol name for menus and titles. */
export function protocolLabel(protocol: ConnectionProtocol | 'ftp'): string {
  return t(LABEL_KEYS[protocol]);
}

/** Short protocol name for tabs and lists. */
export function protocolShort(protocol: ConnectionProtocol): string {
  return t(SHORT_KEYS[protocol]);
}

/** Display address without secrets, e.g. `user@host:22` or `Lokal · PowerShell`. */
export function connectionAddress(node: ConnectionNode): string {
  if (node.protocol === 'aicli') return t('vault:address.local', { name: aiCliLabel(node) ?? t('vault:address.customCommand') });
  if (node.protocol === 'kubernetes') return t('vault:address.cluster', { count: node.accessHosts.length });
  if (!isRemoteConnection(node)) return t('vault:address.local', { name: protocolShort(node.protocol) });
  return `${node.username ? `${node.username}@` : ''}${node.host}:${node.port}`;
}
