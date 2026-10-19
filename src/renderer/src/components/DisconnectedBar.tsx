import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { formatAgo } from '../connect-timeline';
import './connection-ui.css';

export interface DisconnectedBarProps {
  /** 'server' animates in; 'session' (own exit) and 'cancel' (Abbrechen/Esc) appear at once. */
  reason: 'server' | 'session' | 'cancel';
  endedAt: number;
  /** Button takes focus, so Enter reconnects. */
  active: boolean;
  onReconnect: () => void;
}

const REASON_TEXT: Record<DisconnectedBarProps['reason'], string> = {
  server: 'der Server hat sie beendet', session: 'die Sitzung wurde beendet', cancel: 'abgebrochen',
};

/** Bar over the bottom of a finished session; the screen content stays readable above it. */
export function DisconnectedBar({ reason, endedAt, active, onReconnect }: DisconnectedBarProps) {
  const [now, setNow] = useState(() => Date.now());
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { if (active) button.current?.focus(); }, [active]);
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' || event.key === 'Enter') event.stopPropagation();
  };
  return (
    <div className="connect-closed" data-instant={reason === 'server' ? undefined : ''} onKeyDown={onKeyDown}>
      <span className="connect-closed-dot" aria-hidden="true" />
      <span className="connect-closed-text">Verbindung getrennt <span className="connect-closed-age">· {formatAgo(now - endedAt)} · {REASON_TEXT[reason]}</span></span>
      <button ref={button} type="button" className="primary-button connect-reconnect" onClick={onReconnect}>Neu verbinden <kbd>Enter</kbd></button>
    </div>
  );
}
