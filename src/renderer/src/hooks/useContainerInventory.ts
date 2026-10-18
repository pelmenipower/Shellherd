import { useCallback, useEffect, useRef } from 'react';
import type { ContainerRuntime } from '../../../shared/containers';
import { ipcMessage } from '../container-tree';
import type { ContainerViewAction } from '../container-view';

/** Pause between the end of one request and the start of the next while the tab is visible. */
const POLL_MS = 10_000;

/**
 * Polls the inventory of one host: on mount, when the tab becomes visible, when the runtime changes and every 10 s
 * while visible. Never more than one request at a time; answers of an outdated request are dropped.
 */
export function useContainerInventory(hostId: string, runtime: ContainerRuntime | null, visible: boolean,
  dispatch: (action: ContainerViewAction) => void): { reload: () => void } {
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const inputRef = useRef({ hostId, runtime });
  inputRef.current = { hostId, runtime };
  const alive = useRef(false);
  const inFlight = useRef(false);
  /** One follow-up request is remembered while another one runs. */
  const again = useRef(false);
  const sequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const load = useRef<() => void>(() => {});

  load.current = () => {
    clearTimeout(timer.current);
    if (inFlight.current) { again.current = true; return; }
    inFlight.current = true;
    const id = ++sequence.current;
    const { hostId: host, runtime: wanted } = inputRef.current;
    dispatchRef.current({ type: 'loading' });
    window.desktopApi.containersInventory({ hostId: host, ...(wanted ? { runtime: wanted } : {}) }).then(
      inventory => { if (alive.current && id === sequence.current) dispatchRef.current({ type: 'setInventory', inventory }); },
      error => { if (alive.current && id === sequence.current) dispatchRef.current({ type: 'fail', message: ipcMessage(error, 'Die Container konnten nicht geladen werden.') }); },
    ).finally(() => {
      inFlight.current = false;
      if (!alive.current) return;
      // A request that was overtaken by a newer wish (runtime change) is repeated at once.
      const stale = id !== sequence.current;
      if ((again.current || stale) && visibleRef.current) { again.current = false; load.current(); return; }
      again.current = false;
      if (visibleRef.current) timer.current = setTimeout(() => load.current(), POLL_MS);
    });
  };

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; clearTimeout(timer.current); };
  }, []);

  // Host or runtime change: whatever is in flight is outdated.
  const key = `${hostId}|${runtime ?? ''}`;
  const keyRef = useRef<string | null>(null);
  useEffect(() => {
    if (keyRef.current !== null && keyRef.current !== key) sequence.current++;
    keyRef.current = key;
    if (!visible) { clearTimeout(timer.current); return; }
    // An in-flight request schedules the next one itself (or repeats, when it is outdated).
    if (!inFlight.current) load.current();
  }, [key, visible]);

  const reload = useCallback(() => load.current(), []);
  return { reload };
}
