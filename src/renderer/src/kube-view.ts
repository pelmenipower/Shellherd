import { errorText } from './error-text';
import { compareText } from '../../shared/format';
import { compileSearch, EMPTY_FILTER, MAX_SEARCH_LENGTH, type KubeFilter } from '../../shared/kube-filter';
import { compileChips, knownChips } from '../../shared/kube-status';
import { columnFilterKind, columnsFor, compileColumnFilters, groupKey, groupRows, GROUP_OPTIONS, type KubeGrouping, type TableItem } from './kube-columns';
import { KIND_COLUMNS, KIND_INFO, KUBE_KINDS, MAX_COLLAPSED, MAX_COLUMN_FILTER_LENGTH, MAX_COLUMN_FILTERS, MAX_GROUP_KEY_LENGTH, queryKey, refKey } from '../../shared/kubernetes';
import type { ColumnInfo, ClusterStatus, DockMode, GroupBy, KubeEvent, KubeKind, KubeProblem, KubeQuery, KubeRef, KubeRow, KubeTerminalMode, KubeTerminalTarget, KubeViewSnapshot, NodeTile, UsageHistory } from '../../shared/kubernetes';

type LogFormat = NonNullable<KubeTerminalTarget['format']>;

/** One drill-down level; `query` is the table to return to on back. */
export interface Crumb { label: string; query: KubeQuery; /** Search text of the table left behind; back restores it. */ text: string;
  /** Column filters of the table left behind; back restores them. Omitted when empty. */ columns?: Record<string, string> }

/** Renderer state of one cluster tab. Pure data; the reducer below is the only writer. */
export interface KubeViewState {
  status: ClusterStatus | null;
  query: KubeQuery;
  /** Breadcrumb of drill-downs; empty at the top level. */
  crumbs: Crumb[];
  rows: KubeRow[];               // rows of `query`, in arrival order
  loading: boolean;              // true until the first `rows` event for `query`
  /** Why `query` cannot load or stay live (RBAC, API errors); shown instead of "Lade …". */
  trouble: string | null;
  /** True until the view moved on its own: the cluster's default namespace may still replace the initial one. */
  pendingNamespace: boolean;
  /** Search text and chips per kind; a kind without an entry is unfiltered. */
  filters: Partial<Record<KubeKind, KubeFilter>>;
  /** Grouping per kind; a kind without an entry is not grouped. */
  groups: Partial<Record<KubeKind, KubeGrouping>>;
  /** Unix ms for time chips and ages; set only by 'tick'. 0 until the first tick. */
  now: number;
  sort: { key: string; descending: boolean } | null;
  selected: string | null;       // refKey
  /** Pods drilled into: container list instead of the pod table. */
  containersOf: KubeRow | null;
  container: string | null;
  dock: DockMode;
  dockOpen: boolean;
  /** How log streams are shown in the dock; part of the terminal key. */
  logFormat: LogFormat;
  nodes: NodeTile[];
  problems: KubeProblem[];
  namespaces: string[];
  usage: UsageHistory;
}

export type KubeViewAction =
  | { type: 'event'; event: KubeEvent }
  | { type: 'setKind'; kind: KubeKind }
  | { type: 'setNamespace'; namespace: string | null }
  | { type: 'search'; text: string }        // search text of the current kind, cut to MAX_SEARCH_LENGTH
  | { type: 'toggleChip'; id: string }      // unknown id for the current kind: state unchanged
  | { type: 'setChips'; ids: string[] }     // replaces all chips of the current kind
  | { type: 'clearFilter' }                 // text, chips and column filters of the current kind (grouping stays); no-op returns the same state
  | { type: 'setColumnFilter'; key: string; value: string }   // current kind
  | { type: 'setGroupBy'; groupBy: GroupBy | null }           // current kind
  | { type: 'toggleGroup'; key: string }                      // current kind
  | { type: 'tick'; now: number }
  | { type: 'sort'; key: string }
  | { type: 'select'; key: string | null }
  | { type: 'move'; delta: number }              // within navigableRows
  | { type: 'drill' }                             // Enter on the selected row
  | { type: 'back' }
  | { type: 'openQuery'; query: KubeQuery; crumb: string }   // push the current query as crumb, show `query`
  | { type: 'sortBy'; sort: { key: string; descending: boolean } | null }
  | { type: 'jump'; ref: KubeRef }                // from a problem or node tile
  | { type: 'dock'; mode: DockMode }
  | { type: 'toggleDock' }
  | { type: 'setLogFormat'; format: LogFormat }
  | { type: 'selectContainer'; name: string }
  | { type: 'restore'; snapshot: KubeViewSnapshot };

const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const MI = 1024 ** 2;
const GI = 1024 ** 3;

export function initialKubeView(namespace: string | null): KubeViewState {
  return {
    status: null, query: { kind: 'pods', namespace }, crumbs: [], rows: [], loading: true, trouble: null, pendingNamespace: true, filters: {}, groups: {}, now: 0, sort: null, selected: null,
    containersOf: null, container: null, dock: 'logs', dockOpen: false, logFormat: 'compact', nodes: [], problems: [], namespaces: [], usage: {},
  };
}

export function kubeViewReducer(state: KubeViewState, action: KubeViewAction): KubeViewState {
  return reveal(reduce(state, action));
}

function reduce(state: KubeViewState, action: KubeViewAction): KubeViewState {
  switch (action.type) {
    case 'event': return applyEvent(state, action.event);
    case 'setKind': return { ...withQuery(state, { kind: action.kind, namespace: state.query.namespace }, []), sort: defaultSort(action.kind) };
    case 'setNamespace': {
      const next = withQuery(state, { kind: state.query.kind, namespace: action.namespace }, []);
      return state.sort && !columnsOf(next).some(column => column.key === state.sort?.key) ? { ...next, sort: defaultSort(next.query.kind) } : next;
    }
    case 'search': {
      const text = action.text.slice(0, MAX_SEARCH_LENGTH);
      const current = filterOf(state);
      return text === current.text ? state : changeFilter(state, { ...current, text });
    }
    case 'toggleChip': {
      const kind = state.query.kind;
      if (knownChips(kind, [action.id]).length === 0) return state;
      const current = filterOf(state);
      const on = current.chips.includes(action.id);
      const ids = on ? current.chips.filter(id => id !== action.id) : [...current.chips, action.id];
      return changeFilter(state, { ...current, chips: limitChips(kind, ids) });
    }
    case 'setChips': {
      const current = filterOf(state);
      const chips = limitChips(state.query.kind, action.ids);
      return chips.length === current.chips.length && chips.every((id, index) => id === current.chips[index]) ? state : changeFilter(state, { ...current, chips });
    }
    case 'clearFilter': {
      const current = filterOf(state);
      return current.text === '' && current.chips.length === 0 && current.columns === undefined ? state : changeFilter(state, EMPTY_FILTER);
    }
    case 'setColumnFilter': return setColumnFilter(state, action.key, action.value);
    case 'setGroupBy': return setGroupBy(state, action.groupBy);
    case 'toggleGroup': return toggleGroup(state, action.key);
    case 'tick': return action.now === state.now ? state : keepSelection(state, { ...state, now: action.now }, 'rows');
    case 'sort': {
      const previous = state.sort?.key === action.key ? state.sort : null;
      return { ...state, sort: previous ? { key: action.key, descending: !previous.descending } : { key: action.key, descending: false } };
    }
    case 'select': return action.key === state.selected ? state : { ...state, selected: action.key, container: null };
    case 'openQuery': return withText(withQuery(state, action.query, [...state.crumbs, crumbOf(state, action.crumb)]), action.query.kind, '');
    case 'sortBy': return { ...state, sort: action.sort ?? defaultSort(state.query.kind) };
    case 'move': {
      const rows = navigableRows(state);
      if (rows.length === 0) return state;
      const current = rows.findIndex(row => refKey(row.ref) === state.selected);
      // Without a selection, +1 starts at the first row and -1 at the last.
      const from = current === -1 ? (action.delta > 0 ? -1 : rows.length) : current;
      const index = Math.min(rows.length - 1, Math.max(0, from + action.delta));
      const selected = refKey(rows[index].ref);
      return selected === state.selected ? state : { ...state, selected, container: null };
    }
    case 'drill': return drill(state);
    case 'back': return back(state);
    case 'jump': {
      const namespace = action.ref.namespace ?? (KIND_INFO[action.ref.kind].namespaced ? state.query.namespace : null);
      return withFilter(withQuery(state, { kind: action.ref.kind, namespace }, [], refKey(action.ref)), action.ref.kind, EMPTY_FILTER);
    }
    case 'dock': return { ...state, dock: action.mode, dockOpen: true };
    case 'toggleDock': return { ...state, dockOpen: !state.dockOpen };
    case 'setLogFormat': return action.format === state.logFormat ? state : { ...state, logFormat: action.format };
    case 'selectContainer': return { ...state, container: action.name };
    case 'restore': return restore(state, action.snapshot);
  }
}

/** Filter of the current kind (state.query.kind), EMPTY_FILTER if none. */
export function filterOf(state: KubeViewState): KubeFilter {
  return state.filters[state.query.kind] ?? EMPTY_FILTER;
}

/** Filter of the current kind with only the column filters that apply to columnsOf(state) (B7). */
export function activeFilter(state: KubeViewState): KubeFilter {
  const filter = filterOf(state);
  if (!filter.columns) return filter;
  const columns = columnsOf(state);
  const kind = state.query.kind;
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(filter.columns)) {
    const column = columns.find(candidate => candidate.key === key);
    if (column && columnFilterKind(kind, column) !== 'none') kept[key] = value;
  }
  const count = Object.keys(kept).length;
  if (count === Object.keys(filter.columns).length) return filter;
  return { text: filter.text, chips: filter.chips, ...(count > 0 ? { columns: kept } : {}) };
}

/** Grouping of the current kind, or null when absent, unknown for the kind, or namespace-only while a namespace is selected (B7). */
export function activeGrouping(state: KubeViewState): KubeGrouping | null {
  const { kind, namespace } = state.query;
  const grouping = state.groups[kind];
  if (!grouping) return null;
  const option = GROUP_OPTIONS[kind].find(candidate => candidate.id === grouping.by);
  if (!option || (option.allNamespacesOnly && namespace !== null)) return null;
  return grouping;
}

export function isFiltered(filter: KubeFilter): boolean {
  return filter.text.trim() !== '' || filter.chips.length > 0 || Object.values(filter.columns ?? {}).some(value => value.trim() !== '');
}

/** Search, chips and column filters over `columns`. The search part is memoised in compileSearch. */
export function compileFilter(kind: KubeKind, filter: KubeFilter, now: number, columns: readonly ColumnInfo[] = KIND_COLUMNS[kind]): (row: KubeRow) => boolean {
  const predicates = [compileSearch(kind, filter.text)];
  if (filter.columns) predicates.push(compileColumnFilters(kind, columns, filter.columns, now));
  if (filter.chips.length > 0) predicates.push(compileChips(kind, filter.chips, now));
  return predicates.length === 1 ? predicates[0] : row => predicates.every(predicate => predicate(row));
}

/** state.rows matched by search text AND column filters, chips ignored (input of chipCounts). */
export function searchedRows(state: KubeViewState): KubeRow[] {
  const { text, columns } = activeFilter(state);
  return state.rows.filter(compileFilter(state.query.kind, { text, chips: [], ...(columns ? { columns } : {}) }, state.now, columnsOf(state)));
}

/** Columns of the current table; all-namespaces tables of namespaced kinds get a Namespace column after the name. */
export function columnsOf(state: KubeViewState): ColumnInfo[] {
  return columnsFor(state.query.kind, state.query.namespace);
}

/** events: newest first; every other kind: arrival order. */
export function defaultSort(kind: KubeKind): { key: string; descending: boolean } | null {
  return kind === 'events' ? { key: 'last', descending: true } : null;
}

/** Visible rows: filter applied, then sort. Arrival order without a sort. */
export function visibleRows(state: KubeViewState): KubeRow[] {
  const rows = state.rows.filter(compileFilter(state.query.kind, activeFilter(state), state.now, columnsOf(state)));
  const sort = state.sort;
  const column = sort ? columnsOf(state).find(candidate => candidate.key === sort.key) : undefined;
  if (!sort || !column) return rows;
  const direction = sort.descending ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row, column) }))
    .sort((a, b) => compareValues(a.value, b.value, direction) || a.index - b.index)
    .map(entry => entry.row);
}

/** Rows as displayed: grouped, collapsed groups folded away. */
export function tableItems(state: KubeViewState, rows: KubeRow[] = visibleRows(state)): TableItem[] {
  const grouping = activeGrouping(state);
  return groupRows(rows, state.query.kind, grouping?.by ?? null, grouping?.collapsed ?? []);
}

/** Resource rows of tableItems in display order; rows of collapsed groups are not in it. */
export function navigableRows(state: KubeViewState): KubeRow[] {
  const rows: KubeRow[] = [];
  for (const item of tableItems(state)) if (item.type === 'row') rows.push(item.row);
  return rows;
}

/** Only kinds with content; cut defensively so the vault schema never rejects it. Raw values, inactive ones included. */
export function snapshotOf(state: KubeViewState): KubeViewSnapshot {
  const filters: NonNullable<KubeViewSnapshot['filters']> = {};
  for (const kind of KUBE_KINDS) {
    const filter = state.filters[kind];
    const grouping = state.groups[kind];
    const text = filter && filter.text.trim() !== '' ? filter.text.slice(0, MAX_SEARCH_LENGTH) : undefined;
    const chips = filter && filter.chips.length > 0 ? filter.chips.slice(0, 16) : undefined;
    const columns = filter?.columns ? cleanColumns(Object.entries(filter.columns)) : undefined;
    const collapsed = grouping ? grouping.collapsed.filter(key => key.length <= MAX_GROUP_KEY_LENGTH).slice(-MAX_COLLAPSED) : [];
    if (text === undefined && !chips && !columns && !grouping) continue;
    filters[kind] = {
      ...(text !== undefined ? { text } : {}), ...(chips ? { chips } : {}), ...(columns ? { columns } : {}),
      ...(grouping ? { groupBy: grouping.by } : {}), ...(collapsed.length > 0 ? { collapsed } : {}),
    };
  }
  return {
    query: state.query,
    crumbs: state.crumbs.slice(-8).map(crumb => crumb.label.slice(0, 300)),
    ...(state.selected ? { selected: state.selected } : {}),
    dock: state.dock,
    ...(state.logFormat === 'raw' ? { logFormat: 'raw' as const } : {}),
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
  };
}

/** '41s', '12m', '3h', '9d'. An unparsable timestamp gives '-'. */
export function formatAge(iso: string, now: number): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '-';
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** CPU in millicores ('250m'); memory in bytes ('1.2Gi', '512Mi', '64Ki'). */
export function formatUsage(kind: 'cpu' | 'memory', value: number): string {
  if (kind === 'cpu') return `${Math.round(value)}m`;
  if (value >= GI) return `${Number((value / GI).toFixed(1))}Gi`;
  if (value >= MI) return `${Math.round(value / MI)}Mi`;
  return `${Math.round(value / 1024)}Ki`;
}

/** One block character per value, scaled between min and max; a flat series gives the lowest block. */
export function sparkline(values: number[]): string {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const range = Math.max(...values) - min;
  return values.map(value => SPARK[range === 0 ? 0 : Math.round((value - min) / range * (SPARK.length - 1))]).join('');
}

function applyEvent(state: KubeViewState, event: KubeEvent): KubeViewState {
  switch (event.type) {
    case 'status': return applyStatus(state, event.status);
    case 'overview': return { ...state, nodes: event.nodes, problems: event.problems, namespaces: event.namespaces };
    case 'usage': return { ...state, usage: event.pods };
    case 'rows': return applyRows(state, event);
    case 'trouble': return queryKey(event.query) === queryKey(state.query) ? { ...state, trouble: event.error ? errorText(event.error) : null } : state;
  }
}

/** The first status that names a default namespace replaces the initial one, unless the view has moved on. */
function applyStatus(state: KubeViewState, status: ClusterStatus): KubeViewState {
  const next = { ...state, status };
  if (!state.pendingNamespace) return next;
  // Ready without a configured namespace: keep the initial one (all namespaces).
  if (!status.namespace) return status.state === 'ready' ? { ...next, pendingNamespace: false } : next;
  const done = { ...next, pendingNamespace: false };
  if (state.query.namespace === status.namespace) return done;
  return { ...done, query: { ...state.query, namespace: status.namespace }, rows: [], loading: true, trouble: null };
}

function applyRows(state: KubeViewState, event: Extract<KubeEvent, { type: 'rows' }>): KubeViewState {
  if (queryKey(event.query) !== queryKey(state.query)) return state;
  const deleted = new Set(event.deletes);
  // A Map keeps arrival order: replaced rows stay in place, new rows are appended.
  const byUid = new Map<string, KubeRow>();
  for (const row of event.reset ? [] : state.rows) if (!deleted.has(row.uid)) byUid.set(row.uid, row);
  for (const row of event.upserts) byUid.set(row.uid, row);
  return keepSelection(state, { ...state, rows: [...byUid.values()], loading: false }, 'rows');
}

/** Chips of one kind in CHIPS order, at most 8. */
function limitChips(kind: KubeKind, ids: readonly string[]): string[] {
  return knownChips(kind, ids).slice(0, 8);
}

function withFilter(state: KubeViewState, kind: KubeKind, filter: KubeFilter): KubeViewState {
  return { ...state, filters: { ...state.filters, [kind]: filter } };
}

/** Sets the search text and column filters of `kind`, keeping its chips. */
function withText(state: KubeViewState, kind: KubeKind, text: string, columns?: Record<string, string>): KubeViewState {
  return withFilter(state, kind, { text, chips: state.filters[kind]?.chips ?? [], ...(columns && Object.keys(columns).length > 0 ? { columns } : {}) });
}

/** Non-blank values cut to the schema limits, at most MAX_COLUMN_FILTERS; undefined when nothing is left. */
function cleanColumns(entries: Array<[string, string]>): Record<string, string> | undefined {
  const kept = entries.filter(([, value]) => value.trim() !== '').map(([key, value]): [string, string] => [key, value.slice(0, MAX_COLUMN_FILTER_LENGTH)]).slice(0, MAX_COLUMN_FILTERS);
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

function crumbOf(state: KubeViewState, label: string): Crumb {
  const { text, columns } = filterOf(state);
  return { label, query: state.query, text, ...(columns ? { columns } : {}) };
}

function setColumnFilter(state: KubeViewState, key: string, value: string): KubeViewState {
  const kind = state.query.kind;
  const column = columnsOf(state).find(candidate => candidate.key === key);
  if (!column || columnFilterKind(kind, column) === 'none') return state;
  const current = filterOf(state);
  const old = current.columns?.[key];
  const text = value.slice(0, MAX_COLUMN_FILTER_LENGTH);
  let columns: Record<string, string> | undefined;
  if (text.trim() === '') {
    if (old === undefined) return state;
    const rest = { ...current.columns };
    delete rest[key];
    columns = Object.keys(rest).length > 0 ? rest : undefined;
  } else {
    if (text === old) return state;
    columns = { ...current.columns, [key]: text };
  }
  return changeFilter(state, { text: current.text, chips: current.chips, ...(columns ? { columns } : {}) });
}

function withGroup(state: KubeViewState, kind: KubeKind, grouping: KubeGrouping | undefined): KubeViewState {
  const groups = { ...state.groups };
  if (grouping) groups[kind] = grouping;
  else delete groups[kind];
  return { ...state, groups };
}

function setGroupBy(state: KubeViewState, groupBy: GroupBy | null): KubeViewState {
  const { kind, namespace } = state.query;
  const current = state.groups[kind];
  if (groupBy === null) return current ? withGroup(state, kind, undefined) : state;
  const option = GROUP_OPTIONS[kind].find(candidate => candidate.id === groupBy);
  if (!option || (option.allNamespacesOnly && namespace !== null)) return state;
  if (current?.by === groupBy) return state;
  return withGroup(state, kind, { by: groupBy, collapsed: [] });
}

function toggleGroup(state: KubeViewState, key: string): KubeViewState {
  const grouping = activeGrouping(state);
  if (!grouping || key.length > MAX_GROUP_KEY_LENGTH) return state;
  const kind = state.query.kind;
  if (grouping.collapsed.includes(key)) return withGroup(state, kind, { by: grouping.by, collapsed: grouping.collapsed.filter(candidate => candidate !== key) });
  const next = withGroup(state, kind, { by: grouping.by, collapsed: [...grouping.collapsed, key].slice(-MAX_COLLAPSED) });
  // The selected row would be hidden (and reveal would reopen the group): drop the selection instead.
  const selected = state.selected === null ? undefined : visibleRows(state).find(row => refKey(row.ref) === state.selected);
  return selected && groupKey(kind, grouping.by, selected) === key ? { ...next, selected: null, container: null } : next;
}

/** The selected row's group is never collapsed: removes its key from `collapsed`; same state when nothing changes. */
function reveal(state: KubeViewState): KubeViewState {
  const grouping = activeGrouping(state);
  if (!grouping || grouping.collapsed.length === 0 || state.selected === null) return state;
  const row = state.rows.find(candidate => refKey(candidate.ref) === state.selected);
  if (!row) return state;
  const key = groupKey(state.query.kind, grouping.by, row);
  if (!grouping.collapsed.includes(key)) return state;
  return withGroup(state, state.query.kind, { by: grouping.by, collapsed: grouping.collapsed.filter(candidate => candidate !== key) });
}

function changeFilter(state: KubeViewState, filter: KubeFilter): KubeViewState {
  return keepSelection(state, withFilter(state, state.query.kind, filter), 'filter');
}

/**
 * A selection that is no longer visible counts as deleted or hidden. 'rows': it moves to the row at the same display
 * position (grouped order), else the last one, else null. 'filter': it becomes null. A key that was never loaded stays.
 */
function keepSelection(previous: KubeViewState, next: KubeViewState, mode: 'rows' | 'filter'): KubeViewState {
  const selected = next.selected;
  if (selected === null) return next;
  // Container mode: the pod table is hidden, and moving the selection would reset the dock's container.
  if (next.containersOf !== null) return next;
  const remaining = visibleRows(next);
  if (remaining.some(row => refKey(row.ref) === selected)) return next;
  const known = (state: KubeViewState): boolean => state.rows.some(row => refKey(row.ref) === selected);
  if (!known(next) && !known(previous)) return next;
  if (mode === 'filter') return { ...next, selected: null, container: null };
  const index = navigableRows(previous).findIndex(row => refKey(row.ref) === selected);
  const displayed = navigableRows(next);
  if (index === -1 || displayed.length === 0) return { ...next, selected: null, container: null };
  return { ...next, selected: refKey(displayed[Math.min(index, displayed.length - 1)].ref), container: null };
}

/** Moves to another table: rows are cleared until the first rows event for the new query arrives. */
function withQuery(state: KubeViewState, query: KubeQuery, crumbs: Crumb[], selected: string | null = null): KubeViewState {
  return { ...state, query, crumbs, rows: [], loading: true, trouble: null, pendingNamespace: false, selected, containersOf: null, container: null };
}

function drill(state: KubeViewState): KubeViewState {
  if (state.containersOf) return state;
  const row = visibleRows(state).find(candidate => refKey(candidate.ref) === state.selected);
  if (!row) return state;
  if (row.ref.kind === 'pods') return { ...state, containersOf: row, container: row.containers?.[0] ?? null };
  const crumbs = (): Crumb[] => [...state.crumbs, crumbOf(state, `${KIND_INFO[row.ref.kind].kind} ${row.ref.name}`)];
  if (row.ref.kind === 'nodes') {
    return withText(withQuery(state, { kind: 'pods', namespace: null, selector: { node: row.ref.name } }, crumbs()), 'pods', '');
  }
  if (row.ref.kind === 'cronjobs') {
    return withText(withQuery(state, { kind: 'jobs', namespace: row.ref.namespace ?? state.query.namespace }, crumbs()), 'jobs', `owner:${row.ref.name}`);
  }
  if (row.ref.kind === 'events' || Object.keys(row.selector ?? {}).length === 0) return state;
  const query: KubeQuery = { kind: 'pods', namespace: row.ref.namespace ?? state.query.namespace, selector: { labels: { ...row.selector } } };
  return withText(withQuery(state, query, crumbs()), 'pods', '');
}

function back(state: KubeViewState): KubeViewState {
  if (state.containersOf) return { ...state, containersOf: null, container: null };
  const crumb = state.crumbs[state.crumbs.length - 1];
  if (!crumb) return state;
  return withText(withQuery(state, crumb.query, state.crumbs.slice(0, -1)), crumb.query.kind, crumb.text, crumb.columns);
}

/** The snapshot holds only crumb labels, so restored crumbs fall back to the pod table of the same namespace. */
function restore(state: KubeViewState, snapshot: KubeViewSnapshot): KubeViewState {
  const fallback: KubeQuery = { kind: 'pods', namespace: snapshot.query.namespace };
  const crumbs = snapshot.crumbs.map(label => ({ label, query: fallback, text: '' }));
  const filters: Partial<Record<KubeKind, KubeFilter>> = {};
  const groups: Partial<Record<KubeKind, KubeGrouping>> = {};
  for (const kind of Object.keys(snapshot.filters ?? {}) as KubeKind[]) {
    const saved = snapshot.filters?.[kind];
    const text = (saved?.text ?? '').slice(0, MAX_SEARCH_LENGTH);
    const chips = limitChips(kind, saved?.chips ?? []);
    // columnsFor(kind, null) includes 'namespace': the filter just stays inactive while a namespace is selected.
    const known = columnsFor(kind, null).filter(column => columnFilterKind(kind, column) !== 'none').map(column => column.key);
    const columns = cleanColumns(Object.entries(saved?.columns ?? {}).filter(([key]) => known.includes(key)));
    if (text.trim() !== '' || chips.length > 0 || columns) filters[kind] = { text, chips, ...(columns ? { columns } : {}) };
    const by = saved?.groupBy;
    if (by && GROUP_OPTIONS[kind].some(option => option.id === by)) {
      groups[kind] = { by, collapsed: [...new Set(saved?.collapsed ?? [])].filter(key => key.length <= MAX_GROUP_KEY_LENGTH).slice(0, MAX_COLLAPSED) };
    }
  }
  return { ...withQuery(state, snapshot.query, crumbs, snapshot.selected ?? null), dock: snapshot.dock, logFormat: snapshot.logFormat === 'raw' ? 'raw' : 'compact', filters, groups, sort: defaultSort(snapshot.query.kind) };
}

type SortValue = number | string;

function sortValue(row: KubeRow, column: ColumnInfo): SortValue {
  if (column.key === 'namespace') return row.ref.namespace ?? '';
  const value = row.cells[column.key] ?? (column.key === 'name' ? row.ref.name : '');
  if (column.age) return typeof value === 'number' ? value : Date.parse(String(value));
  if (column.numeric || typeof value === 'number') return typeof value === 'number' ? value : Number(value);
  return String(value);
}

/** `direction` (1 or -1) applies to real comparisons only; missing numbers always sort last. */
function compareValues(a: SortValue, b: SortValue, direction: 1 | -1): number {
  if (typeof a === 'number' && typeof b === 'number') {
    const aMissing = Number.isNaN(a), bMissing = Number.isNaN(b);
    if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
    return (a - b) * direction;
  }
  return compareText(String(a), String(b)) * direction;
}

/** Container for the dock: the chosen one if the pod has it, else the pod's first container. */
export function dockContainer(podRow: KubeRow | null, chosen: string | null): string | null {
  if (chosen && podRow?.containers?.includes(chosen)) return chosen;
  return podRow?.containers?.[0] ?? null;
}

/** React key of the dock terminal: a reconnect (epoch) or a format change restarts log streams, a shell is never reopened by itself. */
export function dockTerminalKey(pod: string, container: string, mode: KubeTerminalMode, epoch: number, format: LogFormat = 'compact'): string {
  return mode === 'shell' ? `${pod}/${container}/shell` : `${pod}/${container}/${mode}/${format}/${epoch}`;
}

/** The pod the dock follows (drilled-into pod, else the selected pod row), its container and the shell arm key. */
export function dockSelection(containersOf: KubeRow | null, selectedRow: KubeRow | null, chosen: string | null): { podRow: KubeRow | null; container: string | null; armKey: string | null } {
  const podRow = containersOf ?? (selectedRow?.ref.kind === 'pods' ? selectedRow : null);
  const container = dockContainer(podRow, chosen);
  return { podRow, container, armKey: podRow && container ? `${refKey(podRow.ref)}/${container}` : null };
}

/** A shell arm only holds while the dock still shows the key it was armed for; once the key moves away it is gone for good. */
export function settleArm(armedFor: string | null, armKey: string | null): string | null {
  return armedFor !== null && armedFor === armKey ? armedFor : null;
}
