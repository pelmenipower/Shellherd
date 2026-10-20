import type { SshStatus } from '../../shared/ssh';
import { t } from './i18n';

export type StatusForm = 'short' | 'long';

const KEYS = {
  short: { connecting: 'terminal:statusWord.short.connecting', connected: 'terminal:statusWord.short.connected', closed: 'terminal:statusWord.short.closed', error: 'terminal:statusWord.short.error' },
  long: { connecting: 'terminal:statusWord.long.connecting', connected: 'terminal:statusWord.long.connected', closed: 'terminal:statusWord.long.closed', error: 'terminal:statusWord.long.error' },
} as const satisfies Record<StatusForm, Record<SshStatus, string>>;

/** Status word for tabs, live regions and panels; `name` only changes the long 'connecting' form. */
export function statusWord(status: SshStatus, form: StatusForm, options?: { name?: string; protocol?: 'RDP' | 'SFTP' }): string {
  const word = form === 'long' && status === 'connecting' && options?.name ? t('terminal:statusWord.connectingTo', { name: options.name })
    : t(KEYS[form][status]);
  return options?.protocol ? t('terminal:statusWord.withProtocol', { protocol: options.protocol, word }) : word;
}
