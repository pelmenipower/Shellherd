import { compileSearch, EMPTY_FILTER, MAX_SEARCH_LENGTH, type KubeFilter } from '../../shared/kube-filter';
import { compileChips, knownChips } from '../../shared/kube-status';
import { KIND_COLUMNS, KIND_INFO, queryKey, refKey } from '../../shared/kubernetes';
import type { ColumnInfo, ClusterStatus, DockMode, KubeEvent, KubeKind, KubeProblem, KubeQuery, KubeRef, KubeRow, KubeTerminalMode, KubeViewSnapshot, NodeTile, UsageHistory } from '../../shared/kubernetes';

/** One drill-down level; `query` is the table to return to on back. */
export interface Crumb { label: string; query: KubeQuery; /** Search text of the table left behind; back restores it. */ text: string }

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
  /** Unix ms for time chips and ages; set only by 'tick'. 0 until the first tick. */
  now: number;
  sort: { key: string; descending: boolean } | null;
  selected: string | null;       // refKey
  /** Pods drilled into: container list instead of the pod table. */
  containersOf: KubeRow | null;
  container: string | null;
  dock: DockMode;
  dockOpen: boolean;
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
  | { type: 'clearFilter' }                 // text and chips of the current kind; no-op returns the same state
  | { type: 'tick'; now: number }
  | { type: 'sort'; key: string }
  | { type: 'select'; key: string | null }
  | { type: 'move'; delta: number }              // within visibleRows
  | { type: 'drill' }                             // Enter on the selected row
  | { type: 'back' }
  | { type: 'openQuery'; query: KubeQuery; crumb: string }   // push the current query as crumb, show `query`
  | { type: 'sortBy'; sort: { key: string; descending: boolean } | null }
  | { type: 'jump'; ref: KubeRef }                // from a problem or node tile
  | { type: 'dock'; mode: DockMode }
  | { type: 'toggleDock' }
  | { type: 'selectContainer'; name: string }
  | { type: 'restore'; snapshot: KubeViewSnapshot };

const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const MI = 1024 ** 2;
const GI = 1024 ** 3;

export function initialKubeView(namespace: string | null): KubeViewState {
  return {
    status: null, query: { kind: 'pods', namespace }, crumbs: [], rows: [], loading: true, trouble: null, pendingNamespace: true, filters: {}, now: 0, sort: null, selected: null,
    containersOf: null, container: null, dock: 'logs', dockOpen: false, nodes: [], problems: [], namespaces: [], usage: {},
  };
}

export function kubeViewReducer(state: KubeViewState, action: KubeViewAction): KubeViewState {
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
      return current.text === '' && current.chips.length === 0 ? state : changeFilter(state, EMPTY_FILTER);
    }
    case 'tick': return action.now === state.now ? state : keepSelection(state, { ...state, now: action.now }, 'rows');
    case 'sort': {
      const previous = state.sort?.key === action.key ? state.sort : null;
      return { ...state, sort: previous ? { key: action.key, descending: !previous.descending } : { key: action.key, descending: false } };
    }
    case 'select': return action.key === state.selected ? state : { ...state, selected: action.key, container: null };
    case 'openQuery': return withText(withQuery(state, action.query, [...state.crumbs, { label: action.crumb, query: state.query, text: filterOf(state).text }]), action.query.kind, '');
    case 'sortBy': return { ...state, sort: action.sort ?? defaultSort(state.query.kind) };
    case 'move': {
      const rows = visibleRows(state);
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
    case 'selectContainer': return { ...state, container: action.name };
    case 'restore': return restore(state, action.snapshot);
  }
}

/** Filter of the current kind (state.query.kind), EMPTY_FILTER if none. */
export function filterOf(state: KubeViewState): KubeFilter {
  return state.filters[state.query.kind] ?? EMPTY_FILTER;
}

export function isFiltered(filter: KubeFilter): boolean {
  return filter.text.trim() !== '' || filter.chips.length > 0;
}

/** Search and chips. The search part is memoised in compileSearch. */
export function compileFilter(kind: KubeKind, filter: KubeFilter, now: number): (row: KubeRow) => boolean {
  const search = compileSearch(kind, filter.text);
  if (filter.chips.length === 0) return search;
  const chips = compileChips(kind, filter.chips, now);
  return row => search(row) && chips(row);
}

/** state.rows matched by the search text only (input of chipCounts). */
export function searchedRows(state: KubeViewState): KubeRow[] {
  return state.rows.filter(compileSearch(state.query.kind, filterOf(state).text));
}

/** Columns of the current table; all-namespaces tables of namespaced kinds get a Namespace column after the name. */
export function columnsOf(state: KubeViewState): ColumnInfo[] {
  const { kind, namespace } = state.query;
  const columns = KIND_COLUMNS[kind];
  if (namespace !== null || !KIND_INFO[kind].namespaced) return columns;
  const at = columns.findIndex(column => column.key === 'name') + 1;
  return [...columns.slice(0, at), { key: 'namespace', label: 'Namespace' }, ...columns.slice(at)];
}

/** events: newest first; every other kind: arrival order. */
export function defaultSort(kind: KubeKind): { key: string; descending: boolean } | null {
  return kind === 'events' ? { key: 'last', descending: true } : null;
}

/** Visible rows: filter applied, then sort. Arrival order without a sort. */
export function visibleRows(state: KubeViewState): KubeRow[] {
  const rows = state.rows.filter(compileFilter(state.query.kind, filterOf(state), state.now));
  const sort = state.sort;
  const column = sort ? columnsOf(state).find(candidate => candidate.key === sort.key) : undefined;
  if (!sort || !column) return rows;
  const direction = sort.descending ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row, column) }))
    .sort((a, b) => compareValues(a.value, b.value, direction) || a.index - b.index)
    .map(entry => entry.row);
}

/** Only kinds with a non-blank text or chips; cut defensively so the vault schema never rejects it. */
export function snapshotOf(state: KubeViewState): KubeViewSnapshot {
  const filters: NonNullable<KubeViewSnapshot['filters']> = {};
  for (const kind of Object.keys(state.filters) as KubeKind[]) {
    const filter = state.filters[kind];
    if (!filter || !isFiltered(filter)) continue;
    const text = filter.text.trim() !== '' ? filter.text.slice(0, MAX_SEARCH_LENGTH) : undefined;
    const chips = filter.chips.length > 0 ? filter.chips.slice(0, 16) : undefined;
    filters[kind] = { ...(text !== undefined ? { text } : {}), ...(chips ? { chips } : {}) };
  }
  return {
    query: state.query,
    crumbs: state.crumbs.slice(-8).map(crumb => crumb.label.slice(0, 300)),
    ...(state.selected ? { selected: state.selected } : {}),
    dock: state.dock,
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
    case 'trouble': return queryKey(event.query) === queryKey(state.query) ? { ...state, trouble: event.message ?? null } : state;
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

/** Sets only the search text of `kind`, keeping its chips. */
function withText(state: KubeViewState, kind: KubeKind, text: string): KubeViewState {
  return withFilter(state, kind, { text, chips: state.filters[kind]?.chips ?? [] });
}

function changeFilter(state: KubeViewState, filter: KubeFilter): KubeViewState {
  return keepSelection(state, withFilter(state, state.query.kind, filter), 'filter');
}

/**
 * A selection that is no longer visible counts as deleted or hidden. 'rows': it moves to the row at the same visible
 * position, else the last one, else null. 'filter': it becomes null. A key that was never loaded stays.
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
  const index = visibleRows(previous).findIndex(row => refKey(row.ref) === selected);
  if (index === -1 || remaining.length === 0) return { ...next, selected: null, container: null };
  return { ...next, selected: refKey(remaining[Math.min(index, remaining.length - 1)].ref), container: null };
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
  const crumbs = (): Crumb[] => [...state.crumbs, { label: `${KIND_INFO[row.ref.kind].kind} ${row.ref.name}`, query: state.query, text: filterOf(state).text }];
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
  return withText(withQuery(state, crumb.query, state.crumbs.slice(0, -1)), crumb.query.kind, crumb.text);
}

/** The snapshot holds only crumb labels, so restored crumbs fall back to the pod table of the same namespace. */
function restore(state: KubeViewState, snapshot: KubeViewSnapshot): KubeViewState {
  const fallback: KubeQuery = { kind: 'pods', namespace: snapshot.query.namespace };
  const crumbs = snapshot.crumbs.map(label => ({ label, query: fallback, text: '' }));
  const filters: Partial<Record<KubeKind, KubeFilter>> = {};
  for (const kind of Object.keys(snapshot.filters ?? {}) as KubeKind[]) {
    const saved = snapshot.filters?.[kind];
    const text = (saved?.text ?? '').slice(0, MAX_SEARCH_LENGTH);
    const chips = limitChips(kind, saved?.chips ?? []);
    if (text.trim() !== '' || chips.length > 0) filters[kind] = { text, chips };
  }
  return { ...withQuery(state, snapshot.query, crumbs, snapshot.selected ?? null), dock: snapshot.dock, filters, sort: defaultSort(snapshot.query.kind) };
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
  return String(a).localeCompare(String(b)) * direction;
}

/** Container for the dock: the chosen one if the pod has it, else the pod's first container. */
export function dockContainer(podRow: KubeRow | null, chosen: string | null): string | null {
  if (chosen && podRow?.containers?.includes(chosen)) return chosen;
  return podRow?.containers?.[0] ?? null;
}

/** React key of the dock terminal: a reconnect (epoch) restarts log streams, a shell is never reopened by itself. */
export function dockTerminalKey(pod: string, container: string, mode: KubeTerminalMode, epoch: number): string {
  return mode === 'shell' ? `${pod}/${container}/shell` : `${pod}/${container}/${mode}/${epoch}`;
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
