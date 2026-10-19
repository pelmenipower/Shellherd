import { useEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import './busy-button.css';

export const DONE_MS = 1200;

export interface BusyButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  busy: boolean;
  idleLabel: string;
  /** Default: idleLabel (label stays, the dot pulses). */
  busyLabel?: string;
  /** Default: 'Gespeichert'. */
  doneLabel?: string;
  /** Raise after each success; every change shows doneLabel for DONE_MS. 0/undefined = never. */
  doneKey?: number;
}

type Face = 'idle' | 'busy' | 'done';

export function BusyButton({ busy, idleLabel, busyLabel, doneLabel = 'Gespeichert', doneKey, className, disabled, ...rest }: BusyButtonProps) {
  const [done, setDone] = useState(false);
  const lastKey = useRef(doneKey);
  const changed = useRef(false);
  useEffect(() => {
    if (doneKey === lastKey.current) return;
    lastKey.current = doneKey;
    if (!doneKey) return;
    setDone(true);
    const timer = setTimeout(() => setDone(false), DONE_MS);
    return () => clearTimeout(timer);
  }, [doneKey]);
  const face: Face = busy ? 'busy' : done ? 'done' : 'idle';
  const labels: Record<Face, string> = { idle: idleLabel, busy: busyLabel ?? idleLabel, done: doneLabel };
  // Only a state change fades in; the first render must not animate (a dialog opens with its buttons).
  const previous = useRef(face);
  if (previous.current !== face) { previous.current = face; changed.current = true; }
  return (
    <button {...rest} className={className ? `${className} busy-button` : 'busy-button'} disabled={disabled || busy} aria-busy={busy || undefined}>
      {(['idle', 'busy', 'done'] as const).map(state => (
        <span key={state} className="busy-sizer" aria-hidden="true"><span className="busy-dot" />{labels[state]}</span>
      ))}
      <span key={face} className={`busy-face${changed.current ? ' is-fresh' : ''}`}>
        {face !== 'idle' && <span className={`busy-dot${face === 'busy' ? ' is-busy' : ''}`} aria-hidden="true" />}
        {labels[face]}
      </span>
    </button>
  );
}
