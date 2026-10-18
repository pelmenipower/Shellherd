import { describe, expect, it } from 'vitest';
import { LOCAL_CONTAINER_HOST, type ContainerInventory, type InventoryKind, type InventoryRow, type InventoryState } from '../../shared/containers';
import {
  containerViewReducer, currentColumns, dockTerminalKey, initialContainerViewState, loadedLabel, navigableRows, rootlessHint, rowsOf,
  selectedRow, tabStatus, tableItems, visibleRows, type ContainerViewAction, type ContainerViewState,
} from './container-view';

const NOW = Date.parse('2026-10-18T12:00:00Z');

function row(kind: InventoryKind, name: string, extra: Partial<InventoryRow> = {}, cells: Record<string, string | number> = {}): InventoryRow {
  return { uid: `docker:${kind}:${name}`, ref: { kind, runtime: 'docker', ref: name }, id: name, name, cells: { name, ...cells }, tone: 'ok', labels: {}, ...extra };
}
const ctr = (name: string, state: InventoryState = 'running', cells: Record<string, string | number> = {}, extra: Partial<InventoryRow> = {}): InventoryRow =>
  row('containers', name, { state, ...extra }, { status: state, ...cells });

function inventory(containers: InventoryRow[], extra: Partial<ContainerInventory> = {}): ContainerInventory {
  return { runtime: 'docker', runtimes: ['docker'], rows: { containers, images: [], volumes: [], networks: [] }, problems: {}, at: NOW, sudo: false, ...extra };
}
function run(state: ContainerViewState, ...actions: ContainerViewAction[]): ContainerViewState {
  return actions.reduce(containerViewReducer, state);
}
function loaded(containers: InventoryRow[], extra: Partial<ContainerInventory> = {}): ContainerViewState {
  return run(initialContainerViewState(NOW), { type: 'setInventory', inventory: inventory(containers, extra) });
}
const abc = (): InventoryRow[] => [ctr('a'), ctr('b'), ctr('c')];

describe('initial state', () => {
  it('starts on containers with an open logs dock', () => {
    const state = initialContainerViewState(NOW);
    expect(state).toMatchObject({ kind: 'containers', dock: 'logs', dockOpen: true, loading: true, epoch: 0, busy: [], armed: null, inventory: null });
    expect(state.views.images).toEqual({ filters: {}, chips: [], sort: null, groupBy: null, collapsed: [] });
  });
  it('a quiet loading keeps the status line once an inventory is there', () => {
    const idle = loaded(abc());
    expect(run(idle, { type: 'loading', quiet: true }).loading).toBe(false);
    expect(run(idle, { type: 'loading' }).loading).toBe(true);
    const empty = { ...initialContainerViewState(NOW), loading: false };
    expect(run(empty, { type: 'loading', quiet: true }).loading).toBe(true);
  });
  it('setInventory clears loading and error, fail keeps the old inventory', () => {
    const failed = run(loaded(abc()), { type: 'loading' }, { type: 'fail', message: 'kaputt' });
    expect(failed).toMatchObject({ loading: false, error: 'kaputt' });
    expect(rowsOf(failed)).toHaveLength(3);
    expect(run(failed, { type: 'setInventory', inventory: inventory(abc()) })).toMatchObject({ error: null, loading: false });
  });
});

describe('selection after a poll', () => {
  it('stays on the uid when rows move', () => {
    const state = run(loaded(abc()), { type: 'select', uid: 'docker:containers:b' },
      { type: 'setInventory', inventory: inventory([ctr('c'), ctr('b'), ctr('a')]) });
    expect(state.selected).toBe('docker:containers:b');
  });
  it('jumps to the neighbour at the same position when the row vanishes', () => {
    const state = run(loaded(abc()), { type: 'select', uid: 'docker:containers:b' }, { type: 'setInventory', inventory: inventory([ctr('a'), ctr('c')]) });
    expect(state.selected).toBe('docker:containers:c');
  });
  it('jumps to the last row, or null when nothing is left', () => {
    const base = run(loaded(abc()), { type: 'select', uid: 'docker:containers:c' });
    expect(run(base, { type: 'setInventory', inventory: inventory([ctr('a'), ctr('b')]) }).selected).toBe('docker:containers:b');
    expect(run(base, { type: 'setInventory', inventory: inventory([]) }).selected).toBeNull();
  });
  it('resets on a runtime change and on setRuntime', () => {
    const base = run(loaded(abc()), { type: 'select', uid: 'docker:containers:a' });
    expect(run(base, { type: 'setInventory', inventory: inventory(abc(), { runtime: 'podman', runtimes: ['docker', 'podman'] }) }).selected).toBeNull();
    const asked = run(base, { type: 'setRuntime', runtime: 'podman' });
    expect(asked).toMatchObject({ selected: null, requestedRuntime: 'podman', loading: true });
  });
  it('tick keeps the selection when the row is still visible', () => {
    const state = run(loaded(abc()), { type: 'select', uid: 'docker:containers:a' }, { type: 'tick', now: NOW + 5000 });
    expect(state).toMatchObject({ selected: 'docker:containers:a', now: NOW + 5000 });
  });
  it('move steps within the display order and clamps', () => {
    const base = loaded(abc());
    expect(run(base, { type: 'move', delta: 1 }).selected).toBe('docker:containers:a');
    expect(run(base, { type: 'move', delta: -1 }).selected).toBe('docker:containers:c');
    expect(run(base, { type: 'move', delta: -1 }, { type: 'move', delta: 1 }).selected).toBe('docker:containers:c');
  });
});

describe('filters', () => {
  it('a filter hiding the selection nulls it, one showing it keeps it', () => {
    const base = run(loaded([ctr('web-1'), ctr('db-1')]), { type: 'select', uid: 'docker:containers:web-1' });
    expect(run(base, { type: 'setColumnFilter', key: 'name', value: 'db' }).selected).toBeNull();
    expect(run(base, { type: 'setColumnFilter', key: 'name', value: 'web' }).selected).toBe('docker:containers:web-1');
  });
  it('chips filter and null the hidden selection', () => {
    const base = run(loaded([ctr('a', 'running'), ctr('b', 'exited')]), { type: 'select', uid: 'docker:containers:a' });
    const stopped = run(base, { type: 'toggleChip', id: 'stopped' });
    expect(visibleRows(stopped).map(r => r.name)).toEqual(['b']);
    expect(stopped.selected).toBeNull();
    expect(run(base, { type: 'toggleChip', id: 'nope' })).toBe(base);
    expect(run(stopped, { type: 'toggleChip', id: 'stopped' }).views.containers.chips).toEqual([]);
    expect(run(base, { type: 'setChips', ids: ['running', 'bogus'] }).views.containers.chips).toEqual(['running']);
  });
  it('ignores unknown columns and removes blank values', () => {
    const base = loaded(abc());
    expect(run(base, { type: 'setColumnFilter', key: 'pod', value: 'x' })).toBe(base);
    const set = run(base, { type: 'setColumnFilter', key: 'name', value: 'a' });
    expect(run(set, { type: 'setColumnFilter', key: 'name', value: ' ' }).views.containers.filters).toEqual({});
  });
  it('keeps filters, chips, sort and grouping per kind across setKind', () => {
    const state = run(loaded(abc()),
      { type: 'setColumnFilter', key: 'name', value: 'a' }, { type: 'toggleChip', id: 'running' }, { type: 'sort', key: 'name' }, { type: 'setGroupBy', groupBy: 'status' },
      { type: 'setKind', kind: 'images' }, { type: 'setColumnFilter', key: 'tag', value: '1' }, { type: 'setKind', kind: 'containers' });
    expect(state.views.containers).toEqual({ filters: { name: 'a' }, chips: ['running'], sort: { key: 'name', dir: 'asc' }, groupBy: 'status', collapsed: [] });
    expect(state.views.images.filters).toEqual({ tag: '1' });
  });
  it('clearFilter keeps grouping and sort and is a no-op when empty', () => {
    const base = loaded(abc());
    expect(run(base, { type: 'clearFilter' })).toBe(base);
    const state = run(base, { type: 'setColumnFilter', key: 'name', value: 'a' }, { type: 'toggleChip', id: 'running' }, { type: 'setGroupBy', groupBy: 'status' }, { type: 'clearFilter' });
    expect(state.views.containers).toMatchObject({ filters: {}, chips: [], groupBy: 'status' });
  });
});

describe('sorting', () => {
  it('cycles asc, desc, none', () => {
    let state = loaded(abc());
    state = run(state, { type: 'sort', key: 'name' });
    expect(state.views.containers.sort).toEqual({ key: 'name', dir: 'asc' });
    state = run(state, { type: 'sort', key: 'name' });
    expect(state.views.containers.sort).toEqual({ key: 'name', dir: 'desc' });
    expect(visibleRows(state).map(r => r.name)).toEqual(['c', 'b', 'a']);
    state = run(state, { type: 'sort', key: 'name' });
    expect(state.views.containers.sort).toBeNull();
    expect(run(state, { type: 'sort', key: 'name', dir: 'desc' }).views.containers.sort).toEqual({ key: 'name', dir: 'desc' });
    expect(run(state, { type: 'sort', key: 'name' }, { type: 'clearSort' }).views.containers.sort).toBeNull();
  });
  it('sorts numbers numerically and keeps empty values last in both directions', () => {
    const images = [row('images', 'a', {}, { size: 10 }), row('images', 'b', {}, { size: '' }), row('images', 'c', {}, { size: 2 })];
    const base = run(initialContainerViewState(NOW), { type: 'setInventory', inventory: { ...inventory([]), rows: { containers: [], images, volumes: [], networks: [] } } }, { type: 'setKind', kind: 'images' });
    expect(visibleRows(run(base, { type: 'sort', key: 'size', dir: 'asc' })).map(r => r.name)).toEqual(['c', 'a', 'b']);
    expect(visibleRows(run(base, { type: 'sort', key: 'size', dir: 'desc' })).map(r => r.name)).toEqual(['a', 'c', 'b']);
  });
  it('sorts age with the youngest first on asc', () => {
    const rows = [ctr('old', 'running', { created: '2026-10-01T00:00:00Z' }), ctr('new', 'running', { created: '2026-10-18T11:00:00Z' }), ctr('none')];
    const state = run(loaded(rows), { type: 'sort', key: 'created', dir: 'asc' });
    expect(visibleRows(state).map(r => r.name)).toEqual(['new', 'old', 'none']);
  });
});

describe('grouping', () => {
  it('groups, collapses and hides collapsed rows from navigation', () => {
    const rows = [ctr('a', 'running'), ctr('b', 'exited'), ctr('c', 'running')];
    let state = run(loaded(rows), { type: 'setGroupBy', groupBy: 'status' });
    expect(tableItems(state).map(item => item.type)).toEqual(['group', 'row', 'group', 'row', 'row']);
    state = run(state, { type: 'toggleGroup', key: 'running' });
    expect(navigableRows(state).map(r => r.name)).toEqual(['b']);
    expect(run(state, { type: 'toggleGroup', key: 'running' }).views.containers.collapsed).toEqual([]);
  });
  it('folding the selected row group drops the selection', () => {
    const state = run(loaded([ctr('a', 'running'), ctr('b', 'exited')]), { type: 'setGroupBy', groupBy: 'status' }, { type: 'select', uid: 'docker:containers:a' }, { type: 'toggleGroup', key: 'running' });
    expect(state.selected).toBeNull();
  });
  it('rejects pod grouping on docker and ignores toggle without grouping', () => {
    const base = loaded(abc());
    expect(run(base, { type: 'setGroupBy', groupBy: 'pod' })).toBe(base);
    expect(run(base, { type: 'toggleGroup', key: 'x' })).toBe(base);
    expect(run(base, { type: 'setGroupBy', groupBy: null })).toBe(base);
  });
});

describe('dock and shell arm', () => {
  it('arm applies only to a running container and clears when the selection changes', () => {
    const base = loaded([ctr('a', 'running'), ctr('b', 'exited')]);
    expect(run(base, { type: 'arm' }).armed).toBeNull();
    const onB = run(base, { type: 'select', uid: 'docker:containers:b' }, { type: 'arm' });
    expect(onB.armed).toBeNull();
    const armed = run(base, { type: 'select', uid: 'docker:containers:a' }, { type: 'arm' });
    expect(armed.armed).toBe('docker:containers:a');
    expect(run(armed, { type: 'select', uid: 'docker:containers:a' }).armed).toBe('docker:containers:a');
    expect(run(armed, { type: 'select', uid: 'docker:containers:b' }).armed).toBeNull();
    expect(run(armed, { type: 'move', delta: 1 }).armed).toBeNull();
  });
  it('a poll that shows the armed container stopped drops the arm for good', () => {
    const armed = run(loaded([ctr('a', 'running')]), { type: 'select', uid: 'docker:containers:a' }, { type: 'arm' });
    expect(armed.armed).toBe('docker:containers:a');
    const exited = run(armed, { type: 'setInventory', inventory: inventory([ctr('a', 'exited')]) });
    expect(exited.armed).toBeNull();
    expect(run(exited, { type: 'setInventory', inventory: inventory([ctr('a', 'running')]) }).armed).toBeNull();
    expect(run(armed, { type: 'setInventory', inventory: inventory([ctr('a', 'running')]) }).armed).toBe('docker:containers:a');
    expect(run(armed, { type: 'setInventory', inventory: inventory([ctr('z')]) }).armed).toBeNull();
  });
  it('setKind to images switches logs and shell to inspect', () => {
    expect(run(loaded(abc()), { type: 'setKind', kind: 'images' }).dock).toBe('inspect');
    expect(run(loaded(abc()), { type: 'dock', mode: 'shell' }, { type: 'setKind', kind: 'volumes' }).dock).toBe('inspect');
  });
  it('logs and shell on other kinds change nothing, inspect opens the dock', () => {
    const images = run(loaded(abc()), { type: 'setKind', kind: 'images' }, { type: 'toggleDock' });
    expect(images.dockOpen).toBe(false);
    expect(run(images, { type: 'dock', mode: 'logs' })).toBe(images);
    expect(run(images, { type: 'dock', mode: 'inspect' })).toMatchObject({ dock: 'inspect', dockOpen: true });
    expect(run(loaded(abc()), { type: 'toggleDock' }, { type: 'dock', mode: 'shell' })).toMatchObject({ dock: 'shell', dockOpen: true });
  });
  it('reloadDock raises the epoch; busy toggles idempotently', () => {
    const base = loaded(abc());
    expect(run(base, { type: 'reloadDock' }).epoch).toBe(1);
    const busy = run(base, { type: 'busy', uid: 'x', busy: true }, { type: 'busy', uid: 'x', busy: true });
    expect(busy.busy).toEqual(['x']);
    expect(run(busy, { type: 'busy', uid: 'x', busy: false }).busy).toEqual([]);
  });
});

describe('showContainersWith', () => {
  it('switches to containers, sets the filter and keeps the other filters', () => {
    const images = { ...inventory(abc()), rows: { containers: [ctr('a', 'running', { image: 'nginx:1' }), ctr('b', 'running', { image: 'redis:7' })], images: [row('images', 'nginx:1')], volumes: [], networks: [] } };
    const state = run(initialContainerViewState(NOW), { type: 'setInventory', inventory: images }, { type: 'setColumnFilter', key: 'name', value: 'a' },
      { type: 'setKind', kind: 'images' }, { type: 'select', uid: 'docker:images:nginx:1' }, { type: 'showContainersWith', key: 'image', value: 'nginx' });
    expect(state).toMatchObject({ kind: 'containers', selected: null });
    expect(state.views.containers.filters).toEqual({ name: 'a', image: 'nginx' });
    expect(visibleRows(state).map(r => r.name)).toEqual(['a']);
  });
  it('keeps a selection that stays visible', () => {
    const state = run(loaded([ctr('a', 'running', { project: 'shop' }), ctr('b')]), { type: 'select', uid: 'docker:containers:a' }, { type: 'showContainersWith', key: 'project', value: 'shop' });
    expect(state.selected).toBe('docker:containers:a');
  });
});

describe('selectors and labels', () => {
  it('currentColumns follows the runtime and selectedRow looks among visible rows', () => {
    expect(currentColumns(initialContainerViewState(NOW)).map(c => c.key)).not.toContain('pod');
    expect(currentColumns(loaded(abc(), { runtime: 'podman', runtimes: ['podman'] })).map(c => c.key)).toContain('pod');
    const state = run(loaded(abc()), { type: 'select', uid: 'docker:containers:b' });
    expect(selectedRow(state)?.name).toBe('b');
    expect(selectedRow(run(state, { type: 'select', uid: null }))).toBeNull();
  });
  it('dockTerminalKey ignores polls but not reloadDock', () => {
    const r = ctr('a');
    expect(dockTerminalKey(r, 'shell', 0)).toBe('docker:containers:a/shell');
    expect(dockTerminalKey(r, 'shell', 3)).toBe(dockTerminalKey(r, 'shell', 0));
    expect(dockTerminalKey(r, 'logs', 2)).toBe('docker:containers:a/logs/2');
    const state = run(loaded(abc()), { type: 'tick', now: NOW + 10_000 }, { type: 'setInventory', inventory: inventory(abc()) });
    expect(dockTerminalKey(r, 'logs', state.epoch)).toBe(dockTerminalKey(r, 'logs', 0));
    expect(dockTerminalKey(r, 'logs', run(state, { type: 'reloadDock' }).epoch)).not.toBe(dockTerminalKey(r, 'logs', 0));
  });
  it('loadedLabel', () => {
    expect(loadedLabel(NOW, NOW + 4000)).toBe('gerade geladen');
    expect(loadedLabel(NOW, NOW + 5000)).toBe('geladen vor 5 s');
    expect(loadedLabel(NOW, NOW + 59_000)).toBe('geladen vor 59 s');
    expect(loadedLabel(NOW, NOW + 125_000)).toBe('geladen vor 2 min');
  });
  it('rootlessHint needs every condition', () => {
    const podman = loaded([], { runtime: 'podman', runtimes: ['podman'], user: 'anna' });
    expect(rootlessHint(podman, 'host-1')).toBe('Podman rootless zeigt nur Container des Benutzers anna. Für Root-Container sudo aktivieren.');
    expect(rootlessHint(podman, LOCAL_CONTAINER_HOST)).toBeNull();
    expect(rootlessHint(loaded([], { user: 'anna' }), 'host-1')).toBeNull();
    expect(rootlessHint(loaded([], { runtime: 'podman', runtimes: ['podman'], sudo: true }), 'host-1')).toBeNull();
    expect(rootlessHint(loaded([ctr('a')], { runtime: 'podman', runtimes: ['podman'] }), 'host-1')).toBeNull();
    expect(rootlessHint(loaded([], { runtime: 'podman', runtimes: ['podman'], problems: { containers: 'Fehler' } }), 'host-1')).toBeNull();
    expect(rootlessHint(initialContainerViewState(NOW), 'host-1')).toBeNull();
  });
  it('tabStatus', () => {
    const initial = initialContainerViewState(NOW);
    expect(tabStatus(initial)).toBe('connecting');
    expect(tabStatus(run(initial, { type: 'fail', message: 'x' }))).toBe('error');
    expect(tabStatus(run(loaded(abc()), { type: 'fail', message: 'x' }))).toBe('connected');
  });
});
