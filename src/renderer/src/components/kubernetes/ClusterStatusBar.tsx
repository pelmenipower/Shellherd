import { useEffect, useRef, useState } from 'react';
import type { ClusterStatus } from '../../../../shared/kubernetes';
import { FIRST_NOTICE_MS, RECOVERED_MS, connbar } from '../../cluster-bar';
import '../../kubernetes-ui.css';

interface ClusterStatusBarProps {
  status: ClusterStatus | null;
  /** Date.now() of the last rows/overview event; 0 = unknown. */
  updatedAt: number;
}

/** Connection bar under the cluster header: host being tried, data age, recovery. Re-renders with the 10 s tick of ClusterView. */
export function ClusterStatusBar({ status, updatedAt }: ClusterStatusBarProps) {
  const state = status?.state;
  const previous = useRef<ClusterStatus['state'] | undefined>(undefined);
  const [reconnectingSince, setReconnectingSince] = useState<number | undefined>();
  const [recoveredAt, setRecoveredAt] = useState<number | undefined>();
  const [, setBeat] = useState(0);

  useEffect(() => {
    const was = previous.current;
    previous.current = state;
    if (state === 'reconnecting') {
      if (was !== 'reconnecting') { setReconnectingSince(Date.now()); setRecoveredAt(undefined); }
    } else if (state === 'ready' && was === 'reconnecting') {
      setReconnectingSince(undefined); setRecoveredAt(Date.now());
    } else if (state !== 'ready') {
      setReconnectingSince(undefined); setRecoveredAt(undefined);
    }
  }, [state]);

  // Re-render when the 2 s notice or the 3 s confirmation runs out.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (reconnectingSince !== undefined) timers.push(setTimeout(() => setBeat(beat => beat + 1), Math.max(0, reconnectingSince + FIRST_NOTICE_MS - Date.now()) + 20));
    if (recoveredAt !== undefined) timers.push(setTimeout(() => setBeat(beat => beat + 1), Math.max(0, recoveredAt + RECOVERED_MS - Date.now()) + 20));
    return () => timers.forEach(clearTimeout);
  }, [reconnectingSince, recoveredAt]);

  const { tone, text, age } = connbar({ status, now: Date.now(), updatedAt, reconnectingSince, recoveredAt });
  return (
    <div className={`kube-connbar kube-connbar-${tone}`} role="status">
      <span className="kube-connbar-dot kube-dot" aria-hidden="true" />
      <span className="kube-connbar-text">{text}</span>
      {age && <span className="kube-connbar-age">{age}</span>}
    </div>
  );
}
