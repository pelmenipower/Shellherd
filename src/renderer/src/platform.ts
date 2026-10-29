import type { ConnectionProtocol } from '../../shared/vault/types';

export function protocolAvailable(protocol: ConnectionProtocol | 'ftp'): boolean {
  const caps = window.desktopApi?.capabilities;
  if (!caps) return true;
  if (protocol === 'rdp') return caps.rdp;
  if (['powershell', 'cmd', 'bash', 'zsh', 'fish'].includes(protocol)) return caps.localShells.some(shell => shell === protocol);
  return protocol !== 'ftp';
}
