import { describe, expect, it } from 'vitest';
import type { CodedError } from '../../shared/errors';
import type { ClusterStatus, KubeEvent, KubeKind, KubeRow, NodeTile, UsageHistory } from '../../shared/kubernetes';
import { KIND_INFO, refKey } from '../../shared/kubernetes';
import { activeFilter, activeGrouping, columnsOf, compileFilter, navigableRows, tableItems, defaultSort, filterOf, isFiltered, searchedRows, dockContainer, dockSelection, dockTerminalKey, settleArm, formatAge, formatUsage, initialKubeView, kubeViewReducer, snapshotOf, sparkline, visibleRows } from './kube-view';
import type { KubeViewAction, KubeViewState } from './kube-view';
import { KubeViewSnapshotSchema } from '../../shared/kubernetes-schema';

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

describe('updatedAt (1.14)', () => {
  const overviewEvent = (at?: number): KubeViewAction => ({ type: 'event', at, event: { type: 'overview', viewId: 'v1', nodes: [], problems: [], namespaces: [] } as KubeEvent });
  it('starts at 0 and takes `at` from rows and overview events', () => {
    const state = initialKubeView('shop');
    expect(state.updatedAt).toBe(0);
    expect(kubeViewReducer(state, overviewEvent(5000)).updatedAt).toBe(5000);
    expect(kubeViewReducer(state, { type: 'event', at: 7000, event: { type: 'rows', viewId: 'v1', query: state.query, reset: true, upserts: [], deletes: [] } }).updatedAt).toBe(7000);
  });
  it('falls back to state.now without `at`', () => {
    const state = kubeViewReducer(initialKubeView('shop'), { type: 'tick', now: 9000 });
    expect(kubeViewReducer(state, overviewEvent()).updatedAt).toBe(9000);
  });
  it('is not changed by status, usage or trouble events', () => {
    const state = { ...initialKubeView('shop'), updatedAt: 42 };
    expect(kubeViewReducer(state, { type: 'event', at: 99, event: { type: 'status', viewId: 'v1', status } }).updatedAt).toBe(42);
  });
});

describe('trouble', () => {
  const trouble = (state: KubeViewState, error?: CodedError, query = state.query): KubeViewState =>
    kubeViewReducer(state, { type: 'event', event: { type: 'trouble', viewId: 'v1', query, ...(error ? { error } : {}) } });
  const forbidden: CodedError = { code: 'kubernetes.forbiddenResource', params: { resource: 'ingresses', verb: 'list', namespace: 'shop' } };

  it('keeps the error text for the shown query, ignores other queries and clears it when trouble is over', () => {
    let state = initialKubeView('shop');
    state = trouble(state, forbidden);
    expect(state.trouble).toBe('Keine Berechtigung: ingresses/list in shop');
    expect(state.loading).toBe(true);
    expect(trouble(state, forbidden, { kind: 'services', namespace: 'shop' })).toBe(state);
    expect(trouble(state).trouble).toBeNull();
  });

  it('forgets the message when the view moves to another table', () => {
    const state = kubeViewReducer(trouble(initialKubeView('shop'), { code: 'kubernetes.apiError' }), { type: 'setKind', kind: 'services' });
    expect(state.trouble).toBeNull();
  });
});

describe('default namespace', () => {
  const withNamespace = (namespace?: string): ClusterStatus => ({ ...status, ...(namespace ? { namespace } : {}) });
  const statusEvent = (state: KubeViewState, value: ClusterStatus): KubeViewState =>
    kubeViewReducer(state, { type: 'event', event: { type: 'status', viewId: 'v1', status: value } });

  it('applies the cluster namespace once, to a view that has not moved', () => {
    // While connecting the kubeconfig is not read yet, so a status without namespace changes nothing.
    let state = statusEvent(initialKubeView('default'), { ...withNamespace(), state: 'connecting' });
    expect(state.query.namespace).toBe('default');
    state = statusEvent(state, withNamespace('shop'));
    expect(state.query).toEqual({ kind: 'pods', namespace: 'shop' });
    expect(state.loading).toBe(true);
    state = statusEvent(state, withNamespace('other'));
    expect(state.query.namespace).toBe('shop');
  });

  it('keeps what the user chose and what a workspace restored', () => {
    const moved = statusEvent(kubeViewReducer(initialKubeView('default'), { type: 'setNamespace', namespace: null }), withNamespace('shop'));
    expect(moved.query.namespace).toBeNull();
    const restored = statusEvent(kubeViewReducer(initialKubeView('default'), { type: 'restore', snapshot: { query: { kind: 'pods', namespace: 'kept' }, crumbs: [], dock: 'logs' } }), withNamespace('shop'));
    expect(restored.query.namespace).toBe('kept');
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
    state = kubeViewReducer(state, { type: 'search', text: 'a' });
    state = kubeViewReducer(state, { type: 'select', key: refKey(row('pods', 'a').ref) });
    state = kubeViewReducer(state, { type: 'setKind', kind: 'deployments' });
    expect(state.query).toEqual({ kind: 'deployments', namespace: 'shop' });
    expect(state.rows).toEqual([]);
    expect(state.loading).toBe(true);
    expect(state.crumbs).toEqual([]);
    expect(state.selected).toBeNull();
    expect(filterOf(state).text).toBe('');
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

const match = (r: KubeRow, text: string): boolean => compileFilter(r.ref.kind, { text, chips: [] }, 0)(r);

describe('filter and sort', () => {
  it('matches names and key=value labels case-insensitively; empty matches everything', () => {
    const pod = row('pods', 'api-1', { labels: { app: 'api', tier: 'Web' } });
    expect(match(pod, 'api')).toBe(true);
    expect(match(pod, 'API-1')).toBe(true);
    expect(match(pod, 'db')).toBe(false);
    expect(match(pod, 'app=api')).toBe(true);
    expect(match(pod, 'App=API')).toBe(true);
    expect(match(pod, 'app=db')).toBe(false);
    expect(match(pod, 'tier=web')).toBe(true);
    expect(match(pod, '')).toBe(true);
    expect(match(pod, '   ')).toBe(true);
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
    state = kubeViewReducer(state, { type: 'search', text: 'web' });
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
      { type: 'overview', viewId: 'other-view', nodes: [nodeTile], problems: [{ id: 'p1', kind: 'crashloop', ref: { kind: 'pods', namespace: 'shop', name: 'api-1' }, error: { code: 'kubernetes.problemCrashloop', params: { name: 'api-1', restarts: 3 } } }], namespaces: ['shop', 'billing'] },
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

describe('dockTerminalKey', () => {
  it('restarts log streams after a reconnect but never a shell', () => {
    expect(dockTerminalKey('pods/shop/api-1', 'api', 'logs', 0)).not.toBe(dockTerminalKey('pods/shop/api-1', 'api', 'logs', 1));
    expect(dockTerminalKey('pods/shop/api-1', 'api', 'previous', 0)).not.toBe(dockTerminalKey('pods/shop/api-1', 'api', 'previous', 1));
    expect(dockTerminalKey('pods/shop/api-1', 'api', 'shell', 0)).toBe(dockTerminalKey('pods/shop/api-1', 'api', 'shell', 1));
  });
  it('changes with pod, container and mode', () => {
    const key = dockTerminalKey('pods/shop/api-1', 'api', 'shell', 0);
    expect(dockTerminalKey('pods/shop/api-2', 'api', 'shell', 0)).not.toBe(key);
    expect(dockTerminalKey('pods/shop/api-1', 'sidecar', 'shell', 0)).not.toBe(key);
    expect(dockTerminalKey('pods/shop/api-1', 'api', 'logs', 0)).not.toBe(key);
  });
});

describe('log format', () => {
  it('defaults to compact and is set per tab', () => {
    const state = initialKubeView('shop');
    expect(state.logFormat).toBe('compact');
    expect(kubeViewReducer(state, { type: 'setLogFormat', format: 'raw' }).logFormat).toBe('raw');
    expect(kubeViewReducer(state, { type: 'setLogFormat', format: 'compact' })).toBe(state);
  });
  it('is in the snapshot only when raw and is restored', () => {
    const state = initialKubeView('shop');
    expect(snapshotOf(state).logFormat).toBeUndefined();
    const raw = kubeViewReducer(state, { type: 'setLogFormat', format: 'raw' });
    expect(snapshotOf(raw).logFormat).toBe('raw');
    expect(kubeViewReducer(state, { type: 'restore', snapshot: snapshotOf(raw) }).logFormat).toBe('raw');
    expect(kubeViewReducer(raw, { type: 'restore', snapshot: snapshotOf(state) }).logFormat).toBe('compact');
  });
  it('reopens log streams on a format change but never the shell', () => {
    expect(dockTerminalKey('p', 'c', 'logs', 0, 'raw')).not.toBe(dockTerminalKey('p', 'c', 'logs', 0, 'compact'));
    expect(dockTerminalKey('p', 'c', 'previous', 0, 'raw')).not.toBe(dockTerminalKey('p', 'c', 'previous', 0));
    expect(dockTerminalKey('p', 'c', 'logs', 0)).toBe(dockTerminalKey('p', 'c', 'logs', 0, 'compact'));
    expect(dockTerminalKey('p', 'c', 'shell', 0, 'raw')).toBe(dockTerminalKey('p', 'c', 'shell', 3, 'compact'));
  });
});

describe('openQuery, sortBy and container choice', () => {
  const pod = row('pods', 'api-1', { containers: ['app', 'sidecar'] });
  const podKey = refKey(pod.ref);

  it('openQuery pushes the current query as crumb and back restores it', () => {
    let state = rowsEvent(kubeViewReducer(initialKubeView('shop'), { type: 'setKind', kind: 'deployments' }), [row('deployments', 'api')]);
    state = kubeViewReducer(state, { type: 'search', text: 'x' });
    state = kubeViewReducer(state, { type: 'sort', key: 'name' });
    const before = state.query;
    state = kubeViewReducer(state, { type: 'openQuery', query: { kind: 'jobs', namespace: 'shop' }, crumb: 'CronJob nightly' });
    expect(state.query).toEqual({ kind: 'jobs', namespace: 'shop' });
    expect(state.crumbs).toEqual([{ label: 'CronJob nightly', query: before, text: 'x' }]);
    expect(state.selected).toBeNull();
    expect(filterOf(state).text).toBe('');
    expect(state.rows).toEqual([]);
    expect(state.loading).toBe(true);
    expect(state.sort).toEqual({ key: 'name', descending: false });
    state = kubeViewReducer(state, { type: 'back' });
    expect(state.query).toEqual(before);
    expect(state.crumbs).toEqual([]);
  });

  it('openQuery leaves containersOf', () => {
    let state = rowsEvent(initialKubeView('shop'), [pod]);
    state = kubeViewReducer(state, { type: 'select', key: podKey });
    state = kubeViewReducer(state, { type: 'drill' });
    state = kubeViewReducer(state, { type: 'openQuery', query: { kind: 'events', namespace: 'shop' }, crumb: 'Pod api-1' });
    expect(state.containersOf).toBeNull();
    expect(state.container).toBeNull();
  });

  it('sortBy sets the sort and null restores arrival order', () => {
    let state = rowsEvent(initialKubeView('shop'), [row('pods', 'c'), row('pods', 'a'), row('pods', 'b')]);
    state = kubeViewReducer(state, { type: 'sortBy', sort: { key: 'name', descending: false } });
    expect(visibleRows(state).map(r => r.ref.name)).toEqual(['a', 'b', 'c']);
    state = kubeViewReducer(state, { type: 'sortBy', sort: { key: 'name', descending: true } });
    expect(visibleRows(state).map(r => r.ref.name)).toEqual(['c', 'b', 'a']);
    state = kubeViewReducer(state, { type: 'sortBy', sort: null });
    expect(state.sort).toBeNull();
    expect(visibleRows(state).map(r => r.ref.name)).toEqual(['c', 'a', 'b']);
  });

  it('selectContainer works without drill-down and resets only when the selection changes', () => {
    const other = row('pods', 'api-2', { containers: ['app'] });
    let state = rowsEvent(initialKubeView('shop'), [pod, other]);
    state = kubeViewReducer(state, { type: 'select', key: podKey });
    state = kubeViewReducer(state, { type: 'selectContainer', name: 'sidecar' });
    expect(state.containersOf).toBeNull();
    expect(state.container).toBe('sidecar');
    expect(kubeViewReducer(state, { type: 'select', key: podKey }).container).toBe('sidecar');
    expect(kubeViewReducer(state, { type: 'select', key: refKey(other.ref) }).container).toBeNull();
    expect(kubeViewReducer(state, { type: 'move', delta: 1 }).container).toBeNull();
    expect(kubeViewReducer(state, { type: 'jump', ref: other.ref }).container).toBeNull();
    expect(kubeViewReducer(state, { type: 'setKind', kind: 'nodes' }).container).toBeNull();
    expect(kubeViewReducer(state, { type: 'setNamespace', namespace: 'x' }).container).toBeNull();
  });

  it('container resets when keepSelection moves the selection, not when rows just update', () => {
    const other = row('pods', 'api-2', { containers: ['app'] });
    let state = rowsEvent(initialKubeView('shop'), [pod, other]);
    state = kubeViewReducer(state, { type: 'select', key: podKey });
    state = kubeViewReducer(state, { type: 'selectContainer', name: 'sidecar' });
    expect(rowsEvent(state, [pod], { reset: false }).container).toBe('sidecar');
    const moved = rowsEvent(state, [], { reset: false, deletes: [pod.uid] });
    expect(moved.selected).toBe(refKey(other.ref));
    expect(moved.container).toBeNull();
  });

  it('dockContainer prefers a valid choice, else the first container', () => {
    expect(dockContainer(pod, 'sidecar')).toBe('sidecar');
    expect(dockContainer(pod, 'gone')).toBe('app');
    expect(dockContainer(pod, null)).toBe('app');
    expect(dockContainer(row('pods', 'x'), null)).toBeNull();
    expect(dockContainer(null, 'app')).toBeNull();
  });

  it('dockSelection honours the chosen container without a drill-down (I-1)', () => {
    const state = kubeViewReducer(rowsEvent(initialKubeView('shop'), [pod]), { type: 'select', key: refKey(pod.ref) });
    const chosen = kubeViewReducer(state, { type: 'selectContainer', name: 'sidecar' });
    expect(chosen.containersOf).toBeNull();
    const selected = visibleRows(chosen).find(r => refKey(r.ref) === chosen.selected) ?? null;
    expect(dockSelection(chosen.containersOf, selected, chosen.container)).toMatchObject({ container: 'sidecar', armKey: `${refKey(pod.ref)}/sidecar` });
    expect(dockSelection(null, selected, null).container).toBe('app');
    expect(dockSelection(null, row('deployments', 'd'), null)).toEqual({ podRow: null, container: null, armKey: null });
  });

  it('an armed shell does not come back when the selection returns to the armed pod (C-1)', () => {
    const other = row('pods', 'api-2', { containers: ['app'] });
    let state = rowsEvent(initialKubeView('shop'), [pod, other]);
    state = kubeViewReducer(state, { type: 'select', key: refKey(pod.ref) });
    let stored: string | null = null;
    const render = (): string | null => {
      const selected = visibleRows(state).find(r => refKey(r.ref) === state.selected) ?? null;
      const { armKey } = dockSelection(state.containersOf, selected, state.container);
      const settled = settleArm(stored, armKey);
      stored = settled; // ClusterView writes the settled value back during render
      return settled;
    };
    stored = dockSelection(null, pod, null).armKey; // click on "Shell öffnen"
    expect(render()).toBe(`${refKey(pod.ref)}/app`);
    state = kubeViewReducer(state, { type: 'move', delta: 1 });
    expect(render()).toBeNull();
    state = kubeViewReducer(state, { type: 'move', delta: -1 });
    expect(state.selected).toBe(refKey(pod.ref));
    expect(render()).toBeNull();
  });

  it('settleArm keeps only a matching key', () => {
    expect(settleArm('a/b', 'a/b')).toBe('a/b');
    expect(settleArm('a/b', 'a/c')).toBeNull();
    expect(settleArm('a/b', null)).toBeNull();
    expect(settleArm(null, null)).toBeNull();
  });

  it('drill does nothing for an empty selector map', () => {
    const svc = row('services', 'ext', { selector: {} });
    let state = rowsEvent(kubeViewReducer(initialKubeView('shop'), { type: 'setKind', kind: 'services' }), [svc]);
    state = kubeViewReducer(state, { type: 'select', key: refKey(svc.ref) });
    expect(kubeViewReducer(state, { type: 'drill' })).toBe(state);
  });

  it('drill on a CronJob opens its jobs with a crumb and a name filter', () => {
    const cron = row('cronjobs', 'nightly');
    let state = rowsEvent(kubeViewReducer(initialKubeView('shop'), { type: 'setKind', kind: 'cronjobs' }), [cron]);
    state = kubeViewReducer(state, { type: 'select', key: refKey(cron.ref) });
    state = kubeViewReducer(state, { type: 'drill' });
    expect(state.query).toEqual({ kind: 'jobs', namespace: 'shop' });
    expect(state.crumbs.map(c => c.label)).toEqual(['CronJob nightly']);
    expect(filterOf(state).text).toBe('owner:nightly');
    state = kubeViewReducer(state, { type: 'back' });
    expect(state.query).toEqual({ kind: 'cronjobs', namespace: 'shop' });
  });
});

const NOW = Date.parse('2026-10-18T12:00:00Z');
const at = (minutesAgo: number): string => new Date(NOW - minutesAgo * 60_000).toISOString();
const podsState = (rows: KubeRow[]): KubeViewState => rowsEvent(initialKubeView('shop'), rows);
const pod = (name: string, status: string, extra: Partial<KubeRow> = {}): KubeRow =>
  row('pods', name, { cells: { name, status, ready: '1/1', restarts: 0 }, tone: status === 'Running' ? 'ok' : 'bad', ...extra });
const names = (state: KubeViewState): string[] => visibleRows(state).map(r => r.ref.name);
const apply = (state: KubeViewState, ...actions: KubeViewAction[]): KubeViewState => actions.reduce(kubeViewReducer, state);

describe('filters per kind (C9, C11)', () => {
  it('keeps text and chips per kind across setKind', () => {
    let state = apply(initialKubeView('shop'), { type: 'search', text: 'api' }, { type: 'toggleChip', id: 'failed' });
    expect(filterOf(state)).toEqual({ text: 'api', chips: ['failed'] });
    state = apply(state, { type: 'setKind', kind: 'services' });
    expect(filterOf(state)).toEqual({ text: '', chips: [] });
    state = apply(state, { type: 'search', text: 'web' }, { type: 'setKind', kind: 'pods' });
    expect(filterOf(state)).toEqual({ text: 'api', chips: ['failed'] });
  });

  it('keeps filters on setNamespace', () => {
    const state = apply(initialKubeView('shop'), { type: 'search', text: 'api' }, { type: 'setNamespace', namespace: null });
    expect(filterOf(state).text).toBe('api');
  });

  it('cuts the search text to MAX_SEARCH_LENGTH (B4)', () => {
    expect(filterOf(apply(initialKubeView('shop'), { type: 'search', text: 'x'.repeat(300) })).text).toHaveLength(200);
  });

  it('toggleChip adds in CHIPS order, removes again, and ignores unknown ids by reference', () => {
    let state = apply(initialKubeView('shop'), { type: 'toggleChip', id: 'restarts' }, { type: 'toggleChip', id: 'attention' });
    expect(filterOf(state).chips).toEqual(['attention', 'restarts']);
    state = apply(state, { type: 'toggleChip', id: 'restarts' });
    expect(filterOf(state).chips).toEqual(['attention']);
    expect(kubeViewReducer(state, { type: 'toggleChip', id: 'nope' })).toBe(state);
  });

  it('setChips replaces and keeps only known ids', () => {
    const state = apply(initialKubeView('shop'), { type: 'setChips', ids: ['waiting', 'bogus', 'failed', 'waiting'] });
    expect(filterOf(state).chips).toEqual(['waiting', 'failed']);
  });

  it('clearFilter clears text and chips of the current kind and is a no-op without a filter', () => {
    const empty = initialKubeView('shop');
    expect(kubeViewReducer(empty, { type: 'clearFilter' })).toBe(empty);
    const state = apply(empty, { type: 'search', text: 'a' }, { type: 'toggleChip', id: 'failed' }, { type: 'clearFilter' });
    expect(filterOf(state)).toEqual({ text: '', chips: [] });
    expect(isFiltered(filterOf(state))).toBe(false);
    expect(isFiltered({ text: ' ', chips: [] })).toBe(false);
    expect(isFiltered({ text: '', chips: ['x'] })).toBe(true);
  });

  it('acts on the pod table behind the container list', () => {
    const p = pod('api-1', 'Running', { containers: ['app'] });
    let state = apply(podsState([p]), { type: 'select', key: refKey(p.ref) }, { type: 'drill' });
    expect(state.containersOf).not.toBeNull();
    state = apply(state, { type: 'search', text: 'api' });
    expect(filterOf(state).text).toBe('api');
  });

  it('drill into pods clears only the target text and back restores the source text', () => {
    const dep = row('deployments', 'api', { selector: { app: 'api' } });
    let state = apply(initialKubeView('shop'), { type: 'setChips', ids: ['failed'] }, { type: 'search', text: 'old' });
    state = apply(state, { type: 'setKind', kind: 'deployments' }, { type: 'search', text: 'api' });
    state = rowsEvent(state, [dep]);
    state = apply(state, { type: 'select', key: refKey(dep.ref) }, { type: 'drill' });
    expect(state.query.kind).toBe('pods');
    expect(filterOf(state)).toEqual({ text: '', chips: ['failed'] });
    expect(state.crumbs[0].text).toBe('api');
    state = apply(state, { type: 'back' });
    expect(state.query.kind).toBe('deployments');
    expect(filterOf(state).text).toBe('api');
  });

  it('jump clears text and chips of the target kind only', () => {
    let state = apply(initialKubeView('shop'), { type: 'search', text: 'a' }, { type: 'setChips', ids: ['failed'] });
    state = apply(state, { type: 'setKind', kind: 'nodes' }, { type: 'search', text: 'w' });
    state = apply(state, { type: 'jump', ref: { kind: 'pods', namespace: 'shop', name: 'x' } });
    expect(filterOf(state)).toEqual({ text: '', chips: [] });
    state = apply(state, { type: 'setKind', kind: 'nodes' });
    expect(filterOf(state).text).toBe('w');
  });
});

describe('visibleRows with chips and search (B1)', () => {
  it('combines search and chips', () => {
    let state = podsState([pod('web-1', 'Running'), pod('web-2', 'Failed'), pod('db-1', 'Failed')]);
    state = apply(state, { type: 'search', text: 'web' }, { type: 'toggleChip', id: 'failed' });
    expect(names(state)).toEqual(['web-2']);
    expect(searchedRows(state).map(r => r.ref.name)).toEqual(['web-1', 'web-2']);
  });

  it('uses state.now for time chips and compileFilter for the same predicate', () => {
    const events = [row('events', 'new', { cells: { last: at(2), type: 'Normal' } }), row('events', 'old', { cells: { last: at(60), type: 'Normal' } })];
    let state = apply(initialKubeView('shop'), { type: 'setKind', kind: 'events' });
    state = apply(rowsEvent(state, events), { type: 'toggleChip', id: '5m' }, { type: 'tick', now: NOW });
    expect(state.now).toBe(NOW);
    expect(names(state)).toEqual(['new']);
    expect(compileFilter('events', { text: '', chips: ['5m'] }, NOW)(events[1])).toBe(false);
  });
});

describe('selection visibility (C10, C12)', () => {
  const rows = [pod('a', 'Running'), pod('b', 'Failed'), pod('c', 'Running'), pod('d', 'Running')];
  const key = (name: string): string => refKey(row('pods', name).ref);

  it('filter mode: selection hidden by a chip becomes null, a visible one stays', () => {
    const selected = apply(podsState(rows), { type: 'select', key: key('a') });
    expect(apply(selected, { type: 'toggleChip', id: 'running' }).selected).toBe(key('a'));
    const hidden = apply(selected, { type: 'toggleChip', id: 'failed' });
    expect(hidden.selected).toBeNull();
    expect(hidden.container).toBeNull();
  });

  it('keeps a selection that is not loaded yet', () => {
    const state = apply(initialKubeView('shop'), { type: 'select', key: key('later') }, { type: 'search', text: 'zzz' });
    expect(state.selected).toBe(key('later'));
  });

  it('rows mode: a selection hidden by a changed row moves to the same visible position', () => {
    let state = apply(podsState(rows), { type: 'toggleChip', id: 'running' }, { type: 'select', key: key('c') });
    expect(names(state)).toEqual(['a', 'c', 'd']);
    state = rowsEvent(state, [pod('c', 'Failed')], { reset: false });
    expect(state.selected).toBe(key('d'));
  });

  it('rows mode: moves to the last row, else null', () => {
    let state = apply(podsState(rows), { type: 'toggleChip', id: 'running' }, { type: 'select', key: key('d') });
    state = rowsEvent(state, [pod('d', 'Failed')], { reset: false });
    expect(state.selected).toBe(key('c'));
    const single = apply(podsState([pod('a', 'Running')]), { type: 'toggleChip', id: 'running' }, { type: 'select', key: key('a') });
    expect(rowsEvent(single, [pod('a', 'Failed')], { reset: false }).selected).toBeNull();
  });

  it('tick re-evaluates time chips against the selection', () => {
    const e = row('events', 'e1', { cells: { last: at(4), type: 'Normal' } });
    let state = apply(initialKubeView('shop'), { type: 'setKind', kind: 'events' });
    state = apply(rowsEvent(state, [e]), { type: 'toggleChip', id: '5m' }, { type: 'tick', now: NOW }, { type: 'select', key: refKey(e.ref) });
    expect(state.selected).toBe(refKey(e.ref));
    state = apply(state, { type: 'tick', now: NOW + 3 * 60_000 });
    expect(state.selected).toBeNull();
  });
});

describe('final review fixes', () => {
  const key = (name: string): string => refKey(row('pods', name).ref);

  it('I1: container mode keeps selection and container when the pod gets hidden by a chip', () => {
    const rows = [pod('a', 'Running', { containers: ['x', 'y'] }), pod('b', 'Running')];
    let state = apply(podsState(rows), { type: 'toggleChip', id: 'running' }, { type: 'select', key: key('a') }, { type: 'drill' }, { type: 'selectContainer', name: 'y' });
    expect(state.containersOf).not.toBeNull();
    state = rowsEvent(state, [pod('a', 'Failed', { containers: ['x', 'y'] })], { reset: false });
    expect(state.selected).toBe(key('a'));
    expect(state.container).toBe('y');
  });

  it('I2: snapshotOf keeps at most the last 8 crumbs of at most 300 characters', () => {
    const query = initialKubeView('shop').query;
    const crumbs = Array.from({ length: 9 }, (_, i) => ({ label: `${i}`.repeat(3), query, text: '' }));
    const snapshot = snapshotOf({ ...initialKubeView('shop'), crumbs });
    expect(snapshot.crumbs).toHaveLength(8);
    expect(snapshot.crumbs[0]).toBe('111');
    expect(KubeViewSnapshotSchema.safeParse(snapshot).success).toBe(true);
    const long = snapshotOf({ ...initialKubeView('shop'), crumbs: [{ label: 'x'.repeat(400), query, text: '' }] });
    expect(long.crumbs[0]).toHaveLength(300);
  });

  it('M4: a namespace sort is reset when setNamespace removes the column', () => {
    let state = apply(initialKubeView(null), { type: 'sort', key: 'namespace' });
    expect(state.sort?.key).toBe('namespace');
    state = apply(state, { type: 'setNamespace', namespace: 'shop' });
    expect(state.sort).toBeNull();
    const events = apply(initialKubeView(null), { type: 'setKind', kind: 'events' }, { type: 'sort', key: 'namespace' }, { type: 'setNamespace', namespace: 'shop' });
    expect(events.sort).toEqual({ key: 'last', descending: true });
  });

  it('M6: rows without a value stay last under a descending sort', () => {
    const e1 = row('events', 'e1', { cells: { last: at(1) } });
    const e2 = row('events', 'e2', { cells: { last: at(5) } });
    const e3 = row('events', 'e3', { cells: {} });
    let state = apply(initialKubeView('shop'), { type: 'setKind', kind: 'events' });
    state = rowsEvent(state, [e3, e2, e1]);
    expect(names(state)).toEqual(['e1', 'e2', 'e3']);
    expect(names(apply(state, { type: 'sort', key: 'last' }))).toEqual(['e2', 'e1', 'e3']);
  });
});

describe('columnsOf, defaultSort and sorting (B5)', () => {
  it('adds a namespace column after name only for all-namespaces of namespaced kinds', () => {
    const all = initialKubeView(null);
    expect(columnsOf(all).map(c => c.key).slice(0, 2)).toEqual(['name', 'namespace']);
    expect(columnsOf(initialKubeView('shop')).some(c => c.key === 'namespace')).toBe(false);
    expect(columnsOf({ ...all, query: { kind: 'nodes', namespace: null } }).some(c => c.key === 'namespace')).toBe(false);
  });

  it('sorts by the namespace column', () => {
    let state = rowsEvent(initialKubeView(null), [row('pods', 'a', {}, 'zeta'), row('pods', 'b', {}, 'alpha')]);
    state = apply(state, { type: 'sort', key: 'namespace' });
    expect(names(state)).toEqual(['b', 'a']);
  });

  it('events default to Zuletzt descending; setKind and sortBy null apply it', () => {
    expect(defaultSort('events')).toEqual({ key: 'last', descending: true });
    expect(defaultSort('pods')).toBeNull();
    let state = apply(initialKubeView('shop'), { type: 'setKind', kind: 'events' });
    expect(state.sort).toEqual({ key: 'last', descending: true });
    state = apply(state, { type: 'sort', key: 'reason' }, { type: 'sortBy', sort: null });
    expect(state.sort).toEqual({ key: 'last', descending: true });
    expect(apply(initialKubeView('shop'), { type: 'sort', key: 'name' }, { type: 'sortBy', sort: null }).sort).toBeNull();
  });
});

describe('snapshotOf and restore filters (B4, C14, C15)', () => {
  it('omits filters without content and does not trim', () => {
    const plain = initialKubeView('shop');
    expect(snapshotOf(plain)).not.toHaveProperty('filters');
    expect(snapshotOf(apply(plain, { type: 'search', text: '  ' }))).not.toHaveProperty('filters');
    const state = apply(plain, { type: 'search', text: ' api ' }, { type: 'setKind', kind: 'services' }, { type: 'setChips', ids: ['headless'] });
    expect(snapshotOf(state).filters).toEqual({ pods: { text: ' api ' }, services: { chips: ['headless'] } });
  });

  it('a state with 300 characters still passes the schema', () => {
    const state = { ...initialKubeView('shop'), filters: { pods: { text: 'x'.repeat(300), chips: Array.from({ length: 30 }, (_, i) => `c${i}`) } } };
    const snapshot = snapshotOf(state);
    expect(snapshot.filters?.pods?.text).toHaveLength(200);
    expect(KubeViewSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('restore reads filters, drops unknown chips and empty kinds, and sets the default sort', () => {
    const snapshot = { query: { kind: 'events' as const, namespace: 'shop' }, crumbs: ['Pod x'], dock: 'logs' as const,
      filters: { events: { text: 'back', chips: ['warning', 'bogus'] }, pods: { chips: ['bogus'] } } };
    const state = apply(initialKubeView('shop'), { type: 'restore', snapshot });
    expect(state.filters).toEqual({ events: { text: 'back', chips: ['warning'] } });
    expect(state.sort).toEqual({ key: 'last', descending: true });
    expect(state.crumbs[0].text).toBe('');
    expect(apply(initialKubeView('shop'), { type: 'restore', snapshot: { ...snapshot, filters: undefined } }).filters).toEqual({});
  });
});

describe('initial namespace', () => {
  const ready = (namespace?: string): ClusterStatus => ({ state: 'ready', name: 'k8s', production: true, readOnly: false, metrics: true, ...(namespace ? { namespace } : {}) });
  const statusEvent = (status: ClusterStatus): KubeViewAction => ({ type: 'event', event: { type: 'status', viewId: 'v', status } });

  it('starts with all namespaces and keeps them when the cluster names none', () => {
    const start = initialKubeView(null);
    expect(start.query.namespace).toBeNull();
    const after = kubeViewReducer(start, statusEvent(ready()));
    expect(after.query.namespace).toBeNull();
    expect(after.pendingNamespace).toBe(false);
  });

  it('switches to the configured namespace once', () => {
    const after = kubeViewReducer(initialKubeView(null), statusEvent(ready('shop')));
    expect(after.query.namespace).toBe('shop');
  });
});

describe('column filters and grouping', () => {
  const key = (name: string): string => refKey(row('pods', name).ref);
  const cpod = (name: string, status: string, node: string, namespace = 'shop', extra: Partial<KubeRow> = {}): KubeRow =>
    row('pods', name, { cells: { name, status, ready: '1/1', restarts: 0, node }, node, tone: status === 'Running' ? 'ok' : 'bad', ...extra }, namespace);
  const col = (state: KubeViewState, k: string, value: string): KubeViewState => kubeViewReducer(state, { type: 'setColumnFilter', key: k, value });
  const grouped = (state: KubeViewState, by: 'node' | 'namespace' | 'status' | 'roles' | null): KubeViewState => kubeViewReducer(state, { type: 'setGroupBy', groupBy: by });
  const items = (state: KubeViewState): string[] => tableItems(state).map(i => (i.type === 'group' ? `[${i.label}:${i.count}${i.collapsed ? ':c' : ''}]` : i.row.ref.name));

  it('initial state has no groups', () => {
    expect(initialKubeView('shop').groups).toEqual({});
  });

  it('C6: ignores unknown and none keys, truncates, deletes on blank, keeps reference when unchanged', () => {
    const state = podsState([cpod('a', 'Running', 'n1')]);
    expect(col(state, 'bogus', 'x')).toBe(state);
    expect(col(state, 'cpu', 'x')).toBe(state);
    expect(col(state, 'namespace', 'shop')).toBe(state); // no namespace column with a namespace
    expect(col(state, 'name', '  ')).toBe(state);
    const set = col(state, 'name', ' a ');
    expect(filterOf(set).columns).toEqual({ name: ' a ' });
    expect(col(set, 'name', ' a ')).toBe(set);
    expect(filterOf(col(state, 'name', 'x'.repeat(150))).columns?.name).toHaveLength(100);
    const cleared = col(set, 'name', ' ');
    expect(filterOf(cleared)).toEqual({ text: '', chips: [] });
    expect('columns' in filterOf(cleared)).toBe(false);
  });

  it('filters rows by column, ANDed with search, and replaces the columns object', () => {
    let state = podsState([cpod('web-1', 'Running', 'n1'), cpod('web-2', 'Failed', 'n2'), cpod('db-1', 'Running', 'n2')]);
    state = col(state, 'status', 'Running');
    expect(names(state)).toEqual(['web-1', 'db-1']);
    const before = filterOf(state).columns;
    state = col(state, 'node', 'n2');
    expect(filterOf(state).columns).not.toBe(before);
    expect(names(state)).toEqual(['db-1']);
    state = apply(state, { type: 'search', text: 'web' });
    expect(names(state)).toEqual([]);
    expect(filterOf(state).columns).toEqual({ status: 'Running', node: 'n2' });
  });

  it('persists per kind across setKind', () => {
    let state = col(podsState([]), 'name', 'api');
    state = apply(state, { type: 'setKind', kind: 'services' });
    expect(filterOf(state).columns).toBeUndefined();
    state = apply(state, { type: 'setKind', kind: 'pods' });
    expect(filterOf(state).columns).toEqual({ name: 'api' });
  });

  it('B7: namespace column filter and grouping apply only with all namespaces', () => {
    const data = [cpod('a', 'Running', 'n1', 'shop'), cpod('b', 'Running', 'n1', 'other')];
    let state = apply(initialKubeView(null), { type: 'setColumnFilter', key: 'namespace', value: 'shop' }, { type: 'setGroupBy', groupBy: 'namespace' });
    state = rowsEvent(state, data);
    expect(names(state)).toEqual(['a']);
    expect(activeGrouping(state)?.by).toBe('namespace');
    state = rowsEvent(apply(state, { type: 'setNamespace', namespace: 'other' }), data);
    expect(names(state)).toEqual(['a', 'b']);
    expect(activeFilter(state)).toEqual({ text: '', chips: [] });
    expect('columns' in activeFilter(state)).toBe(false);
    expect(filterOf(state).columns).toEqual({ namespace: 'shop' });
    expect(activeGrouping(state)).toBeNull();
    expect(tableItems(state).every(i => i.type === 'row')).toBe(true);
    state = rowsEvent(apply(state, { type: 'setNamespace', namespace: null }), data);
    expect(names(state)).toEqual(['a']);
    expect(activeGrouping(state)?.by).toBe('namespace');
  });

  it('isFiltered counts column values; searchedRows ignores chips but uses columns (C9)', () => {
    expect(isFiltered({ text: '', chips: [], columns: { name: ' ' } })).toBe(false);
    expect(isFiltered({ text: '', chips: [], columns: { name: 'a' } })).toBe(true);
    let state = podsState([cpod('web-1', 'Running', 'n1'), cpod('web-2', 'Failed', 'n1'), cpod('db-1', 'Failed', 'n1')]);
    state = apply(state, { type: 'setColumnFilter', key: 'name', value: 'web' }, { type: 'toggleChip', id: 'failed' });
    expect(searchedRows(state).map(r => r.ref.name)).toEqual(['web-1', 'web-2']);
    expect(names(state)).toEqual(['web-2']);
  });

  it('B8: drill and back restore the column filters; openQuery on the same kind too', () => {
    const dep = row('deployments', 'api', { cells: { name: 'api' }, selector: { app: 'api' } });
    let state = apply(initialKubeView('shop'), { type: 'setKind', kind: 'deployments' }, { type: 'setColumnFilter', key: 'name', value: 'api' });
    state = rowsEvent(state, [dep]);
    state = apply(state, { type: 'select', key: refKey(dep.ref) }, { type: 'drill' });
    expect(state.crumbs[0].columns).toEqual({ name: 'api' });
    expect(filterOf(state)).toEqual({ text: '', chips: [] });
    state = apply(state, { type: 'back' });
    expect(filterOf(state).columns).toEqual({ name: 'api' });
    const plain = apply(initialKubeView('shop'), { type: 'openQuery', query: { kind: 'jobs', namespace: 'shop' }, crumb: 'x' });
    expect('columns' in plain.crumbs[0]).toBe(false);
    let same = apply(initialKubeView('shop'), { type: 'setColumnFilter', key: 'name', value: 'p' });
    same = apply(same, { type: 'openQuery', query: { kind: 'pods', namespace: 'shop', selector: { node: 'n1' } }, crumb: 'Node n1' });
    expect(filterOf(same).columns).toBeUndefined();
    same = apply(same, { type: 'back' });
    expect(filterOf(same).columns).toEqual({ name: 'p' });
  });

  it('jump clears the target kind columns', () => {
    let state = apply(initialKubeView('shop'), { type: 'setColumnFilter', key: 'name', value: 'p' });
    state = apply(state, { type: 'jump', ref: { kind: 'pods', namespace: 'shop', name: 'x' } });
    expect(filterOf(state)).toEqual({ text: '', chips: [] });
  });

  it('F clears all filters but keeps the grouping', () => {
    const state = apply(initialKubeView('shop'), { type: 'setColumnFilter', key: 'name', value: 'p' }, { type: 'setGroupBy', groupBy: 'node' });
    const cleared = kubeViewReducer(state, { type: 'clearFilter' });
    expect(filterOf(cleared)).toEqual({ text: '', chips: [] });
    expect('columns' in filterOf(cleared)).toBe(false);
    expect(cleared.groups.pods?.by).toBe('node');
  });

  it('C14: setGroupBy validates and resets collapsed', () => {
    const state = podsState([cpod('a', 'Running', 'n1')]);
    expect(grouped(state, null)).toBe(state);
    expect(grouped(state, 'roles')).toBe(state);
    expect(grouped(state, 'namespace')).toBe(state); // a namespace is selected
    const g = grouped(state, 'node');
    expect(g.groups.pods).toEqual({ by: 'node', collapsed: [] });
    expect(grouped(g, 'node')).toBe(g);
    const c = kubeViewReducer(g, { type: 'toggleGroup', key: 'n1' });
    expect(grouped(c, 'status').groups.pods).toEqual({ by: 'status', collapsed: [] });
    expect(grouped(c, null).groups).toEqual({});
  });

  it('C15: toggleGroup toggles, caps at 50 and ignores long keys and ungrouped tables', () => {
    const state = podsState([]);
    expect(kubeViewReducer(state, { type: 'toggleGroup', key: 'x' })).toBe(state);
    let g = grouped(state, 'node');
    expect(kubeViewReducer(g, { type: 'toggleGroup', key: 'x'.repeat(301) })).toBe(g);
    g = kubeViewReducer(g, { type: 'toggleGroup', key: 'a' });
    expect(g.groups.pods?.collapsed).toEqual(['a']);
    g = kubeViewReducer(g, { type: 'toggleGroup', key: 'a' });
    expect(g.groups.pods?.collapsed).toEqual([]);
    for (let i = 0; i < 52; i++) g = kubeViewReducer(g, { type: 'toggleGroup', key: `k${i}` });
    expect(g.groups.pods?.collapsed).toHaveLength(50);
    expect(g.groups.pods?.collapsed[0]).toBe('k2');
    expect(g.groups.pods?.collapsed[49]).toBe('k51');
  });

  it('keeps groups per kind across setKind and tableItems groups rows', () => {
    let state = grouped(podsState([cpod('a', 'Running', 'n2'), cpod('b', 'Running', 'n1'), cpod('c', 'Running', 'n2')]), 'node');
    expect(items(state)).toEqual(['[n1:1]', 'b', '[n2:2]', 'a', 'c']);
    state = apply(state, { type: 'setKind', kind: 'services' }, { type: 'setKind', kind: 'pods' });
    expect(state.groups.pods?.by).toBe('node');
  });

  it('B4: move follows display order', () => {
    let state = grouped(podsState([cpod('a', 'Running', 'n2'), cpod('b', 'Running', 'n1'), cpod('c', 'Running', 'n3'), cpod('d', 'Running', 'n2')]), 'node');
    expect(navigableRows(state).map(r => r.ref.name)).toEqual(['b', 'a', 'd', 'c']);
    state = apply(state, { type: 'move', delta: 1 });
    expect(state.selected).toBe(key('b'));
    state = apply(state, { type: 'move', delta: 1 });
    expect(state.selected).toBe(key('a'));
    state = apply(state, { type: 'move', delta: 1 });
    expect(state.selected).toBe(key('d'));
  });

  it('B4: move skips collapsed groups', () => {
    let state = grouped(podsState([cpod('a', 'Running', 'n1'), cpod('b', 'Running', 'n2'), cpod('c', 'Running', 'n3')]), 'node');
    state = apply(state, { type: 'toggleGroup', key: 'n2' }, { type: 'select', key: key('a') }, { type: 'move', delta: 1 });
    expect(state.selected).toBe(key('c'));
    expect(navigableRows(state).map(r => r.ref.name)).toEqual(['a', 'c']);
  });

  it('B5: collapsing the selected group clears the selection', () => {
    let state = grouped(podsState([cpod('a', 'Running', 'n1'), cpod('b', 'Running', 'n2')]), 'node');
    state = apply(state, { type: 'select', key: key('a') });
    const other = kubeViewReducer(state, { type: 'toggleGroup', key: 'n2' });
    expect(other.selected).toBe(key('a'));
    const hit = kubeViewReducer(state, { type: 'toggleGroup', key: 'n1' });
    expect(hit.selected).toBeNull();
    expect(hit.groups.pods?.collapsed).toEqual(['n1']);
  });

  it('B5: jump then rows event reveals the target group; select in a collapsed group reveals it', () => {
    let state = apply(initialKubeView('shop'), { type: 'setGroupBy', groupBy: 'node' }, { type: 'toggleGroup', key: 'n1' });
    state = apply(state, { type: 'jump', ref: { kind: 'pods', namespace: 'shop', name: 'a' } });
    expect(state.groups.pods?.collapsed).toEqual(['n1']);
    state = rowsEvent(state, [cpod('a', 'Running', 'n1'), cpod('b', 'Running', 'n2')]);
    expect(state.selected).toBe(key('a'));
    expect(state.groups.pods?.collapsed).toEqual([]);
    state = apply(state, { type: 'toggleGroup', key: 'n2' });
    expect(state.groups.pods?.collapsed).toEqual(['n2']);
    state = apply(state, { type: 'select', key: key('b') });
    expect(state.groups.pods?.collapsed).toEqual([]);
  });

  it('B5: reveal keeps the reference when nothing changes', () => {
    const state = grouped(podsState([cpod('a', 'Running', 'n1')]), 'node');
    expect(kubeViewReducer(state, { type: 'tick', now: 0 })).toBe(state);
    expect(kubeViewReducer(state, { type: 'select', key: null })).toBe(state);
  });

  it('B4: keepSelection in rows mode uses display position', () => {
    let state = grouped(podsState([cpod('a', 'Running', 'n2'), cpod('b', 'Running', 'n1'), cpod('c', 'Running', 'n2')]), 'node');
    // display: b | a c
    state = apply(state, { type: 'select', key: key('a') });
    state = rowsEvent(state, [], { reset: false, deletes: ['pods-a'] });
    expect(state.selected).toBe(key('c'));
    state = rowsEvent(state, [], { reset: false, deletes: ['pods-c'] });
    expect(state.selected).toBe(key('b'));
  });

  it('C21: snapshotOf stores raw columns, grouping and collapsed within the limits; schema accepts it', () => {
    let state = apply(initialKubeView(null), { type: 'setColumnFilter', key: 'name', value: 'x'.repeat(100) }, { type: 'setColumnFilter', key: 'namespace', value: 'shop' }, { type: 'setGroupBy', groupBy: 'namespace' });
    for (let i = 0; i < 60; i++) state = apply(state, { type: 'toggleGroup', key: `g${i}` });
    state = apply(state, { type: 'setNamespace', namespace: 'shop' });
    const snapshot = snapshotOf(state);
    expect(snapshot.filters?.pods?.columns).toEqual({ name: 'x'.repeat(100), namespace: 'shop' });
    expect(snapshot.filters?.pods?.groupBy).toBe('namespace');
    expect(snapshot.filters?.pods?.collapsed).toHaveLength(50);
    expect(KubeViewSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect('filters' in snapshotOf(initialKubeView('shop'))).toBe(false);
    const only = snapshotOf({ ...initialKubeView('shop'), groups: { pods: { by: 'node', collapsed: [] } }, filters: { services: { text: '', chips: [], columns: { name: ' ' } } } });
    expect(only.filters).toEqual({ pods: { groupBy: 'node' } });
  });

  it('C22: restore keeps valid columns and grouping, drops unknown ones, accepts old snapshots', () => {
    const base = { query: { kind: 'pods' as const, namespace: 'shop' }, crumbs: [], dock: 'logs' as const };
    const state = kubeViewReducer(initialKubeView('shop'), { type: 'restore', snapshot: { ...base, filters: {
      pods: { columns: { name: 'a', namespace: 'shop', cpu: 'x', bogus: 'y', status: ' ' }, groupBy: 'node', collapsed: ['n1', 'n1', 'n2'] },
      services: { groupBy: 'node', collapsed: ['x'] },
      nodes: { text: 'w' },
    } } });
    expect(state.filters.pods).toEqual({ text: '', chips: [], columns: { name: 'a', namespace: 'shop' } });
    expect(state.groups).toEqual({ pods: { by: 'node', collapsed: ['n1', 'n2'] } });
    expect(state.filters.services).toBeUndefined();
    expect(state.filters.nodes).toEqual({ text: 'w', chips: [] });
    const old = kubeViewReducer(state, { type: 'restore', snapshot: base });
    expect(old.filters).toEqual({});
    expect(old.groups).toEqual({});
  });

  it('visibleRows stays ungrouped while navigableRows follows the groups', () => {
    const state = grouped(podsState([cpod('a', 'Running', 'n2'), cpod('b', 'Running', 'n1')]), 'node');
    expect(names(state)).toEqual(['a', 'b']);
    expect(navigableRows(state).map(r => r.ref.name)).toEqual(['b', 'a']);
  });
});
