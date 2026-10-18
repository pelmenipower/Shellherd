import { describe, expect, it } from 'vitest';
import { KIND_COLUMNS, KUBE_KINDS, type KubeKind, type KubeRow } from '../../shared/kubernetes';
import {
  EMPTY_VALUE, FILTER_HELP, facetValues, FILTER_KIND_LABEL, GROUP_OPTIONS, cellValues, columnFilterKind, columnValues, columnsFor, compileColumnFilters,
  groupKey, groupRows, isValidColumnFilter, parseAgeFilter, parseNumberFilter, primaryFilterColumn,
} from './kube-columns';

function row(kind: KubeKind, name: string, cells: Record<string, string | number> = {}, extra: Partial<KubeRow> = {}, namespace: string | null = 'shop'): KubeRow {
  return { uid: `${kind}-${name}`, ref: { kind, namespace: namespace ?? undefined, name }, cells: { name, ...cells }, tone: 'ok', labels: {}, ...extra };
}
const col = (kind: KubeKind, key: string) => columnsFor(kind, null).find(c => c.key === key)!;
const NOW = Date.parse('2026-10-18T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('columnsFor', () => {
  it('adds Namespace after name for namespaced kinds with all namespaces', () => {
    expect(columnsFor('pods', null).map(c => c.key)).toEqual(['name', 'namespace', 'ready', 'status', 'restarts', 'cpu', 'memory', 'node', 'age']);
    expect(columnsFor('pods', null)[1]).toEqual({ key: 'namespace', label: 'Namespace' });
  });
  it('is KIND_COLUMNS for a namespace and for nodes', () => {
    expect(columnsFor('pods', 'shop')).toBe(KIND_COLUMNS.pods);
    expect(columnsFor('nodes', null)).toBe(KIND_COLUMNS.nodes);
  });
  it('puts namespace at index 0 without a name column', () => {
    expect(columnsFor('events', null).map(c => c.key)).toEqual(['namespace', 'type', 'reason', 'object', 'message', 'count', 'last']);
  });
});

describe('columnFilterKind', () => {
  const table: Record<string, string> = {
    'pods:name': 'text', 'pods:namespace': 'select', 'pods:ready': 'text', 'pods:status': 'select', 'pods:restarts': 'number',
    'pods:cpu': 'none', 'pods:memory': 'none', 'pods:node': 'select', 'pods:age': 'age',
    'deployments:name': 'text', 'deployments:namespace': 'select', 'deployments:ready': 'text', 'deployments:upToDate': 'number', 'deployments:image': 'text', 'deployments:age': 'age',
    'statefulsets:upToDate': 'number', 'statefulsets:image': 'text', 'daemonsets:upToDate': 'number', 'daemonsets:ready': 'text',
    'jobs:name': 'text', 'jobs:namespace': 'select', 'jobs:completions': 'text', 'jobs:status': 'select', 'jobs:lastRun': 'age', 'jobs:age': 'age',
    'cronjobs:name': 'text', 'cronjobs:namespace': 'select', 'cronjobs:schedule': 'text', 'cronjobs:lastRun': 'age', 'cronjobs:age': 'age',
    'services:name': 'text', 'services:namespace': 'select', 'services:type': 'select', 'services:clusterIp': 'text', 'services:ports': 'text', 'services:age': 'age',
    'ingresses:name': 'text', 'ingresses:namespace': 'select', 'ingresses:hosts': 'text', 'ingresses:address': 'text', 'ingresses:age': 'age',
    'nodes:name': 'text', 'nodes:status': 'select', 'nodes:roles': 'select', 'nodes:cpu': 'none', 'nodes:memory': 'none', 'nodes:pods': 'number', 'nodes:version': 'text',
    'events:type': 'select', 'events:reason': 'text', 'events:object': 'text', 'events:message': 'text', 'events:count': 'number', 'events:last': 'age',
  };
  it('matches the contract table', () => {
    for (const [id, expected] of Object.entries(table)) {
      const [kind, key] = id.split(':') as [KubeKind, string];
      expect(columnFilterKind(kind, col(kind, key)), id).toBe(expected);
    }
  });
  it('covers every column of every kind', () => {
    for (const kind of KUBE_KINDS) for (const c of columnsFor(kind, null)) expect(['text', 'select', 'number', 'age', 'none']).toContain(columnFilterKind(kind, c));
  });
});

describe('primaryFilterColumn', () => {
  it('is message for events, else name', () => {
    expect(primaryFilterColumn('events')).toBe('message');
    expect(primaryFilterColumn('pods')).toBe('name');
  });
});

describe('cellValues', () => {
  it('normalises empty markers away', () => {
    for (const empty of ['', '-', '–', '—', '  ']) expect(cellValues('services', row('services', 's', { clusterIp: empty }), 'clusterIp')).toEqual([]);
    expect(cellValues('services', row('services', 's', { clusterIp: ' 10.0.0.1 ' }), 'clusterIp')).toEqual(['10.0.0.1']);
  });
  it('reads namespace and name from ref', () => {
    expect(cellValues('pods', row('pods', 'api'), 'namespace')).toEqual(['shop']);
    expect(cellValues('nodes', row('nodes', 'w1', {}, {}, null), 'namespace')).toEqual([]);
    expect(cellValues('pods', { ...row('pods', 'api'), cells: {} }, 'name')).toEqual(['api']);
  });
  it('splits node roles', () => {
    expect(cellValues('nodes', row('nodes', 'w', { roles: 'control-plane, worker' }), 'roles')).toEqual(['control-plane', 'worker']);
    expect(cellValues('nodes', row('nodes', 'w', { roles: '—' }), 'roles')).toEqual([]);
  });
  it('stringifies numbers', () => {
    expect(cellValues('pods', row('pods', 'p', { restarts: 0 }), 'restarts')).toEqual(['0']);
    expect(cellValues('pods', row('pods', 'p'), 'restarts')).toEqual([]);
  });
});

describe('parseNumberFilter', () => {
  it('parses operators and plain numbers', () => {
    expect(parseNumberFilter('>3')).toEqual({ op: '>', value: 3 });
    expect(parseNumberFilter('>= 3')).toEqual({ op: '>=', value: 3 });
    expect(parseNumberFilter('<3')).toEqual({ op: '<', value: 3 });
    expect(parseNumberFilter('<=3')).toEqual({ op: '<=', value: 3 });
    expect(parseNumberFilter('=3')).toEqual({ op: '=', value: 3 });
    expect(parseNumberFilter('3')).toEqual({ op: '=', value: 3 });
    expect(parseNumberFilter('=0')).toEqual({ op: '=', value: 0 });
    expect(parseNumberFilter(' 2.5 ')).toEqual({ op: '=', value: 2.5 });
  });
  it('rejects everything else', () => {
    for (const bad of ['3x', '>>3', '-1', '>-1', ',5', '', '  ', 'abc']) expect(parseNumberFilter(bad), bad).toBeNull();
  });
});

describe('parseAgeFilter', () => {
  it('parses units and operators', () => {
    expect(parseAgeFilter('<10m')).toEqual({ op: '<', ms: 600_000 });
    expect(parseAgeFilter('> 1h')).toEqual({ op: '>', ms: 3_600_000 });
    expect(parseAgeFilter('<=2d')).toEqual({ op: '<=', ms: 172_800_000 });
    expect(parseAgeFilter('>=5s')).toEqual({ op: '>=', ms: 5000 });
    expect(parseAgeFilter('30s')).toEqual({ op: '<', ms: 30_000 });
    expect(parseAgeFilter('10M')).toEqual({ op: '<', ms: 600_000 });
  });
  it('rejects everything else', () => {
    for (const bad of ['<10', '1h30m', '=5m', '10min', '', ' ', 'm']) expect(parseAgeFilter(bad), bad).toBeNull();
  });
});

describe('isValidColumnFilter', () => {
  it('only flags non-blank unparsable number and age filters', () => {
    expect(isValidColumnFilter('pods', col('pods', 'restarts'), '3x')).toBe(false);
    expect(isValidColumnFilter('pods', col('pods', 'restarts'), '>3')).toBe(true);
    expect(isValidColumnFilter('pods', col('pods', 'restarts'), '  ')).toBe(true);
    expect(isValidColumnFilter('pods', col('pods', 'age'), '<10')).toBe(false);
    expect(isValidColumnFilter('pods', col('pods', 'age'), '<10m')).toBe(true);
    expect(isValidColumnFilter('pods', col('pods', 'name'), '<<<')).toBe(true);
    expect(isValidColumnFilter('pods', col('pods', 'status'), 'zzz')).toBe(true);
  });
});

describe('compileColumnFilters', () => {
  const columns = columnsFor('pods', null);
  const pods = [
    row('pods', 'api-1', { status: 'Running', restarts: 5, node: 'n1', age: ago(5 * 60_000) }),
    row('pods', 'api-2', { status: 'Pending', restarts: 0, age: ago(2 * 3_600_000) }, {}, 'blue'),
    row('pods', 'db-1', { status: 'Running', restarts: 1, node: 'n2', age: 'garbage' }),
  ];
  const run = (filters: Record<string, string> | undefined, now = NOW, rows = pods) =>
    rows.filter(compileColumnFilters('pods', columns, filters, now)).map(r => r.ref.name);

  it('matches everything without filters, blank, invalid and unknown keys', () => {
    expect(run(undefined)).toHaveLength(3);
    expect(run({})).toHaveLength(3);
    expect(run({ name: '  ' })).toHaveLength(3);
    expect(run({ restarts: '3x' })).toHaveLength(3);
    expect(run({ nope: 'x', cpu: 'x' })).toHaveLength(3);
  });
  it('text: case-insensitive contains, empty cell never matches', () => {
    expect(run({ name: 'API' })).toEqual(['api-1', 'api-2']);
    expect(run({ name: '1' })).toEqual(['api-1', 'db-1']);
    expect(run({ name: '!api' })).toEqual([]);
  });
  it('select: exact, empty option, blank = all', () => {
    expect(run({ status: 'Running' })).toEqual(['api-1', 'db-1']);
    expect(run({ status: 'running' })).toEqual([]);
    expect(run({ status: '' })).toHaveLength(3);
    expect(run({ node: EMPTY_VALUE })).toEqual(['api-2']);
    expect(run({ namespace: 'blue' })).toEqual(['api-2']);
  });
  it('number', () => {
    expect(run({ restarts: '>0' })).toEqual(['api-1', 'db-1']);
    expect(run({ restarts: '0' })).toEqual(['api-2']);
    expect(run({ restarts: '<=1' })).toEqual(['api-2', 'db-1']);
    expect(run({ restarts: '>2' }, NOW, [row('pods', 'x')])).toEqual([]);
  });
  it('age: younger/older, unreadable never matches, future is age 0, now 0 inactive', () => {
    expect(run({ age: '<10m' })).toEqual(['api-1']);
    expect(run({ age: '>1h' })).toEqual(['api-2']);
    expect(run({ age: '<10m' }, 0)).toHaveLength(3);
    const future = row('pods', 'f', { age: new Date(NOW + 60_000).toISOString() });
    expect(run({ age: '<1s' }, NOW, [future])).toEqual(['f']);
    expect(run({ age: '>1s' }, NOW, [future])).toEqual([]);
  });
  it('ANDs filters', () => {
    expect(run({ status: 'Running', name: 'db' })).toEqual(['db-1']);
    expect(run({ status: 'Pending', name: 'db' })).toEqual([]);
  });
  it('ignores keys not in columns', () => {
    const ns = compileColumnFilters('pods', columnsFor('pods', 'shop'), { namespace: 'blue' }, NOW);
    expect(pods.filter(ns)).toHaveLength(3);
  });
});

describe('columnValues', () => {
  const rows = [row('pods', 'a', { status: 'Running' }), row('pods', 'b', { status: 'Pending' }), row('pods', 'c', { status: 'Running' }), row('pods', 'd', { status: '—' })];
  it('is unique, sorted, with (ohne) last', () => {
    expect(columnValues('pods', rows, 'status')).toEqual(['Pending', 'Running', EMPTY_VALUE]);
  });
  it('omits (ohne) when nothing is empty', () => {
    expect(columnValues('pods', rows.slice(0, 3), 'status')).toEqual(['Pending', 'Running']);
  });
  it('keeps the selected value', () => {
    expect(columnValues('pods', rows.slice(0, 3), 'status', 'Evicted')).toEqual(['Evicted', 'Pending', 'Running']);
    expect(columnValues('pods', rows.slice(0, 3), 'status', '  ')).toEqual(['Pending', 'Running']);
    expect(columnValues('pods', rows, 'status', EMPTY_VALUE)).toEqual(['Pending', 'Running', EMPTY_VALUE]);
  });
  it('splits node roles', () => {
    expect(columnValues('nodes', [row('nodes', 'n', { roles: 'control-plane,worker' })], 'roles')).toEqual(['control-plane', 'worker']);
  });
});

describe('GROUP_OPTIONS', () => {
  it('lists options per kind', () => {
    const summary = (kind: KubeKind) => GROUP_OPTIONS[kind].map(o => `${o.id}:${o.label}${o.allNamespacesOnly ? '*' : ''}`);
    expect(summary('pods')).toEqual(['namespace:Namespace*', 'node:Node', 'status:Status', 'owner:Owner']);
    for (const kind of ['deployments', 'statefulsets', 'daemonsets', 'jobs', 'cronjobs', 'services', 'ingresses'] as KubeKind[]) expect(summary(kind)).toEqual(['namespace:Namespace*']);
    expect(summary('nodes')).toEqual(['status:Status', 'roles:Rollen']);
    expect(summary('events')).toEqual(['namespace:Namespace*', 'type:Typ', 'reason:Grund', 'objectKind:Objekt-Art']);
  });
});

describe('groupKey', () => {
  it('derives keys', () => {
    expect(groupKey('pods', 'namespace', row('pods', 'a'))).toBe('shop');
    expect(groupKey('pods', 'node', row('pods', 'a', {}, { node: 'n1' }))).toBe('n1');
    expect(groupKey('pods', 'node', row('pods', 'a'))).toBe('');
    expect(groupKey('pods', 'status', row('pods', 'a', { status: 'Running' }))).toBe('Running');
    expect(groupKey('nodes', 'status', row('nodes', 'n', { status: 'Ready,SchedulingDisabled' }))).toBe('Ready,SchedulingDisabled');
    expect(groupKey('nodes', 'roles', row('nodes', 'n', { roles: 'control-plane,worker' }))).toBe('control-plane,worker');
    expect(groupKey('nodes', 'roles', row('nodes', 'n', { roles: '—' }))).toBe('');
    expect(groupKey('events', 'type', row('events', 'e', { type: 'Warning' }))).toBe('Warning');
    expect(groupKey('events', 'reason', row('events', 'e', { reason: 'BackOff' }))).toBe('BackOff');
  });
  it('owner label uses the kind name', () => {
    const owner = row('pods', 'a', {}, { owner: { kind: 'deployments', namespace: 'shop', name: 'api' } });
    expect(groupKey('pods', 'owner', owner)).toBe('Deployment api');
    expect(groupKey('pods', 'owner', row('pods', 'b'))).toBe('');
  });
  it('objectKind from involved, else from cells.object', () => {
    expect(groupKey('events', 'objectKind', row('events', 'e', { object: 'Pod/x' }, { involved: { kind: 'Node', name: 'n' } }))).toBe('Node');
    expect(groupKey('events', 'objectKind', row('events', 'e', { object: 'Pod/x' }))).toBe('Pod');
    expect(groupKey('events', 'objectKind', row('events', 'e'))).toBe('');
  });
  it('is empty for ids the kind does not have', () => {
    expect(groupKey('services', 'node', row('services', 's'))).toBe('');
  });
});

describe('groupRows', () => {
  const pods = [
    row('pods', 'a', {}, {}, 'b'), row('pods', 'b', {}, {}, 'a'), row('pods', 'c', {}, {}, 'b'),
    row('pods', 'd', {}, {}, null), row('pods', 'e', {}, {}, 'a'),
  ];
  it('returns every row unchanged without a usable groupBy', () => {
    const plain = pods.map(r => ({ type: 'row', row: r }));
    expect(groupRows(pods, 'pods', null, [])).toEqual(plain);
    expect(groupRows(pods, 'pods', 'roles', [])).toEqual(plain);
  });
  it('sorts groups by key, empty last, rows keep their order', () => {
    const items = groupRows(pods, 'pods', 'namespace', []);
    expect(items.map(i => i.type === 'group' ? `[${i.label} ${i.count}]` : i.row.ref.name)).toEqual(['[a 2]', 'b', 'e', '[b 2]', 'a', 'c', `[${EMPTY_VALUE} 1]`, 'd']);
    expect(items[6]).toEqual({ type: 'group', key: '', label: EMPTY_VALUE, count: 1, collapsed: false });
  });
  it('collapsed groups keep header and count but no rows', () => {
    const items = groupRows(pods, 'pods', 'namespace', ['b', '']);
    expect(items).toHaveLength(5);
    const groups = items.filter(i => i.type === 'group');
    expect(groups.map(g => g.collapsed)).toEqual([false, true, true]);
    expect(groups.map(g => g.count)).toEqual([2, 2, 1]);
  });
  it('a single group still gets a header; no rows gives nothing', () => {
    expect(groupRows([pods[0]], 'pods', 'namespace', [])).toHaveLength(2);
    expect(groupRows([], 'pods', 'namespace', [])).toEqual([]);
  });
});

describe('help texts', () => {
  it('exports the contract texts', () => {
    expect(FILTER_HELP).toHaveLength(4);
    expect(FILTER_KIND_LABEL).toEqual({ text: 'Text', select: 'Auswahl', number: 'Zahl', age: 'Alter' });
  });
});

describe('facetValues', () => {
  const rows = [
    row('pods', 'api-1', { status: 'Running' }, {}, 'shop'),
    row('pods', 'api-2', { status: 'Pending' }, {}, 'shop'),
    row('pods', 'db-1', { status: 'Running' }, {}, 'data'),
    row('pods', 'db-2', { status: 'Running' }, {}, 'data'),
  ];
  const all = () => true;
  const ns = col('pods', 'namespace');

  it('counts values under the other filters, own filter ignored', () => {
    expect(facetValues(rows, 'pods', ns, undefined, NOW, all)).toEqual([
      { value: 'data', label: 'data (2)', count: 2 }, { value: 'shop', label: 'shop (2)', count: 2 },
    ]);
    expect(facetValues(rows, 'pods', ns, { namespace: 'shop' }, NOW, all).map(o => o.count)).toEqual([2, 2]);
    expect(facetValues(rows, 'pods', ns, { name: 'api' }, NOW, all)).toEqual([{ value: 'shop', label: 'shop (2)', count: 2 }]);
  });
  it('keeps the own selected value with 0', () => {
    expect(facetValues(rows, 'pods', ns, { name: 'api', namespace: 'data' }, NOW, all)).toEqual([
      { value: 'data', label: 'data (0)', count: 0 }, { value: 'shop', label: 'shop (2)', count: 2 },
    ]);
  });
  it('shows counts in the label and (ohne) for empty cells', () => {
    const withEmpty = [...rows, row('pods', 'x', {}, {}, 'shop')];
    const result = facetValues(withEmpty, 'pods', col('pods', 'status'), undefined, NOW, all);
    expect(result.map(o => o.label)).toEqual(['Pending (1)', 'Running (3)', '(ohne) (1)']);
    expect(result[2].value).toBe(EMPTY_VALUE);
  });
  it('applies otherPredicate (chips and search)', () => {
    const result = facetValues(rows, 'pods', col('pods', 'status'), undefined, NOW, r => r.ref.name.startsWith('db'));
    expect(result).toEqual([{ value: 'Running', label: 'Running (2)', count: 2 }]);
  });
});
