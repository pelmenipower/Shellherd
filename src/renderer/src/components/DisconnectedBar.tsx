import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useT } from '../i18n';
import { formatAgo } from '../connect-timeline';
import { focusIfAllowed } from '../focus-guard';
import './connection-ui.css';

export type DisconnectReason = 'server' | 'idle' | 'session' | 'cancel';

export interface DisconnectedBarProps {
  /** 'server' and 'idle' animate in; 'session' (own exit) and 'cancel' (Abbrechen/Esc) appear at once. */
  reason: DisconnectReason;
  endedAt: number;
  /** Button takes focus, so Enter reconnects. */
  active: boolean;
  /** The tab is visible: the age tick runs only then. */
  ticking?: boolean;
  onReconnect: () => void;
}

const REASON_KEYS = {
  server: 'terminal:disconnected.reasons.server', idle: 'terminal:disconnected.reasons.idle', session: 'terminal:disconnected.reasons.session', cancel: 'terminal:disconnected.reasons.cancel',
} as const satisfies Record<DisconnectReason, string>;

/** Bar below the output of a finished session; it sits in the flow, so it covers nothing. */
export function DisconnectedBar({ reason, endedAt, active, ticking = true, onReconnect }: DisconnectedBarProps) {
  const { t } = useT();
  const [now, setNow] = useState(() => Date.now());
  const button = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  useEffect(() => { if (active) focusIfAllowed(root.current, button.current); }, [active]);
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' || event.key === 'Enter') event.stopPropagation();
  };
  return (
    <div ref={root} className="connect-closed" data-instant={reason === 'server' || reason === 'idle' ? undefined : ''} onKeyDown={onKeyDown}>
      <span className="connect-closed-dot" aria-hidden="true" />
      <span className="connect-closed-text">{t('terminal:disconnected.title')} <span className="connect-closed-age">{t('terminal:disconnected.detail', { age: formatAgo(now - endedAt), reason: t(REASON_KEYS[reason]) })}</span></span>
      <button ref={button} type="button" className="primary-button connect-reconnect" onClick={onReconnect}>{t('terminal:disconnected.reconnect')} <kbd>Enter</kbd></button>
    </div>
  );
}
