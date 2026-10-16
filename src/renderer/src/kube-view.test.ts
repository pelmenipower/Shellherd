import { describe, expect, it } from 'vitest';
import type { ClusterStatus, KubeEvent, KubeKind, KubeRow, NodeTile, UsageHistory } from '../../shared/kubernetes';
import { KIND_INFO, refKey } from '../../shared/kubernetes';
import { formatAge, formatUsage, initialKubeView, kubeViewReducer, matchesFilter, snapshotOf, sparkline, visibleRows } from './kube-view';
import type { KubeViewState } from './kube-view';

/** Namespaced kinds default to namespace 'shop'; cluster-scoped kinds get no namespace. */
function row(kind: KubeKind, name: string, extra: Partial<KubeRow> = {}, namespace: string | undefined = KIND_INFO[kind].namespaced ? 'shop' : undefined): KubeRow {
  return { uid: `${kind}-${name}`, ref: { kind, namespace, name }, cells: { name }, tone: 'ok', labels: {}, ...extra };
}

function rowsEvent(state: KubeViewState, upserts: KubeRow[], extra: { reset?: boolean; deletes?: string[]; query?: KubeViewState['query'] } = {}): KubeViewState {
  return kubeViewReducer(state, { type: 'event', event: { type: 'rows', viewId: 'v1', query: extra.query ?? state.query,
    reset: extra.reset ?? true, upserts, deletes: extra.deletes ?? [] } });
}

const status: ClusterStatus = { state: 'ready', name: 'prod', production: true, readOnly: true, metrics: true };
const nodeTile: NodeTile = { name: 'worker1', ready: true, roles: ['worker'], pressure: [], unschedulable: false, cpu: 0.4, memory: 0.6 };
const usage: UsageHistory = { 'pods//api-1': [{ cpuMilli: 250, memoryBytes: 1024 ** 3 }] };

describe('rows events', () => {
  it('replaces the rows on reset and clears loading', () => {
    let state = initialKubeView('shop');
    expect(state.loading).toBe(true);
    state = rowsEvent(state, [row('pods', 'api-1'), row('pods', 'api-2')]);
    expect(state.loading).toBe(false);
    expect(state.rows.map(r => r.ref.name)).toEqual(['api-1', 'api-2']);
    state = rowsEvent(state, [row('pods', 'db-1')]);
    expect(state.rows.map(r => r.ref.name)).toEqual(['db-1']);
  });

  it('merges upserts by uid and removes deletes without reset', () => {
    let state = rowsEvent(initialKubeView('shop'), [row('pods', 'api-1'), row('pods', 'api-2'), row('pods', 'api-3')]);
    const changed = { ...row('pods', 'api-2'), tone: 'warn' as const };
    state = rowsEvent(state, [changed, row('pods', 'api-4')], { reset: false, deletes: ['pods-api-1'] });
    expect(state.rows.map(r => r.ref.name)).toEqual(['api-2', 'api-3', 'api-4']);
    expect(state.rows[0].tone).toBe('warn');
  });

  it('ignores rows events for another query', () => {
    const state = rowsEvent(initialKubeView('shop'), [row('pods', 'api-1')]);
    const other = rowsEvent(state, [row('pods', 'x')], { query: { kind: 'pods', namespace: 'other' } });
    expect(other).toBe(state);
    const otherKind = rowsEvent(state, [row('pods', 'x')], { reset: false, query: { kind: 'services', namespace: 'shop' } });
    expect(otherKind).toBe(state);
  });
});

describe('selection after deletion', () => {
  it('moves the selection to the row at the same visible position', () => {
    let state = rowsEvent(initialKubeView('shop'), [row('pods', 'a'), row('pods', 'b'), row('pods', 'c')]);
    state = kubeViewReducer(state, { type: 'select', key: refKey(row('pods', 'b').ref) });
    state = rowsEvent(state, [row('pods', 'a'), row('pods', 'c')], { reset: false, deletes: ['pods-b'] });
    expect(state.selected).toBe(refKey(row('pods', 'c').ref));
  });

  it('falls back to the last row when the selected last row is deleted', () => {
    let state = rowsEvent(initialKubeView('shop'), [row('pods', 'a'), row('pods', 'b')]);
    state = kubeViewReducer(state, { type: 'select', key: refKey(row('pods', 'b').ref) });
    state = rowsEvent(state, [row('pods', 'a')], { reset: false, deletes: ['pods-b'] });
    expect(state.selected).toBe(refKey(row('pods', 'a').ref));
  });

  it('becomes null when no rows remain', () => {
    let state = rowsEvent(initialKubeView('shop'), [row('pods', 'a')]);
    state = kubeViewReducer(state, { type: 'select', key: refKey(row('pods', 'a').ref) });
    state = rowsEvent(state, [], { reset: false, deletes: ['pods-a'] });
    expect(state.selected).toBeNull();
  });

  it('keeps a selection that has not arrived yet', () => {
    const state = kubeViewReducer(initialKubeView('shop'), { type: 'select', key: refKey(row('pods', 'later').ref) });
    expect(rowsEvent(state, [row('pods', 'a')]).selected).toBe(refKey(row('pods', 'later').ref));
  });
});

describe('setKind and setNamespace', () => {
  it('setKind changes the kind and resets the table', () => {
    let state = rowsEvent(initialKubeView('shop'), [row('pods', 'a')]);
    state = kubeViewReducer(state, { type: 'filter', text: 'a' });
    state = kubeViewReducer(state, { type: 'select', key: refKey(row('pods', 'a').ref) });
    state = kubeViewReducer(state, { type: 'setKind', kind: 'deployments' });
    expect(state.query).toEqual({ kind: 'deployments', namespace: 'shop' });
    expect(state.rows).toEqual([]);
    expect(state.loading).toBe(true);
    expect(state.crumbs).toEqual([]);
    expect(state.selected).toBeNull();
    expect(state.filter).toBe('');
  });

  it('setNamespace(null) sets the query namespace to null', () => {
    let state = rowsEvent(initialKubeView('shop'), [row('pods', 'a')]);
    state = kubeViewReducer(state, { type: 'setNamespace', namespace: null });
    expect(state.query).toEqual({ kind: 'pods', namespace: null });
    expect(state.rows).toEqual([]);
    expect(state.loading).toBe(true);
  });
});

describe('drill and back', () => {
  const deployment = row('deployments', 'api', { selector: { app: 'api' } });

  it('drills from a deployment into its pods and back', () => {
    let state = rowsEvent(kubeViewReducer(initialKubeView('shop'), { type: 'setKind', kind: 'deployments' }), [deployment]);
    state = kubeViewReducer(state, { type: 'select', key: refKey(deployment.ref) });
    state = kubeViewReducer(state, { type: 'drill' });
    expect(state.query).toEqual({ kind: 'pods', namespace: 'shop', selector: { labels: { app: 'api' } } });
    expect(state.crumbs.map(c => c.label)).toEqual(['Deployment api']);
    expect(state.selected).toBeNull();
    state = kubeViewReducer(state, { type: 'back' });
    expect(state.query).toEqual({ kind: 'deployments', namespace: 'shop' });
    expect(state.crumbs).toEqual([]);
    expect(state.loading).toBe(true);
  });

  it('drills from a node into pods on that node without namespace', () => {
    let state = rowsEvent(kubeViewReducer(initialKubeView('shop'), { type: 'setKind', kind: 'nodes' }), [row('nodes', 'worker1', {}, undefined)]);
    state = kubeViewReducer(state, { type: 'select', key: refKey({ kind: 'nodes', name: 'worker1' }) });
    state = kubeViewReducer(state, { type: 'drill' });
    expect(state.query).toEqual({ kind: 'pods', namespace: null, selector: { node: 'worker1' } });
    expect(state.crumbs.map(c => c.label)).toEqual(['Node worker1']);
  });

  it('drills from a service with a selector into pods', () => {
    let state = rowsEvent(kubeViewReducer(initialKubeView('shop'), { type: 'setKind', kind: 'services' }),
      [row('services', 'api-svc', { selector: { app: 'api', tier: 'web' } })]);
    state = kubeViewReducer(state, { type: 'select', key: refKey({ kind: 'services', namespace: 'shop', name: 'api-svc' }) });
    state = kubeViewReducer(state, { type: 'drill' });
    expect(state.query).toEqual({ kind: 'pods', namespace: 'shop', selector: { labels: { app: 'api', tier: 'web' } } });
    expect(state.crumbs.map(c => c.label)).toEqual(['Service api-svc']);
  });

  it('drills from a pod into its containers, selecting the first one', () => {
    let state = rowsEvent(initialKubeView('shop'), [row('pods', 'api-1', { containers: ['app', 'sidecar'], node: 'worker1' })]);
    state = kubeViewReducer(state, { type: 'select', key: refKey(row('pods', 'api-1').ref) });
    state = kubeViewReducer(state, { type: 'drill' });
    expect(state.containersOf?.ref.name).toBe('api-1');
    expect(state.container).toBe('app');
    state = kubeViewReducer(state, { type: 'selectContainer', name: 'sidecar' });
    expect(state.container).toBe('sidecar');
    state = kubeViewReducer(state, { type: 'back' });
    expect(state.containersOf).toBeNull();
    expect(state.container).toBeNull();
    expect(state.query).toEqual({ kind: 'pods', namespace: 'shop' });
    expect(state.rows.map(r => r.ref.name)).toEqual(['api-1']);
  });

  it('back from a drilled workload restores the previous query', () => {
    let state = rowsEvent(kubeViewReducer(initialKubeView('shop'), { type: 'setKind', kind: 'deployments' }), [deployment]);
    state = kubeViewReducer(state, { type: 'select', key: refKey(deployment.ref) });
    state = kubeViewReducer(state, { type: 'drill' });
    state = rowsEvent(state, [row('pods', 'api-1', { containers: ['app'] })]);
    state = kubeViewReducer(state, { type: 'select', key: refKey(row('pods', 'api-1').ref) });
    state = kubeViewReducer(state, { type: 'drill' });
    state = kubeViewReducer(state, { type: 'back' });
    expect(state.containersOf).toBeNull();
    expect(state.query.kind).toBe('pods');
    state = kubeViewReducer(state, { type: 'back' });
    expect(state.query).toEqual({ kind: 'deployments', namespace: 'shop' });
    expect(state.crumbs).toEqual([]);
    expect(kubeViewReducer(state, { type: 'back' })).toBe(state);
  });

  it('does nothing on workloads without a selector or on events', () => {
    const job = row('jobs', 'backup');
    const event = row('events', 'ev-1');
    let state = rowsEvent(kubeViewReducer(initialKubeView('shop'), { type: 'setKind', kind: 'jobs' }), [job]);
    state = kubeViewReducer(state, { type: 'select', key: refKey(job.ref) });
    expect(kubeViewReducer(state, { type: 'drill' })).toBe(state);
    state = rowsEvent(kubeViewReducer(state, { type: 'setKind', kind: 'events' }), [event]);
    state = kubeViewReducer(state, { type: 'select', key: refKey(event.ref) });
    expect(kubeViewReducer(state, { type: 'drill' })).toBe(state);
  });
});

describe('filter and sort', () => {
  it('matches names and key=value labels case-insensitively; empty matches everything', () => {
    const pod = row('pods', 'api-1', { labels: { app: 'api', tier: 'Web' } });
    expect(matchesFilter(pod, 'api')).toBe(true);
    expect(matchesFilter(pod, 'API-1')).toBe(true);
    expect(matchesFilter(pod, 'db')).toBe(false);
    expect(matchesFilter(pod, 'app=api')).toBe(true);
    expect(matchesFilter(pod, 'App=API')).toBe(true);
    expect(matchesFilter(pod, 'app=db')).toBe(false);
    expect(matchesFilter(pod, 'tier=web')).toBe(true);
    expect(matchesFilter(pod, '')).toBe(true);
    expect(matchesFilter(pod, '   ')).toBe(true);
  });

  it('sorts a numeric column descending on the second click', () => {
    let state = rowsEvent(initialKubeView('shop'), [
      row('pods', 'a', { cells: { name: 'a', restarts: 2 } }),
      row('pods', 'b', { cells: { name: 'b', restarts: 10 } }),
      row('pods', 'c', { cells: { name: 'c', restarts: 9 } }),
    ]);
    state = kubeViewReducer(state, { type: 'sort', key: 'restarts' });
    expect(state.sort).toEqual({ key: 'restarts', descending: false });
    expect(visibleRows(state).map(r => r.ref.name)).toEqual(['a', 'c', 'b']);
    state = kubeViewReducer(state, { type: 'sort', key: 'restarts' });
    expect(state.sort).toEqual({ key: 'restarts', descending: true });
    expect(visibleRows(state).map(r => r.ref.name)).toEqual(['b', 'c', 'a']);
  });

  it('sorts age columns by timestamp', () => {
    let state = rowsEvent(initialKubeView('shop'), [
      row('pods', 'new', { cells: { name: 'new', age: '2026-10-16T10:00:00Z' } }),
      row('pods', 'old', { cells: { name: 'old', age: '2026-10-01T10:00:00Z' } }),
    ]);
    state = kubeViewReducer(state, { type: 'sort', key: 'age' });
    expect(visibleRows(state).map(r => r.ref.name)).toEqual(['old', 'new']);
  });

  it('sorts text columns and applies the filter before sorting', () => {
    let state = rowsEvent(initialKubeView('shop'), [
      row('pods', 'web-b', { cells: { name: 'web-b', status: 'Running' } }),
      row('pods', 'web-a', { cells: { name: 'web-a', status: 'Pending' } }),
      row('pods', 'db-1', { cells: { name: 'db-1', status: 'Failed' } }),
    ]);
    state = kubeViewReducer(state, { type: 'sort', key: 'name' });
    state = kubeViewReducer(state, { type: 'filter', text: 'web' });
    expect(visibleRows(state).map(r => r.ref.name)).toEqual(['web-a', 'web-b']);
  });
});

describe('move', () => {
  const rows = [row('pods', 'a'), row('pods', 'b'), row('pods', 'c')];
  const keyOf = (name: string) => refKey(row('pods', name).ref);

  it('clamps at both ends', () => {
    let state = rowsEvent(initialKubeView('shop'), rows);
    state = kubeViewReducer(state, { type: 'select', key: keyOf('a') });
    state = kubeViewReducer(state, { type: 'move', delta: -1 });
    expect(state.selected).toBe(keyOf('a'));
    state = kubeViewReducer(state, { type: 'move', delta: 10 });
    expect(state.selected).toBe(keyOf('c'));
    state = kubeViewReducer(state, { type: 'move', delta: 1 });
    expect(state.selected).toBe(keyOf('c'));
  });

  it('selects the first row with +1 when nothing is selected', () => {
    const state = rowsEvent(initialKubeView('shop'), rows);
    expect(kubeViewReducer(state, { type: 'move', delta: 1 }).selected).toBe(keyOf('a'));
  });

  it('leaves the state alone when there are no visible rows', () => {
    const state = initialKubeView('shop');
    expect(kubeViewReducer(state, { type: 'move', delta: 1 })).toBe(state);
  });
});

describe('jump', () => {
  it('opens the pod table in the ref namespace and selects the ref', () => {
    let state = rowsEvent(kubeViewReducer(initialKubeView('shop'), { type: 'setKind', kind: 'nodes' }), [row('nodes', 'worker1', {}, undefined)]);
    state = kubeViewReducer(state, { type: 'jump', ref: { kind: 'pods', namespace: 'billing', name: 'worker-9' } });
    expect(state.query).toEqual({ kind: 'pods', namespace: 'billing' });
    expect(state.selected).toBe(refKey({ kind: 'pods', namespace: 'billing', name: 'worker-9' }));
    expect(state.loading).toBe(true);
    expect(state.crumbs).toEqual([]);
    // The row arrives later and keeps the selection.
    state = rowsEvent(state, [row('pods', 'worker-9', {}, 'billing')]);
    expect(state.selected).toBe(refKey({ kind: 'pods', namespace: 'billing', name: 'worker-9' }));
  });
});

describe('dock and restore', () => {
  it('dock opens the panel with the chosen mode; toggleDock flips it', () => {
    let state = kubeViewReducer(initialKubeView('shop'), { type: 'dock', mode: 'yaml' });
    expect(state).toMatchObject({ dock: 'yaml', dockOpen: true });
    state = kubeViewReducer(state, { type: 'toggleDock' });
    expect(state.dockOpen).toBe(false);
    expect(kubeViewReducer(state, { type: 'toggleDock' }).dockOpen).toBe(true);
  });

  it('restore takes over query and dock, and snapshotOf returns crumb labels', () => {
    let state = rowsEvent(kubeViewReducer(initialKubeView('shop'), { type: 'setKind', kind: 'deployments' }), [row('deployments', 'api', { selector: { app: 'api' } })]);
    state = kubeViewReducer(state, { type: 'select', key: refKey(row('deployments', 'api').ref) });
    state = kubeViewReducer(state, { type: 'drill' });
    state = kubeViewReducer(state, { type: 'dock', mode: 'events' });
    const snapshot = snapshotOf(state);
    expect(snapshot).toEqual({ query: state.query, crumbs: ['Deployment api'], dock: 'events' });

    const restored = kubeViewReducer(initialKubeView('other'), { type: 'restore', snapshot: { ...snapshot, selected: refKey({ kind: 'pods', namespace: 'shop', name: 'api-1' }) } });
    expect(restored.query).toEqual(snapshot.query);
    expect(restored.dock).toBe('events');
    expect(restored.crumbs.map(c => c.label)).toEqual(['Deployment api']);
    expect(restored.selected).toBe(refKey({ kind: 'pods', namespace: 'shop', name: 'api-1' }));
    expect(restored.loading).toBe(true);
    expect(snapshotOf(restored)).toEqual({ ...snapshot, selected: refKey({ kind: 'pods', namespace: 'shop', name: 'api-1' }) });
  });

  it('snapshotOf omits selected when nothing is selected', () => {
    expect(snapshotOf(initialKubeView('shop'))).toEqual({ query: { kind: 'pods', namespace: 'shop' }, crumbs: [], dock: 'logs' });
  });
});

describe('formatting helpers', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');

  it('formatAge gives seconds, minutes, hours and days', () => {
    expect(formatAge('2026-10-16T11:59:19Z', now)).toBe('41s');
    expect(formatAge('2026-10-16T11:48:00Z', now)).toBe('12m');
    expect(formatAge('2026-10-16T09:00:00Z', now)).toBe('3h');
    expect(formatAge('2026-10-07T12:00:00Z', now)).toBe('9d');
    expect(formatAge('2026-10-16T12:00:05Z', now)).toBe('0s');
    expect(formatAge('nope', now)).toBe('-');
  });

  it('formatUsage gives millicores and binary memory units', () => {
    expect(formatUsage('cpu', 250)).toBe('250m');
    expect(formatUsage('cpu', 1500)).toBe('1500m');
    expect(formatUsage('memory', 1.2 * 1024 ** 3)).toBe('1.2Gi');
    expect(formatUsage('memory', 2 * 1024 ** 3)).toBe('2Gi');
    expect(formatUsage('memory', 512 * 1024 ** 2)).toBe('512Mi');
    expect(formatUsage('memory', 64 * 1024)).toBe('64Ki');
  });

  it('sparkline scales between min and max, and is empty for no values', () => {
    expect(sparkline([])).toBe('');
    expect(sparkline([0, 1, 2, 3, 4, 5, 6, 7])).toBe('▁▂▃▄▅▆▇█');
    expect(sparkline([7, 0])).toBe('█▁');
    expect(sparkline([3, 3])).toBe('▁▁');
  });
});

describe('cluster events', () => {
  it('stores status, overview and usage events without checking viewId', () => {
    let state = initialKubeView('shop');
    const events: KubeEvent[] = [
      { type: 'status', viewId: 'other-view', status },
      { type: 'overview', viewId: 'other-view', nodes: [nodeTile], problems: [{ id: 'p1', kind: 'crashloop', ref: { kind: 'pods', namespace: 'shop', name: 'api-1' }, message: 'CrashLoopBackOff' }], namespaces: ['shop', 'billing'] },
      { type: 'usage', viewId: 'other-view', pods: usage },
    ];
    for (const event of events) state = kubeViewReducer(state, { type: 'event', event });
    expect(state.status).toEqual(status);
    expect(state.nodes).toEqual([nodeTile]);
    expect(state.problems).toHaveLength(1);
    expect(state.namespaces).toEqual(['shop', 'billing']);
    expect(state.usage).toEqual(usage);
  });
});
