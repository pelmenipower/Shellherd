import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { codedFrom } from '../../../shared/errors';
import type { KubeDenied } from '../../../shared/kube-access';
import { queryKey } from '../../../shared/kubernetes';
import type { KubeActionRequest, KubeDetail, KubeDetailMode, KubeForwardStatus, KubeForwardTarget, KubeLogsStartRequest, KubeRef, KubeViewSnapshot } from '../../../shared/kubernetes';
import { t } from '../i18n';
import { initialKubeView, kubeViewReducer, type KubeViewAction, type KubeViewState } from '../kube-view';

/**
 * Owns one kube view on the main side: opens it for the cluster, forwards its events into the
 * reducer and sends the subscription whenever the query changes. Closes the view on unmount.
 */
export function useClusterSession(clusterId: string, initial?: KubeViewSnapshot, defaultNamespace?: string | null) {
  const [state, dispatch] = useReducer(kubeViewReducer, undefined, (): KubeViewState => {
    const fresh = initialKubeView(defaultNamespace ?? null);
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
      dispatch({ type: 'event', event: { type: 'status', viewId: id, status }, at: Date.now() });
      if (overview) dispatch({ type: 'event', event: { type: 'overview', viewId: id, ...overview }, at: Date.now() });
      setViewId(id);
    }).catch(caught => {
      if (cancelled) return;
      dispatch({ type: 'event', event: { type: 'status', viewId: '', status: failedStatus(caught, clusterId) }, at: Date.now() });
    });
    return () => {
      cancelled = true;
      setViewId(null);
      // Main stops the forwards of a closed view without an event; the bar must not keep showing them.
      dispatch({ type: 'event', event: { type: 'forwards', viewId: '', forwards: [] } });
      if (opened) void window.desktopApi.kubeClose({ viewId: opened }).catch(() => {});
    };
  }, [clusterId, generation]);

  // Events of this view only; registered before the subscription so no rows are missed.
  useEffect(() => {
    if (!viewId) return;
    return window.desktopApi.onKubeEvent(event => {
      // Log batches go straight to WorkloadLogs; the reducer would only return the same state.
      if (event.viewId === viewId && event.type !== 'logs') dispatch({ type: 'event', event, at: Date.now() });
    });
  }, [viewId]);

  const queryId = queryKey(state.query);
  useEffect(() => {
    if (!viewId) return;
    window.desktopApi.kubeSubscribe({ viewId, query: queryRef.current }).catch(caught => {
      dispatch({ type: 'event', event: { type: 'status', viewId, status: failedStatus(caught, clusterId) }, at: Date.now() });
    });
    // queryId stands for queryRef.current: it changes exactly when the query does.
  }, [viewId, queryId, clusterId]);

  const retry = useCallback(() => setGeneration(value => value + 1), []);

  const detail = useCallback((ref: KubeRef, mode: KubeDetailMode): Promise<KubeDetail> => {
    const id = viewIdRef.current;
    if (!id) return Promise.reject(new Error(t('kubernetes:viewNotOpen')));
    return window.desktopApi.kubeDetail({ viewId: id, ref, mode });
  }, []);

  const action = useCallback((request: Omit<KubeActionRequest, 'viewId'>): Promise<void> => {
    const id = viewIdRef.current;
    if (!id) return Promise.reject(new Error(t('kubernetes:viewNotOpen')));
    return window.desktopApi.kubeAction({ ...request, viewId: id });
  }, []);

  const startForward = useCallback((target: KubeForwardTarget, localPort: number): Promise<KubeForwardStatus> => {
    const id = viewIdRef.current;
    if (!id) return Promise.reject(new Error(t('kubernetes:viewNotOpen')));
    return window.desktopApi.kubeForwardStart({ viewId: id, target, localPort });
  }, []);

  const stopForward = useCallback((forwardId: string): Promise<void> => {
    const id = viewIdRef.current;
    if (!id) return Promise.resolve();
    return window.desktopApi.kubeForwardStop({ viewId: id, forwardId });
  }, []);

  const startLogs = useCallback((request: Omit<KubeLogsStartRequest, 'viewId'>): Promise<void> => {
    const id = viewIdRef.current;
    if (!id) return Promise.reject(new Error(t('kubernetes:viewNotOpen')));
    return window.desktopApi.kubeLogsStart({ ...request, viewId: id });
  }, []);

  const stopLogs = useCallback((logsId: string): Promise<void> => {
    const id = viewIdRef.current;
    if (!id) return Promise.resolve();
    return window.desktopApi.kubeLogsStop({ viewId: id, id: logsId });
  }, []);

  const [access] = useState(() => accessRequests(
    (viewId, namespace) => window.desktopApi.kubeAccess({ viewId, namespace }),
    (namespace, denied) => dispatch({ type: 'access', namespace, entry: { at: Date.now(), denied } }),
  ));
  // A connection that drops makes its pending answers stale; the next ready state asks again.
  const statusState = state.status?.state;
  useEffect(() => { if (statusState !== 'ready') access.reset(); }, [statusState, access]);
  const ensureAccess = useCallback((namespace: string): void => {
    const id = viewIdRef.current;
    if (id) access.ensure(id, namespace);
  }, [access]);

  return { state, dispatch: dispatch as (action: KubeViewAction) => void, viewId, retry, detail, action, startForward, stopForward, startLogs, stopLogs, ensureAccess };
}

export interface AccessRequests {
  /** Asks once per namespace while no answer is pending; a failed request counts as unknown (nothing greyed out). */
  ensure(viewId: string, namespace: string): void;
  /** Connection lost: answers still on their way are dropped when they arrive. */
  reset(): void;
}

/** Pending requests per namespace, with a generation that reset() ends. */
export function accessRequests(
  ask: (viewId: string, namespace: string) => Promise<KubeDenied[] | null>,
  answer: (namespace: string, denied: KubeDenied[] | null) => void,
): AccessRequests {
  let generation = 0;
  const pending = new Set<string>();
  return {
    ensure(viewId, namespace) {
      if (pending.has(namespace)) return;
      const asked = generation;
      pending.add(namespace);
      void ask(viewId, namespace).catch(() => null).then(denied => {
        if (asked !== generation) return;
        pending.delete(namespace);
        answer(namespace, denied);
      });
    },
    reset() {
      generation++;
      pending.clear();
    },
  };
}

/** A status for failures that happen before or outside the main side's own status events. */
function failedStatus(caught: unknown, clusterId: string) {
  return { state: 'error' as const, name: clusterId, production: false, readOnly: false, error: codedFrom(caught, 'kubernetes.viewOpenFailed'), metrics: false };
}
