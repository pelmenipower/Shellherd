/** Texts and tone of the cluster connection bar; see validation spec 3.6 (K23). Pure. */
import type { ClusterStatus } from '../../shared/kubernetes';
import { t } from './i18n';

export type ConnbarTone = 'live' | 'warn' | 'ok' | 'off';
export interface ConnbarInput {
  status: ClusterStatus | null;
  now: number;
  /** 0 = unknown. */
  updatedAt: number;
  /** Date.now() when state became 'reconnecting'. */
  reconnectingSince?: number;
  /** Date.now() when state went from 'reconnecting' to 'ready'. */
  recoveredAt?: number;
}
/** How long the "reconnected" confirmation stays. */
export const RECOVERED_MS = 3000;
/** How long a reconnect shows the failed host before the attempt counter. */
export const FIRST_NOTICE_MS = 2000;
const FRESH_MS = 15_000;

function ageText(now: number, updatedAt: number): string {
  if (updatedAt <= 0) return '';
  const ms = now - updatedAt;
  if (ms < FRESH_MS) return t('kubernetes:connbar.ageFresh');
  const seconds = Math.floor(ms / 1000);
  return seconds < 60 ? t('kubernetes:connbar.ageSeconds', { count: seconds }) : t('kubernetes:connbar.ageMinutes', { count: Math.floor(seconds / 60) });
}

export function connbar(input: ConnbarInput): { tone: ConnbarTone; text: string; age: string } {
  const { status, now } = input;
  const connecting = (): string => t('kubernetes:connbar.connecting');
  const via = (host: string): string => t('kubernetes:connbar.connectingVia', { host });
  if (!status || status.state === 'connecting') {
    return { tone: 'off', text: status?.trying ? via(status.trying) : connecting(), age: '' };
  }
  if (status.state === 'error') return { tone: 'off', text: t('kubernetes:connbar.notConnected'), age: '' };
  const age = ageText(now, input.updatedAt);
  if (status.state === 'ready') {
    if (input.recoveredAt !== undefined && now - input.recoveredAt < RECOVERED_MS) return { tone: 'ok', text: t('kubernetes:connbar.recovered', { host: status.host }), age };
    return { tone: 'live', text: t('kubernetes:connbar.live'), age };
  }
  const again = t('kubernetes:connbar.reconnecting');
  const way = status.trying ? via(status.trying) : again;
  if (status.host && input.reconnectingSince !== undefined && now - input.reconnectingSince < FIRST_NOTICE_MS) {
    const retry = status.trying && status.trying !== status.host ? way : again;
    return { tone: 'warn', text: t('kubernetes:connbar.hostSilent', { host: status.host, retry }), age };
  }
  return { tone: 'warn', text: status.attempt === undefined ? way : t('kubernetes:connbar.attempt', { way, count: status.attempt }), age };
}
