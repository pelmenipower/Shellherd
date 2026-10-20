import { useCallback, useReducer, useRef } from 'react';
import { itemKey, toTarget } from '../../../shared/containers';
import type { ContainerAction, DiscoveredItem } from '../../../shared/containers';
import { containerTreeReducer } from '../container-tree';
import { errorText } from '../error-text';
import { t } from '../i18n';

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
      if (isLatest()) dispatch({ type: 'failed', hostId, message: errorText(error, t('containers:loadFailed')) });
    }
  }, []);
  /** Reloads the host afterwards; on failure the item keeps showing the message through the reload. */
  const act = useCallback(async (hostId: string, item: DiscoveredItem, action: ContainerAction) => {
    const key = itemKey(item);
    dispatch({ type: 'busy', hostId, key, busy: true });
    try {
      await window.desktopApi.containersAction({ hostId, target: toTarget(item), action });
      dispatch({ type: 'busy', hostId, key, busy: false });
    } catch (error) {
      dispatch({ type: 'busy', hostId, key, busy: false });
      dispatch({ type: 'notice', hostId, key, message: errorText(error, t('containers:actionFailed')) });
    }
    await load(hostId);
  }, [load]);
  return { state, load, act };
}
