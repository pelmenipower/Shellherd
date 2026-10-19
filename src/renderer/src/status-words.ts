import type { SshStatus } from '../../shared/ssh';

export type StatusForm = 'short' | 'long';

const SHORT: Record<SshStatus, string> = { connecting: 'Verbindet …', connected: 'Verbunden', closed: 'Getrennt', error: 'Fehler' };
const LONG: Record<SshStatus, string> = { connecting: 'Verbindet …', connected: 'Verbunden', closed: 'Verbindung getrennt', error: 'Verbindung fehlgeschlagen' };

/** German status word for tabs, live regions and panels; `name` only changes the long 'connecting' form. */
export function statusWord(status: SshStatus, form: StatusForm, options?: { name?: string; protocol?: 'RDP' | 'SFTP' }): string {
  const word = form === 'long' && status === 'connecting' && options?.name ? `Verbinde mit ${options.name} …`
    : (form === 'short' ? SHORT : LONG)[status];
  return options?.protocol ? `${options.protocol}: ${word}` : word;
}
