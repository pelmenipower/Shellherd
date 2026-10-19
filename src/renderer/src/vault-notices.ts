import type { ConnectionNode } from '../../shared/vault/types';
import { MAX_SSH_SESSIONS } from '../../shared/ssh';
import { t } from './i18n';

export const disabledNotice = (node: ConnectionNode): string => t('app:notices.disabled', { name: node.name });

export const skippedNotice = (count: number): string => t('app:notices.skipped', { count });

export const sessionLimitNotice = (): string => t('app:notices.sessionLimit', { max: MAX_SSH_SESSIONS });
