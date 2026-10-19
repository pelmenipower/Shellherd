import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { SshStep } from '../../../shared/ssh';
import { cardFooter, formatSeconds, stepViews } from '../connect-timeline';
import type { StepMark } from '../connect-timeline';
import { focusIfAllowed } from '../focus-guard';
import './connection-ui.css';

export interface ConnectingCardProps {
  name: string; address: string;
  /** ssh2 sessions: ['reach','hostkey','auth','shell']; otherwise ['shell']. */
  steps: readonly SshStep[];
  marks: readonly StepMark[];
  startedAt: number;
  /** Pane focused and visible and not embedded: the cancel button takes focus, Esc cancels. */
  active: boolean;
  /** The tab is visible: the elapsed-time tick runs only then. */
  ticking?: boolean;
  onCancel: () => void;
}

/** Step timeline shown while connecting; it appears without a transition because it often follows Enter. */
export function ConnectingCard({ name, address, steps, marks, startedAt, active, ticking = true, onCancel }: ConnectingCardProps) {
  const [now, setNow] = useState(() => Date.now());
  const cancel = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [ticking]);
  useEffect(() => { if (active) focusIfAllowed(root.current, cancel.current); }, [active]);
  const views = stepViews(steps, marks, startedAt, now);
  const footer = cardFooter(views, startedAt, now);
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
    else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); }
  };
  return (
    <div ref={root} className="connect-overlay" onKeyDown={onKeyDown}>
      <div className="connect-card">
        <div className="connect-head">
          <strong className="connect-title">Verbinde mit {name} …</strong>
          <span className="connect-address">{address}</span>
        </div>
        <ol className="connect-steps">
          {views.map(view => (
            <li key={view.step} className="connect-step" data-state={view.state}>
              <span className="connect-ring" aria-hidden="true" />
              <span>{view.label}</span>
              <span className="connect-time">{view.ms === undefined ? '' : formatSeconds(view.ms)}</span>
            </li>
          ))}
        </ol>
        <div className="connect-foot">
          <span className="connect-hint" data-slow={footer.slow}>{footer.text}</span>
          <button ref={cancel} type="button" className="connect-cancel" onClick={onCancel}>Abbrechen <kbd>Esc</kbd></button>
        </div>
      </div>
    </div>
  );
}
