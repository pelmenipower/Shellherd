import { describe, expect, it } from 'vitest';
import type { ContainerInventory, InventoryKind, InventoryRow, InventoryState } from '../../shared/containers';
import { COLUMNS } from './container-columns';
import { menuFor, terminalTargetOf, type ContainerMenuContext, type ContainerMenuEntry, type ContainerMenuTarget } from './container-menus';
import { containerViewReducer, initialContainerViewState, type ContainerViewAction } from './container-view';

const NOW = Date.parse('2026-10-18T12:00:00Z');

function row(kind: InventoryKind, name: string, extra: Partial<InventoryRow> = {}, cells: Record<string, string | number> = {}): InventoryRow {
  return { uid: `docker:${kind}:${name}`, ref: { kind, runtime: 'docker', ref: name }, id: `id-${name}`, name, cells: { name, ...cells }, tone: 'ok', labels: {}, ...extra };
}
const ctr = (name: string, state: InventoryState = 'running', cells: Record<string, string | number> = {}, extra: Partial<InventoryRow> = {}): InventoryRow =>
  row('containers', name, { state, ...extra }, { status: state, ...cells });
const image = (name: string, cells: Record<string, string | number> = {}, extra: Partial<InventoryRow> = {}): InventoryRow =>
  row('images', name, extra, { repository: 'nginx', tag: '1.27', ...cells });

function ctx(rows: InventoryRow[] = [], opts: { canPopout?: boolean; selected?: string | null; kind?: InventoryKind; actions?: ContainerViewAction[] } = {}): ContainerMenuContext {
  const inventory: ContainerInventory = { runtime: 'docker', runtimes: ['docker'], rows: { containers: [], images: [], volumes: [], networks: [] }, problems: {}, at: NOW, sudo: false };
  for (const r of rows) inventory.rows[r.ref.kind].push(r);
  let state = containerViewReducer(initialContainerViewState(NOW), { type: 'setInventory', inventory });
  if (opts.kind) state = containerViewReducer(state, { type: 'setKind', kind: opts.kind });
  for (const action of opts.actions ?? []) state = containerViewReducer(state, action);
  return { state: { ...state, selected: opts.selected ?? null }, canPopout: opts.canPopout ?? true };
}

const rowTarget = (r: InventoryRow): ContainerMenuTarget => ({ type: 'row', row: r });
const items = (entries: ContainerMenuEntry[]) => entries.filter((e): e is Extract<ContainerMenuEntry, { kind: 'item' }> => e.kind === 'item');
const ids = (entries: ContainerMenuEntry[]): string[] => entries.map(e => e.kind === 'item' ? e.id : e.kind === 'heading' ? `#${e.label}` : '-');
const find = (entries: ContainerMenuEntry[], id: string) => items(entries).find(e => e.id === id)!;

describe('container row menu', () => {
  const web = ctr('web', 'running', { image: 'nginx:1', ports: '80/tcp' }, { project: 'shop' });

  it('orders the entries of a running compose container', () => {
    expect(ids(menuFor(rowTarget(web), ctx([web])))).toEqual([
      'logs', 'shell', 'inspect', '-', 'tab-logs', 'tab-shell', '-', 'project', 'chip', '-',
      '#Kopieren', 'copy-name', 'copy-id', 'copy-image', 'copy-ports', 'copy-logs', 'copy-exec', '-',
      '#Aktionen', 'start', 'stop', 'restart', 'remove',
    ]);
  });
  it('shows hotkeys only for the selected row', () => {
    const hot = menuFor(rowTarget(web), ctx([web], { selected: web.uid }));
    expect(find(hot, 'logs').hint).toBe('l');
    expect(find(hot, 'shell').hint).toBe('s');
    expect(find(hot, 'inspect').hint).toBe('i');
    expect(find(hot, 'stop').hint).toBe('x');
    const stopped = ctr('db', 'exited');
    expect(find(menuFor(rowTarget(stopped), ctx([stopped], { selected: stopped.uid })), 'remove').hint).toBe('Ctrl+d');
    const cold = menuFor(rowTarget(web), ctx([web], { selected: 'other' }));
    expect(items(cold).filter(e => e.hint !== undefined && !e.disabled)).toEqual([]);
  });
  it('opens the shell directly from the menu', () => {
    expect(find(menuFor(rowTarget(web), ctx([web])), 'shell').run).toEqual({ type: 'view', actions: [{ type: 'select', uid: web.uid }, { type: 'dock', mode: 'shell' }, { type: 'arm' }] });
  });
  it('words the reasons verbatim', () => {
    const stopped = ctr('db', 'exited');
    const menu = menuFor(rowTarget(stopped), ctx([stopped], { canPopout: false }));
    expect(find(menu, 'shell')).toMatchObject({ disabled: true, hint: 'Der Container läuft nicht.' });
    expect(ids(menu)).not.toContain('tab-shell');
    expect(find(menu, 'tab-logs')).toMatchObject({ disabled: true, hint: 'Hier lässt sich kein Tab öffnen.' });
    expect(find(menu, 'copy-ports')).toMatchObject({ disabled: true, hint: 'Keine Ports.' });
    expect(find(menu, 'stop')).toMatchObject({ disabled: true, hint: 'Der Container läuft nicht.' });
    expect(find(menuFor(rowTarget(web), ctx([web])), 'remove')).toMatchObject({ disabled: true, hint: 'Laufende Container zuerst stoppen.' });
    expect(find(menuFor(rowTarget(web), ctx([web])), 'start')).toMatchObject({ disabled: true, hint: 'Der Container läuft bereits.' });
  });
  it('filters by project and primary chip', () => {
    const menu = menuFor(rowTarget(web), ctx([web]));
    expect(find(menu, 'project')).toMatchObject({ label: 'Nur Projekt „shop“ anzeigen', run: { type: 'view', actions: [{ type: 'setColumnFilter', key: 'project', value: 'shop' }] } });
    expect(find(menu, 'chip')).toMatchObject({ label: 'Nur „Läuft“ anzeigen', run: { type: 'view', actions: [{ type: 'setChips', ids: ['running'] }] } });
  });
  it('copies commands with the row ref', () => {
    const menu = menuFor(rowTarget(web), ctx([web]));
    expect(find(menu, 'copy-logs').run).toEqual({ type: 'copy', text: 'docker logs -f web', label: 'Befehl' });
    expect(find(menu, 'copy-exec').run).toEqual({ type: 'copy', text: 'docker exec -it web sh', label: 'Befehl' });
  });
  it('builds the terminal target', () => {
    expect(terminalTargetOf(web, 'logs')).toEqual({ item: { kind: 'container', runtime: 'docker', ref: 'web', name: 'web' }, mode: 'logs' });
    expect(find(menuFor(rowTarget(web), ctx([web])), 'tab-shell').run).toEqual({ type: 'popout', target: terminalTargetOf(web, 'shell') });
  });
});

describe('image, volume and network rows', () => {
  it('orders the image menu', () => {
    const img = image('nginx:1.27');
    expect(ids(menuFor(rowTarget(img), ctx([img])))).toEqual(['inspect', 'containers-with', '-', '#Kopieren', 'copy-ref', 'copy-id', 'copy-pull', '-', '#Aktionen', 'remove']);
    const menu = menuFor(rowTarget(img), ctx([img]));
    expect(find(menu, 'copy-pull').run).toEqual({ type: 'copy', text: 'docker pull nginx:1.27', label: 'Befehl' });
    expect(find(menu, 'containers-with').run).toEqual({ type: 'view', actions: [{ type: 'showContainersWith', key: 'image', value: 'nginx' }] });
  });
  it('blocks pull and reference of an image without tag', () => {
    const img = image('abc', { repository: '', tag: '' });
    const menu = menuFor(rowTarget(img), ctx([img]));
    expect(find(menu, 'copy-pull')).toMatchObject({ disabled: true, hint: 'Das Image hat kein Tag.' });
    expect(find(menu, 'copy-ref')).toMatchObject({ disabled: true, hint: 'Das Image hat kein Tag.' });
    expect(find(menu, 'containers-with').run).toEqual({ type: 'view', actions: [{ type: 'showContainersWith', key: 'image', value: 'id-abc'.slice(0, 12) }] });
  });
  it('blocks pull for an invalid name', () => {
    const img = image('x', { repository: 'Bad Name', tag: '1' });
    expect(find(menuFor(rowTarget(img), ctx([img])), 'copy-pull')).toMatchObject({ disabled: true, hint: 'Name enthält ungültige Zeichen.' });
  });
  it('orders the volume menu', () => {
    const vol = row('volumes', 'data', {}, { mountpoint: '/var/lib/data' });
    expect(ids(menuFor(rowTarget(vol), ctx([vol])))).toEqual(['inspect', '-', '#Kopieren', 'copy-name', 'copy-mountpoint', '-', '#Aktionen', 'remove']);
  });
  it('gives networks no actions', () => {
    const net = row('networks', 'bridge');
    const menu = menuFor(rowTarget(net), ctx([net]));
    expect(ids(menu)).toEqual(['inspect', 'containers-with', '-', '#Kopieren', 'copy-name', 'copy-id']);
    expect(find(menu, 'containers-with').run).toEqual({ type: 'view', actions: [{ type: 'showContainersWith', key: 'networks', value: 'bridge' }] });
  });
  it('greys out remove of a used image', () => {
    const img = image('nginx:1.27', {}, { usedBy: 2 });
    expect(find(menuFor(rowTarget(img), ctx([img])), 'remove')).toMatchObject({ disabled: true, hint: 'Das Image wird noch benutzt.' });
  });
});

describe('dock, header and background menus', () => {
  const web = ctr('web');
  it('orders the dock menu in logs mode', () => {
    const menu = menuFor({ type: 'dock', mode: 'logs', row: web }, ctx([web], { selected: web.uid }));
    expect(ids(menu)).toEqual(['logs', 'shell', 'inspect', '-', 'reload', 'popout', '-', 'toggle']);
    expect(find(menu, 'reload').run).toEqual({ type: 'dockReload' });
    expect(find(menu, 'popout').run).toEqual({ type: 'popout', target: terminalTargetOf(web, 'logs') });
  });
  it('drops the reload entry outside logs and greys popout in inspect', () => {
    const menu = menuFor({ type: 'dock', mode: 'inspect', row: web }, ctx([web]));
    expect(ids(menu)).not.toContain('reload');
    expect(find(menu, 'popout')).toMatchObject({ disabled: true, hint: 'Nur für Logs und Shell.' });
    expect(find(menuFor({ type: 'dock', mode: 'logs', row: web }, ctx([web], { canPopout: false })), 'popout')).toMatchObject({ disabled: true, hint: 'Hier lässt sich kein Tab öffnen.' });
  });
  it('greys the dock entries without a row', () => {
    const menu = menuFor({ type: 'dock', mode: 'logs', row: null }, ctx([]));
    expect(find(menu, 'inspect')).toMatchObject({ disabled: true, hint: 'Keine Zeile ausgewählt.' });
    expect(find(menu, 'popout').disabled).toBe(true);
  });
  it('builds the header menu', () => {
    const status = COLUMNS.containers[1];
    const plain = menuFor({ type: 'header', column: status }, ctx([web]));
    expect(ids(plain)).toEqual(['sort-asc', 'sort-desc', 'sort-clear', '-', 'group', '-', 'filter-clear']);
    expect(find(plain, 'sort-clear')).toMatchObject({ disabled: true, hint: 'Standard: Reihenfolge des Hosts' });
    expect(find(plain, 'filter-clear').disabled).toBe(true);
    expect(find(plain, 'group')).toMatchObject({ label: 'Nach Status gruppieren', run: { type: 'view', actions: [{ type: 'setGroupBy', groupBy: 'status' }] } });
    const active = menuFor({ type: 'header', column: status }, ctx([web], { actions: [{ type: 'sort', key: 'status' }, { type: 'setColumnFilter', key: 'status', value: 'running' }] }));
    expect(find(active, 'sort-clear').disabled).toBeUndefined();
    expect(find(active, 'filter-clear').disabled).toBeUndefined();
  });
  it('offers grouping only for group columns', () => {
    const ports = COLUMNS.containers[4];
    expect(ids(menuFor({ type: 'header', column: ports }, ctx([web])))).not.toContain('group');
  });
  it('builds the background menu', () => {
    const menu = menuFor({ type: 'background' }, ctx([web]));
    expect(ids(menu)).toEqual(['filter-reset', 'group-clear', 'sort-clear', '-', 'reload', 'help']);
    expect(find(menu, 'filter-reset').hint).toBe('F');
    expect(find(menu, 'group-clear')).toMatchObject({ disabled: true, hint: 'Keine Gruppierung aktiv.' });
    expect(find(menu, 'reload')).toMatchObject({ hint: 'F5', run: { type: 'reload' } });
    expect(find(menu, 'help')).toMatchObject({ hint: '?', run: { type: 'help' } });
  });
});

describe('mutating entries', () => {
  it('only reaches the host through containerAction', () => {
    const rows = [ctr('a'), ctr('b', 'exited'), image('nginx:1'), row('volumes', 'v'), row('networks', 'n')];
    const state = ctx(rows);
    const targets: ContainerMenuTarget[] = [
      ...rows.map(rowTarget), { type: 'background' }, { type: 'dock', mode: 'logs', row: rows[0] },
      { type: 'header', column: COLUMNS.containers[0] },
    ];
    const hostActions = new Set(['start', 'stop', 'restart', 'remove']);
    for (const target of targets) {
      for (const entry of items(menuFor(target, state))) {
        // No view action can smuggle a host action; the only host-changing run type is containerAction.
        expect(['view', 'copy', 'containerAction', 'popout', 'reload', 'dockReload', 'help']).toContain(entry.run.type);
        if (hostActions.has(entry.id)) expect(entry.run.type).toBe('containerAction');
        if (entry.run.type === 'containerAction') expect(rows).toContain(entry.run.row);
      }
    }
  });
});
