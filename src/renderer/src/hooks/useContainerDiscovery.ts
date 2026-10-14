import { useCallback, useReducer } from 'react';
import { itemKey, toTarget } from '../../../shared/containers';
import type { ContainerAction, DiscoveredItem } from '../../../shared/containers';
import { containerTreeReducer, ipcMessage } from '../container-tree';

export function useContainerDiscovery() {
  const [state, dispatch] = useReducer(containerTreeReducer, {});
  const load = useCallback(async (hostId: string) => {
    dispatch({ type: 'loading', hostId });
    try { dispatch({ type: 'loaded', hostId, result: await window.desktopApi.containersList({ hostId }) }); }
    catch (error) { dispatch({ type: 'failed', hostId, message: ipcMessage(error, 'Die Container konnten nicht geladen werden.') }); }
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
    await load(hostId);
  }, [load]);
  return { state, load, act };
}
