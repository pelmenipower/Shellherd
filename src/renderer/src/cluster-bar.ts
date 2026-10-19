/** Texts and tone of the cluster connection bar; see validation spec 3.6 (K23). Pure. */
import type { ClusterStatus } from '../../shared/kubernetes';

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
  if (ms < FRESH_MS) return 'gerade aktualisiert';
  const seconds = Math.floor(ms / 1000);
  return seconds < 60 ? `Stand vor ${seconds} s` : `Stand vor ${Math.floor(seconds / 60)} min`;
}

export function connbar(input: ConnbarInput): { tone: ConnbarTone; text: string; age: string } {
  const { status, now } = input;
  if (!status || status.state === 'connecting') {
    return { tone: 'off', text: status?.trying ? `Verbinde über ${status.trying} …` : 'Verbinde …', age: '' };
  }
  if (status.state === 'error') return { tone: 'off', text: 'Nicht verbunden', age: '' };
  const age = ageText(now, input.updatedAt);
  if (status.state === 'ready') {
    if (input.recoveredAt !== undefined && now - input.recoveredAt < RECOVERED_MS) return { tone: 'ok', text: `Wieder verbunden über ${status.host}`, age };
    return { tone: 'live', text: 'Live', age };
  }
  const way = status.trying ? `Verbinde über ${status.trying} …` : 'Verbinde neu …';
  if (status.host && input.reconnectingSince !== undefined && now - input.reconnectingSince < FIRST_NOTICE_MS) {
    const retry = status.trying && status.trying !== status.host ? way : 'Verbinde neu …';
    return { tone: 'warn', text: `${status.host} antwortet nicht. ${retry}`, age };
  }
  return { tone: 'warn', text: status.attempt === undefined ? way : `${way} (Versuch ${status.attempt})`, age };
}
