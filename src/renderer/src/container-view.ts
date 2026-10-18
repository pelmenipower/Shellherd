// Pure reducer of the container view: inventory, per-kind filters/chips/sort/grouping, selection and dock.
import type { ContainerDockMode, ContainerInventory, ContainerRuntime, InventoryKind, InventoryRow } from '../../shared/containers';
import { LOCAL_CONTAINER_HOST } from '../../shared/containers';
import { columnsFor, compileColumnFilters, groupOptionsFor, groupRows, type ContainerColumn, type GroupId, type TableItem } from './container-columns';
import { compileChips, knownChips } from './container-status';

export interface KindView {
  filters: Record<string, string>; chips: string[];
  sort: { key: string; dir: 'asc' | 'desc' } | null;
  groupBy: GroupId | null; collapsed: string[];
}
export interface ContainerViewState {
  inventory: ContainerInventory | null;
  /** Runtime asked for; null = default (first found). */
  requestedRuntime: ContainerRuntime | null;
  kind: InventoryKind;
  views: Record<InventoryKind, KindView>;
  /** uid of the selected row. */
  selected: string | null;
  dock: ContainerDockMode; dockOpen: boolean;
  /** uid the shell was opened for; any other selection shows the button again. */
  armed: string | null;
  /** Restarts log streams (reloadDock). */
  epoch: number;
  loading: boolean; error: string | null;
  /** uids with an action in flight. */
  busy: string[];
  now: number;
}

export type ContainerViewAction =
  /** quiet: a background poll; it does not show "lade …" once an inventory is there. */
  | { type: 'loading'; quiet?: boolean }
  | { type: 'setInventory'; inventory: ContainerInventory }
  | { type: 'fail'; message: string }
  | { type: 'setRuntime'; runtime: ContainerRuntime }
  | { type: 'setKind'; kind: InventoryKind }
  | { type: 'setColumnFilter'; key: string; value: string }
  | { type: 'toggleChip'; id: string }
  | { type: 'setChips'; ids: string[] }
  | { type: 'clearFilter' }
  | { type: 'setGroupBy'; groupBy: GroupId | null }
  | { type: 'toggleGroup'; key: string }
  | { type: 'sort'; key: string; dir?: 'asc' | 'desc' }
  | { type: 'clearSort' }
  | { type: 'select'; uid: string | null }
  | { type: 'move'; delta: 1 | -1 }
  | { type: 'dock'; mode: ContainerDockMode }
  | { type: 'toggleDock' }
  | { type: 'arm' }
  | { type: 'reloadDock' }
  | { type: 'busy'; uid: string; busy: boolean }
  | { type: 'tick'; now: number }
  | { type: 'showContainersWith'; key: 'project' | 'image' | 'networks'; value: string };

const MAX_FILTER_LENGTH = 200;
const MAX_CHIPS = 8;
const MAX_COLLAPSED = 64;
const MAX_KEY_LENGTH = 300;

const emptyView = (): KindView => ({ filters: {}, chips: [], sort: null, groupBy: null, collapsed: [] });

export function initialContainerViewState(now: number): ContainerViewState {
  return {
    inventory: null, requestedRuntime: null, kind: 'containers',
    views: { containers: emptyView(), images: emptyView(), volumes: emptyView(), networks: emptyView() },
    selected: null, dock: 'logs', dockOpen: true, armed: null, epoch: 0, loading: true, error: null, busy: [], now,
  };
}

export function containerViewReducer(state: ContainerViewState, action: ContainerViewAction): ContainerViewState {
  const next = reduce(state, action);
  if (next.armed === null) return next;
  // Any change of the selection drops the shell arm; so does a poll that shows the container gone or not running,
  // otherwise the shell would reopen by itself when it runs again.
  const row = next.inventory?.rows.containers.find(candidate => candidate.uid === next.armed);
  return next.selected !== state.selected || row?.state !== 'running' ? { ...next, armed: null } : next;
}

function reduce(state: ContainerViewState, action: ContainerViewAction): ContainerViewState {
  switch (action.type) {
    case 'loading': return state.loading || (action.quiet && state.inventory !== null) ? state : { ...state, loading: true };
    case 'setInventory': {
      const runtimeChanged = state.inventory !== null && state.inventory.runtime !== action.inventory.runtime;
      const next: ContainerViewState = { ...state, inventory: action.inventory, loading: false, error: null, ...(runtimeChanged ? { selected: null } : {}) };
      return runtimeChanged ? next : keepSelection(state, next, 'rows');
    }
    case 'fail': return { ...state, loading: false, error: action.message };
    case 'setRuntime': return { ...state, requestedRuntime: action.runtime, loading: true, selected: null };
    case 'setKind': {
      if (action.kind === state.kind) return state;
      const dock = action.kind !== 'containers' && (state.dock === 'logs' || state.dock === 'shell') ? 'inspect' : state.dock;
      return { ...state, kind: action.kind, selected: null, dock };
    }
    case 'setColumnFilter': return setColumnFilter(state, action.key, action.value);
    case 'toggleChip': {
      if (knownChips(state.kind, [action.id]).length === 0) return state;
      const current = state.views[state.kind].chips;
      const ids = current.includes(action.id) ? current.filter(id => id !== action.id) : [...current, action.id];
      return changeView(state, { chips: knownChips(state.kind, ids).slice(0, MAX_CHIPS) });
    }
    case 'setChips': {
      const chips = knownChips(state.kind, action.ids).slice(0, MAX_CHIPS);
      const current = state.views[state.kind].chips;
      return chips.length === current.length && chips.every((id, index) => id === current[index]) ? state : changeView(state, { chips });
    }
    case 'clearFilter': {
      const view = state.views[state.kind];
      return Object.keys(view.filters).length === 0 && view.chips.length === 0 ? state : changeView(state, { filters: {}, chips: [] });
    }
    case 'setGroupBy': return setGroupBy(state, action.groupBy);
    case 'toggleGroup': return toggleGroup(state, action.key);
    case 'sort': return sortBy(state, action.key, action.dir);
    case 'clearSort': return state.views[state.kind].sort === null ? state : patchView(state, state.kind, { sort: null });
    case 'select': return action.uid === state.selected ? state : { ...state, selected: action.uid };
    case 'move': {
      const rows = navigableRows(state);
      if (rows.length === 0) return state;
      const current = rows.findIndex(row => row.uid === state.selected);
      // Without a selection, +1 starts at the first row and -1 at the last.
      const from = current === -1 ? (action.delta > 0 ? -1 : rows.length) : current;
      const selected = rows[Math.min(rows.length - 1, Math.max(0, from + action.delta))].uid;
      return selected === state.selected ? state : { ...state, selected };
    }
    case 'dock':
      if (state.kind !== 'containers' && action.mode !== 'inspect') return state;
      return { ...state, dock: action.mode, dockOpen: true };
    case 'toggleDock': return { ...state, dockOpen: !state.dockOpen };
    case 'arm': {
      const row = selectedRow(state);
      return row && row.ref.kind === 'containers' && row.state === 'running' ? { ...state, armed: row.uid } : state;
    }
    case 'reloadDock': return { ...state, epoch: state.epoch + 1 };
    case 'busy': {
      const has = state.busy.includes(action.uid);
      if (action.busy === has) return state;
      return { ...state, busy: action.busy ? [...state.busy, action.uid] : state.busy.filter(uid => uid !== action.uid) };
    }
    case 'tick': return action.now === state.now ? state : keepSelection(state, { ...state, now: action.now }, 'rows');
    case 'showContainersWith': {
      const view = state.views.containers;
      const switched = state.kind !== 'containers';
      const next: ContainerViewState = {
        ...state, kind: 'containers', ...(switched ? { selected: null } : {}),
        views: { ...state.views, containers: { ...view, filters: { ...view.filters, [action.key]: action.value.slice(0, MAX_FILTER_LENGTH) } } },
      };
      return keepSelection(state, next, 'filter');
    }
  }
}

export function currentColumns(state: ContainerViewState): ContainerColumn[] {
  return columnsFor(state.kind, state.inventory?.runtime ?? 'docker');
}

export function rowsOf(state: ContainerViewState): InventoryRow[] {
  return state.inventory?.rows[state.kind] ?? [];
}

/** Column filters AND chips, then sort. Host order without a sort. */
export function visibleRows(state: ContainerViewState): InventoryRow[] {
  const view = state.views[state.kind];
  const columns = currentColumns(state);
  const matchesColumns = compileColumnFilters(columns, view.filters, state.now);
  const matchesChips = compileChips(state.kind, view.chips);
  const rows = rowsOf(state).filter(row => matchesColumns(row) && matchesChips(row));
  const column = view.sort ? columns.find(candidate => candidate.key === view.sort?.key) : undefined;
  if (!view.sort || !column) return rows;
  const sign = view.sort.dir === 'desc' ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row, column) }))
    .sort((a, b) => compareValues(a.value, b.value, sign) || a.index - b.index)
    .map(entry => entry.row);
}

export function tableItems(state: ContainerViewState, rows: InventoryRow[] = visibleRows(state)): TableItem[] {
  const view = state.views[state.kind];
  return groupRows(rows, groupOptionsFor(state.kind, state.inventory?.runtime ?? 'docker'), view.groupBy, view.collapsed);
}

/** Rows of tableItems in display order; rows of collapsed groups are not in it. */
export function navigableRows(state: ContainerViewState): InventoryRow[] {
  const rows: InventoryRow[] = [];
  for (const item of tableItems(state)) if (item.type === 'row') rows.push(item.row);
  return rows;
}

export function selectedRow(state: ContainerViewState): InventoryRow | null {
  if (state.selected === null) return null;
  return visibleRows(state).find(row => row.uid === state.selected) ?? null;
}

/** React key of the dock terminal: a shell is never reopened by itself, a poll never changes the key. */
export function dockTerminalKey(row: InventoryRow, mode: 'logs' | 'shell', epoch: number): string {
  return mode === 'shell' ? `${row.uid}/shell` : `${row.uid}/logs/${epoch}`;
}

export function loadedLabel(at: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 5) return 'gerade geladen';
  if (seconds < 60) return `geladen vor ${seconds} s`;
  return `geladen vor ${Math.floor(seconds / 60)} min`;
}

export function rootlessHint(state: ContainerViewState, hostId: string): string | null {
  const inventory = state.inventory;
  if (!inventory || hostId === LOCAL_CONTAINER_HOST || inventory.runtime !== 'podman' || inventory.sudo) return null;
  if (inventory.rows.containers.length > 0 || inventory.problems.containers) return null;
  return `Podman rootless zeigt nur Container des Benutzers ${inventory.user ?? 'unbekannt'}. Für Root-Container sudo aktivieren.`;
}

export function tabStatus(state: ContainerViewState): 'connecting' | 'connected' | 'error' {
  if (state.inventory) return 'connected';
  return state.error !== null ? 'error' : 'connecting';
}

function patchView(state: ContainerViewState, kind: InventoryKind, patch: Partial<KindView>): ContainerViewState {
  return { ...state, views: { ...state.views, [kind]: { ...state.views[kind], ...patch } } };
}

/** Changes filters or chips of the current kind; selection follows the 'filter' rule. */
function changeView(state: ContainerViewState, patch: Partial<KindView>): ContainerViewState {
  return keepSelection(state, patchView(state, state.kind, patch), 'filter');
}

function setColumnFilter(state: ContainerViewState, key: string, value: string): ContainerViewState {
  if (!currentColumns(state).some(column => column.key === key)) return state;
  const filters = state.views[state.kind].filters;
  const old = filters[key];
  const text = value.slice(0, MAX_FILTER_LENGTH);
  if (text.trim() === '') {
    if (old === undefined) return state;
    const rest = { ...filters };
    delete rest[key];
    return changeView(state, { filters: rest });
  }
  return text === old ? state : changeView(state, { filters: { ...filters, [key]: text } });
}

function setGroupBy(state: ContainerViewState, groupBy: GroupId | null): ContainerViewState {
  const view = state.views[state.kind];
  if (groupBy === null) return view.groupBy === null && view.collapsed.length === 0 ? state : patchView(state, state.kind, { groupBy: null, collapsed: [] });
  if (!groupOptionsFor(state.kind, state.inventory?.runtime ?? 'docker').some(option => option.id === groupBy)) return state;
  return view.groupBy === groupBy ? state : patchView(state, state.kind, { groupBy, collapsed: [] });
}

function groupKeyOf(state: ContainerViewState, row: InventoryRow): string | null {
  const by = state.views[state.kind].groupBy;
  const option = by === null ? undefined : groupOptionsFor(state.kind, state.inventory?.runtime ?? 'docker').find(candidate => candidate.id === by);
  return option ? option.key(row) : null;
}

function toggleGroup(state: ContainerViewState, key: string): ContainerViewState {
  const view = state.views[state.kind];
  if (view.groupBy === null || key.length > MAX_KEY_LENGTH) return state;
  if (view.collapsed.includes(key)) return patchView(state, state.kind, { collapsed: view.collapsed.filter(candidate => candidate !== key) });
  const next = patchView(state, state.kind, { collapsed: [...view.collapsed, key].slice(-MAX_COLLAPSED) });
  // A selected row in the folded group would be hidden: drop the selection.
  const row = selectedRow(state);
  return row && groupKeyOf(state, row) === key ? { ...next, selected: null } : next;
}

function sortBy(state: ContainerViewState, key: string, dir?: 'asc' | 'desc'): ContainerViewState {
  if (!currentColumns(state).some(column => column.key === key)) return state;
  const current = state.views[state.kind].sort;
  let sort: KindView['sort'];
  if (dir) sort = { key, dir };
  else if (current?.key !== key) sort = { key, dir: 'asc' };
  else sort = current.dir === 'asc' ? { key, dir: 'desc' } : null;
  return patchView(state, state.kind, { sort });
}

/**
 * A selection that is no longer visible counts as deleted or hidden. 'rows': it moves to the row at the same display
 * position, else the last one, else null. 'filter': it becomes null. A uid that was never loaded stays.
 */
function keepSelection(previous: ContainerViewState, next: ContainerViewState, mode: 'rows' | 'filter'): ContainerViewState {
  const selected = next.selected;
  if (selected === null) return next;
  if (visibleRows(next).some(row => row.uid === selected)) return next;
  const known = (state: ContainerViewState): boolean => rowsOf(state).some(row => row.uid === selected);
  if (!known(next) && !known(previous)) return next;
  if (mode === 'filter') return { ...next, selected: null };
  const index = navigableRows(previous).findIndex(row => row.uid === selected);
  const displayed = navigableRows(next);
  if (index === -1 || displayed.length === 0) return { ...next, selected: null };
  return { ...next, selected: displayed[Math.min(index, displayed.length - 1)].uid };
}

type SortValue = number | string | null;

/** null = empty, always last. Age sorts by creation time, newest first on 'asc'. */
function sortValue(row: InventoryRow, column: ContainerColumn): SortValue {
  const value = row.cells[column.key] ?? (column.key === 'name' ? row.name : '');
  if (value === '') return null;
  if (column.filter === 'age') {
    const time = typeof value === 'number' ? value : Date.parse(String(value));
    return Number.isNaN(time) ? null : -time;
  }
  if (column.filter === 'number' || column.filter === 'size') {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isNaN(number) ? null : number;
  }
  return String(value);
}

function compareValues(a: SortValue, b: SortValue, sign: 1 | -1): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * sign;
  return String(a).localeCompare(String(b)) * sign;
}
