import { useCallback, useReducer, useRef } from 'react';
import { itemKey, toTarget } from '../../../shared/containers';
import type { ContainerAction, DiscoveredItem } from '../../../shared/containers';
import { containerTreeReducer, ipcMessage } from '../container-tree';

export function useContainerDiscovery() {
  const [state, dispatch] = useReducer(containerTreeReducer, {});
  /** Latest request number per host; an answer for an older request is dropped. */
  const requests = useRef<Record<string, number>>({});
  const load = useCallback(async (hostId: string) => {
    const request = (requests.current[hostId] ?? 0) + 1;
    requests.current[hostId] = request;
    const isLatest = () => requests.current[hostId] === request;
    dispatch({ type: 'loading', hostId });
    try {
      const result = await window.desktopApi.containersList({ hostId });
      if (isLatest()) dispatch({ type: 'loaded', hostId, result });
    } catch (error) {
      if (isLatest()) dispatch({ type: 'failed', hostId, message: ipcMessage(error, 'Die Container konnten nicht geladen werden.') });
    }
  }, []);
  /** Reloads the host after success; on failure the list stays and the item shows the message. */
  const act = useCallback(async (hostId: string, item: DiscoveredItem, action: ContainerAction) => {
    const key = itemKey(item);
    dispatch({ type: 'busy', hostId, key, busy: true });
    try {
      await window.desktopApi.containersAction({ hostId, target: toTarget(item), action });
    } catch (error) {
      dispatch({ type: 'busy', hostId, key, busy: false });
      dispatch({ type: 'notice', hostId, key, message: ipcMessage(error, 'Die Aktion ist fehlgeschlagen.') });
      return;
    }
    dispatch({ type: 'busy', hostId, key, busy: false });
    await load(hostId);
  }, [load]);
  return { state, load, act };
}
