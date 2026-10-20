import type { ConnectionNode } from '../../shared/vault/types';
import { MAX_SSH_SESSIONS } from '../../shared/ssh';
import { t } from './i18n';

export const disabledTitle = (): string => t('app:notices.disabledTitle');

export const disabledNotice = (node: ConnectionNode): string => t('app:notices.disabled', { name: node.name });

export const skippedNotice = (count: number): string => t('app:notices.skipped', { count });

/** Info toast for the session limit. */
export const sessionLimitNotice = (): { title: string; body: string } =>
  ({ title: t('app:notices.sessionLimitTitle', { max: MAX_SSH_SESSIONS }), body: t('app:notices.sessionLimitBody') });

/** One sentence for the picker; SFTP-like limits pass their own number. */
export const sessionLimitText = (limit: number = MAX_SSH_SESSIONS): string => t('app:notices.sessionLimitText', { max: limit });
