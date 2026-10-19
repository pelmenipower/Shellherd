import { KIND_COLUMNS, KIND_INFO, queryKey, refKey } from '../../shared/kubernetes';
import type { ColumnInfo, ClusterStatus, DockMode, KubeEvent, KubeKind, KubeProblem, KubeQuery, KubeRef, KubeRow, KubeTerminalMode, KubeViewSnapshot, NodeTile, UsageHistory } from '../../shared/kubernetes';

/** One drill-down level; `query` is the table to return to on back. */
export interface Crumb { label: string; query: KubeQuery }

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
  filter: string;
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
  | { type: 'filter'; text: string }
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
    status: null, query: { kind: 'pods', namespace }, crumbs: [], rows: [], loading: true, trouble: null, pendingNamespace: true, filter: '', sort: null, selected: null,
    containersOf: null, container: null, dock: 'logs', dockOpen: false, nodes: [], problems: [], namespaces: [], usage: {},
  };
}

export function kubeViewReducer(state: KubeViewState, action: KubeViewAction): KubeViewState {
  switch (action.type) {
    case 'event': return applyEvent(state, action.event);
    case 'setKind': return { ...withQuery(state, { kind: action.kind, namespace: state.query.namespace }, []), filter: '', sort: null };
    case 'setNamespace': return withQuery(state, { kind: state.query.kind, namespace: action.namespace }, []);
    case 'filter': return { ...state, filter: action.text };
    case 'sort': {
      const previous = state.sort?.key === action.key ? state.sort : null;
      return { ...state, sort: previous ? { key: action.key, descending: !previous.descending } : { key: action.key, descending: false } };
    }
    case 'select': return action.key === state.selected ? state : { ...state, selected: action.key, container: null };
    case 'openQuery': return { ...withQuery(state, action.query, [...state.crumbs, { label: action.crumb, query: state.query }]), filter: '' };
    case 'sortBy': return { ...state, sort: action.sort };
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
      return { ...withQuery(state, { kind: action.ref.kind, namespace }, [], refKey(action.ref)), filter: '' };
    }
    case 'dock': return { ...state, dock: action.mode, dockOpen: true };
    case 'toggleDock': return { ...state, dockOpen: !state.dockOpen };
    case 'selectContainer': return { ...state, container: action.name };
    case 'restore': return restore(state, action.snapshot);
  }
}

/** Visible rows: filter applied, then sort. Arrival order without a sort. */
export function visibleRows(state: KubeViewState): KubeRow[] {
  const rows = state.rows.filter(row => matchesFilter(row, state.filter));
  const sort = state.sort;
  const column = sort ? KIND_COLUMNS[state.query.kind].find(candidate => candidate.key === sort.key) : undefined;
  if (!sort || !column) return rows;
  const direction = sort.descending ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row, column) }))
    .sort((a, b) => compareValues(a.value, b.value) * direction || a.index - b.index)
    .map(entry => entry.row);
}

/** Name contains the text, or `key=value` matches a label; case-insensitive. Empty matches everything. */
export function matchesFilter(row: KubeRow, filter: string): boolean {
  const text = filter.trim().toLowerCase();
  if (!text) return true;
  const equals = text.indexOf('=');
  if (equals === -1) return row.ref.name.toLowerCase().includes(text);
  const key = text.slice(0, equals).trim();
  const value = text.slice(equals + 1).trim();
  return Object.entries(row.labels).some(([labelKey, labelValue]) => labelKey.toLowerCase() === key && labelValue.toLowerCase() === value);
}

export function snapshotOf(state: KubeViewState): KubeViewSnapshot {
  return {
    query: state.query,
    crumbs: state.crumbs.map(crumb => crumb.label),
    ...(state.selected ? { selected: state.selected } : {}),
    dock: state.dock,
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
  if (!state.pendingNamespace || !status.namespace) return next;
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
  return keepSelection(state, { ...state, rows: [...byUid.values()], loading: false });
}

/** A deleted selection moves to the row at the same visible position, else the last one, else null. */
function keepSelection(previous: KubeViewState, next: KubeViewState): KubeViewState {
  const selected = previous.selected;
  if (selected === null) return next;
  const wasPresent = previous.rows.some(row => refKey(row.ref) === selected);
  const isPresent = next.rows.some(row => refKey(row.ref) === selected);
  if (!wasPresent || isPresent) return next;
  const index = visibleRows(previous).findIndex(row => refKey(row.ref) === selected);
  const remaining = visibleRows(next);
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
  const crumbs = (): Crumb[] => [...state.crumbs, { label: `${KIND_INFO[row.ref.kind].kind} ${row.ref.name}`, query: state.query }];
  if (row.ref.kind === 'nodes') {
    return withQuery(state, { kind: 'pods', namespace: null, selector: { node: row.ref.name } }, crumbs());
  }
  if (row.ref.kind === 'cronjobs') {
    const jobs = withQuery(state, { kind: 'jobs', namespace: row.ref.namespace ?? state.query.namespace }, crumbs());
    return { ...jobs, filter: row.ref.name };
  }
  if (row.ref.kind === 'events' || Object.keys(row.selector ?? {}).length === 0) return state;
  const query: KubeQuery = { kind: 'pods', namespace: row.ref.namespace ?? state.query.namespace, selector: { labels: { ...row.selector } } };
  return withQuery(state, query, crumbs());
}

function back(state: KubeViewState): KubeViewState {
  if (state.containersOf) return { ...state, containersOf: null, container: null };
  const crumb = state.crumbs[state.crumbs.length - 1];
  if (!crumb) return state;
  return withQuery(state, crumb.query, state.crumbs.slice(0, -1));
}

/** The snapshot holds only crumb labels, so restored crumbs fall back to the pod table of the same namespace. */
function restore(state: KubeViewState, snapshot: KubeViewSnapshot): KubeViewState {
  const fallback: KubeQuery = { kind: 'pods', namespace: snapshot.query.namespace };
  const crumbs = snapshot.crumbs.map(label => ({ label, query: fallback }));
  return { ...withQuery(state, snapshot.query, crumbs, snapshot.selected ?? null), dock: snapshot.dock, filter: '' };
}

type SortValue = number | string;

function sortValue(row: KubeRow, column: ColumnInfo): SortValue {
  const value = row.cells[column.key] ?? (column.key === 'name' ? row.ref.name : '');
  if (column.age) return typeof value === 'number' ? value : Date.parse(String(value));
  if (column.numeric || typeof value === 'number') return typeof value === 'number' ? value : Number(value);
  return String(value);
}

function compareValues(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') {
    const aMissing = Number.isNaN(a), bMissing = Number.isNaN(b);
    if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
    return a - b;
  }
  return String(a).localeCompare(String(b));
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
