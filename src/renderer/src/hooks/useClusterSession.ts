import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { queryKey } from '../../../shared/kubernetes';
import type { KubeActionRequest, KubeDetail, KubeDetailMode, KubeRef, KubeViewSnapshot } from '../../../shared/kubernetes';
import { initialKubeView, kubeViewReducer, type KubeViewAction, type KubeViewState } from '../kube-view';

/**
 * Owns one kube view on the main side: opens it for the cluster, forwards its events into the
 * reducer and sends the subscription whenever the query changes. Closes the view on unmount.
 */
export function useClusterSession(clusterId: string, initial?: KubeViewSnapshot, defaultNamespace?: string | null) {
  const [state, dispatch] = useReducer(kubeViewReducer, undefined, (): KubeViewState => {
    const fresh = initialKubeView(defaultNamespace ?? 'default');
    return initial ? kubeViewReducer(fresh, { type: 'restore', snapshot: initial }) : fresh;
  });
  const [viewId, setViewId] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const viewIdRef = useRef<string | null>(null);
  viewIdRef.current = viewId;
  const queryRef = useRef(state.query);
  queryRef.current = state.query;

  // Open on mount (a StrictMode probe closes the first view in the cleanup); `generation` reopens on retry.
  useEffect(() => {
    let cancelled = false;
    let opened: string | null = null;
    window.desktopApi.kubeOpen({ clusterId }).then(({ viewId: id, status, overview }) => {
      if (cancelled) { void window.desktopApi.kubeClose({ viewId: id }).catch(() => {}); return; }
      opened = id;
      // Events sent while `open` ran were lost; the reply carries the state they described.
      dispatch({ type: 'event', event: { type: 'status', viewId: id, status } });
      if (overview) dispatch({ type: 'event', event: { type: 'overview', viewId: id, ...overview } });
      setViewId(id);
    }).catch(caught => {
      if (cancelled) return;
      dispatch({ type: 'event', event: { type: 'status', viewId: '', status: failedStatus(caught, clusterId) } });
    });
    return () => {
      cancelled = true;
      setViewId(null);
      if (opened) void window.desktopApi.kubeClose({ viewId: opened }).catch(() => {});
    };
  }, [clusterId, generation]);

  // Events of this view only; registered before the subscription so no rows are missed.
  useEffect(() => {
    if (!viewId) return;
    return window.desktopApi.onKubeEvent(event => {
      if (event.viewId === viewId) dispatch({ type: 'event', event });
    });
  }, [viewId]);

  const queryId = queryKey(state.query);
  useEffect(() => {
    if (!viewId) return;
    window.desktopApi.kubeSubscribe({ viewId, query: queryRef.current }).catch(caught => {
      dispatch({ type: 'event', event: { type: 'status', viewId, status: failedStatus(caught, clusterId) } });
    });
    // queryId stands for queryRef.current: it changes exactly when the query does.
  }, [viewId, queryId, clusterId]);

  const retry = useCallback(() => setGeneration(value => value + 1), []);

  const detail = useCallback((ref: KubeRef, mode: KubeDetailMode): Promise<KubeDetail> => {
    const id = viewIdRef.current;
    if (!id) return Promise.reject(new Error('Die Ansicht ist nicht geöffnet.'));
    return window.desktopApi.kubeDetail({ viewId: id, ref, mode });
  }, []);

  const action = useCallback((request: Omit<KubeActionRequest, 'viewId'>): Promise<void> => {
    const id = viewIdRef.current;
    if (!id) return Promise.reject(new Error('Die Ansicht ist nicht geöffnet.'));
    return window.desktopApi.kubeAction({ ...request, viewId: id });
  }, []);

  return { state, dispatch: dispatch as (action: KubeViewAction) => void, viewId, retry, detail, action };
}

/** A status for failures that happen before or outside the main side's own status events. */
function failedStatus(caught: unknown, clusterId: string) {
  const message = caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Die Ansicht konnte nicht geöffnet werden.';
  return { state: 'error' as const, name: clusterId, production: false, readOnly: false, message, metrics: false };
}
