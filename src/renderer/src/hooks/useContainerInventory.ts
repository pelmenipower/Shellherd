import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContainerRuntime } from '../../../shared/containers';
import type { ContainerViewAction } from '../container-view';
import { InventoryScheduler } from '../inventory-scheduler';

/**
 * Polls the inventory of one host: on mount, when the tab becomes visible, when the runtime changes and every 10 s
 * while visible. Never more than one request at a time; answers of an outdated request are dropped.
 */
export function useContainerInventory(hostId: string, runtime: ContainerRuntime | null, visible: boolean,
  dispatch: (action: ContainerViewAction) => void): { reload: () => void } {
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const [scheduler] = useState(() => new InventoryScheduler({
    request: input => window.desktopApi.containersInventory({ hostId: input.hostId, ...(input.runtime ? { runtime: input.runtime } : {}) }),
    dispatch: action => dispatchRef.current(action),
  }));
  // Order matters: start before the first update, as alive was set before the key effect.
  useEffect(() => { scheduler.start(); return () => scheduler.stop(); }, [scheduler]);
  useEffect(() => { scheduler.update({ hostId, runtime }, visible); }, [scheduler, hostId, runtime, visible]);
  const reload = useCallback(() => scheduler.reload(), [scheduler]);
  return { reload };
}
