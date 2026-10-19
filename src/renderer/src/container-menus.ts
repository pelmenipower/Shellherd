/** Context menus of the container view as pure data; see docs/superpowers/specs/2026-10-18-container-view-validation.md (C24-C27). */
import { IMAGE_NAME_TAG, type ContainerDockMode, type InventoryAction, type InventoryRow, type TerminalTarget } from '../../shared/containers';
import { groupOptionsFor, type ContainerColumn } from './container-columns';
import { CONTAINER_COMMANDS, actionUnavailable, type ContainerCommandContext, type ContainerCommandId } from './container-commands';
import { primaryChip } from './container-status';
import type { ContainerViewAction, ContainerViewState } from './container-view';

export type ContainerMenuTarget =
  | { type: 'row'; row: InventoryRow }
  | { type: 'dock'; mode: ContainerDockMode; row: InventoryRow | null }
  | { type: 'header'; column: ContainerColumn }
  | { type: 'background' };

export type ContainerMenuAction =
  | { type: 'view'; actions: ContainerViewAction[] }
  | { type: 'copy'; text: string; label: string }
  | { type: 'containerAction'; row: InventoryRow; action: InventoryAction }
  | { type: 'popout'; target: TerminalTarget }
  | { type: 'reload' }
  | { type: 'dockReload' }
  | { type: 'help' };

export type ContainerMenuEntry =
  | { kind: 'item'; id: string; label: string; hint?: string; disabled?: boolean; run: ContainerMenuAction }
  | { kind: 'heading'; label: string }
  | { kind: 'separator' };

export interface ContainerMenuContext { state: ContainerViewState; canPopout: boolean }

const NO_POPOUT = 'Hier lässt sich kein Tab öffnen.';
const NOT_RUNNING = 'Der Container läuft nicht.';
const NO_TAG = 'Das Image hat kein Tag.';
const INVALID_NAME = 'Name enthält ungültige Zeichen.';
const SORT_HINT = 'Standard: Reihenfolge des Hosts';

/** TerminalTarget of a container row for logs or shell. */
export function terminalTargetOf(row: InventoryRow, mode: 'logs' | 'shell'): TerminalTarget {
  return { item: { kind: 'container', runtime: row.ref.runtime, ref: row.ref.ref, name: row.name }, mode };
}

interface Env { ctx: ContainerMenuContext; /** Hotkey hints only for the selected row. */ hot: boolean }
interface Options { hotkey?: ContainerCommandId; reason?: string | undefined }
type Group = ContainerMenuEntry[];

const item = (env: Env, id: string, label: string, run: ContainerMenuAction, options: Options = {}): ContainerMenuEntry => {
  if (options.reason) return { kind: 'item', id, label, hint: options.reason, disabled: true, run };
  const key = env.hot && options.hotkey ? CONTAINER_COMMANDS.find(command => command.id === options.hotkey)?.keys[0] : undefined;
  return { kind: 'item', id, label, ...(key ? { hint: key } : {}), run };
};

/** Groups in order; empty groups drop out and the rest is joined by single separators. */
function assemble(groups: Group[]): ContainerMenuEntry[] {
  const out: ContainerMenuEntry[] = [];
  for (const group of groups) {
    if (group.length === 0) continue;
    if (out.length > 0) out.push({ kind: 'separator' });
    out.push(...group);
  }
  return out;
}

const view = (...actions: ContainerViewAction[]): ContainerMenuAction => ({ type: 'view', actions });
const select = (row: InventoryRow): ContainerViewAction => ({ type: 'select', uid: row.uid });
const dock = (mode: ContainerDockMode): ContainerViewAction => ({ type: 'dock', mode });
const cell = (row: InventoryRow, key: string): string => String(row.cells[key] ?? '').trim();

/** Copy group: heading plus the entries that exist (text undefined = absent); a reason greys an entry out. */
function copyGroup(env: Env, entries: [id: string, label: string, text: string | undefined, reason?: string][]): Group {
  const items = entries.flatMap(([id, label, text, reason]): ContainerMenuEntry[] =>
    text === undefined ? [] : [item(env, `copy-${id}`, label, { type: 'copy', text, label }, { reason })]);
  return items.length === 0 ? [] : [{ kind: 'heading', label: 'Kopieren' }, ...items];
}

function actionGroup(env: Env, row: InventoryRow): Group {
  const kind = row.ref.kind;
  if (kind === 'networks') return [];
  const all: [InventoryAction, string, ContainerCommandId | undefined][] = [
    ['start', 'Starten', undefined], ['stop', 'Stoppen…', 'stop'], ['restart', 'Neu starten…', 'restart'], ['remove', 'Entfernen…', 'remove'],
  ];
  const wanted = kind === 'containers' ? all : all.filter(([action]) => action === 'remove');
  return [{ kind: 'heading', label: 'Aktionen' },
    ...wanted.map(([action, label, hotkey]) => item(env, action, label, { type: 'containerAction', row, action }, { hotkey, reason: actionUnavailable(row, action) }))];
}

function rowMenu(env: Env, row: InventoryRow): ContainerMenuEntry[] {
  const kind = row.ref.kind;
  const rt = row.ref.runtime;
  const inspect = item(env, 'inspect', 'Inspect', view(select(row), dock('inspect')), { hotkey: 'inspect' });
  if (kind === 'containers') {
    const running = row.state === 'running';
    const tab = (mode: 'logs' | 'shell'): ContainerMenuEntry => item(env, `tab-${mode}`, mode === 'logs' ? 'Logs als Tab öffnen' : 'Shell als Tab öffnen',
      { type: 'popout', target: terminalTargetOf(row, mode) }, { reason: env.ctx.canPopout ? undefined : NO_POPOUT });
    const chip = primaryChip('containers', row);
    const ref = row.ref.ref;
    const ports = cell(row, 'ports');
    return assemble([
      [item(env, 'logs', 'Logs', view(select(row), dock('logs')), { hotkey: 'logs' }),
        item(env, 'shell', 'Shell öffnen', view(select(row), dock('shell'), { type: 'arm' }), { hotkey: 'shell', reason: running ? undefined : NOT_RUNNING }),
        inspect],
      [tab('logs'), ...(running ? [tab('shell')] : [])],
      [...(row.project ? [item(env, 'project', `Nur Projekt „${row.project}“ anzeigen`, view({ type: 'setColumnFilter', key: 'project', value: row.project }))] : []),
        ...(chip ? [item(env, 'chip', `Nur „${chip.label}“ anzeigen`, view({ type: 'setChips', ids: [chip.id] }))] : [])],
      copyGroup(env, [
        ['name', 'Name', row.name], ['id', 'ID', row.id], ['image', 'Image', cell(row, 'image') || undefined],
        ['ports', 'Ports', ports, ports === '' ? 'Keine Ports.' : undefined],
        ['logs', 'Befehl', `${rt} logs -f ${ref}`], ['exec', 'Befehl', `${rt} exec -it ${ref} sh`],
      ]),
      actionGroup(env, row),
    ]);
  }
  if (kind === 'images') {
    const tag = cell(row, 'tag');
    const name = tag === '' ? '' : `${cell(row, 'repository')}:${tag}`;
    const pullReason = tag === '' ? NO_TAG : IMAGE_NAME_TAG.test(name) ? undefined : INVALID_NAME;
    const value = cell(row, 'repository') || row.id.slice(0, 12);
    return assemble([
      [inspect, item(env, 'containers-with', 'Container mit diesem Image anzeigen', view({ type: 'showContainersWith', key: 'image', value }))],
      copyGroup(env, [
        ['ref', 'Referenz', name, tag === '' ? NO_TAG : undefined], ['id', 'ID', row.id],
        ['pull', 'Befehl', `${rt} pull ${name}`, pullReason],
      ]),
      actionGroup(env, row),
    ]);
  }
  if (kind === 'volumes') {
    return assemble([[inspect], copyGroup(env, [['name', 'Name', row.name], ['mountpoint', 'Mountpoint', cell(row, 'mountpoint') || undefined]]), actionGroup(env, row)]);
  }
  return assemble([
    [inspect, item(env, 'containers-with', 'Container in diesem Netzwerk anzeigen', view({ type: 'showContainersWith', key: 'networks', value: row.name }))],
    copyGroup(env, [['name', 'Name', row.name], ['id', 'ID', row.id]]),
  ]);
}

function dockMenu(env: Env, mode: ContainerDockMode, row: InventoryRow | null): ContainerMenuEntry[] {
  const context: ContainerCommandContext = { kind: env.ctx.state.kind, row, dock: mode, canPopout: env.ctx.canPopout };
  const reasonOf = (id: ContainerCommandId): string | undefined => CONTAINER_COMMANDS.find(command => command.id === id)?.unavailable?.(context);
  const popoutReason = reasonOf('popout');
  const target = row && (mode === 'logs' || mode === 'shell') ? terminalTargetOf(row, mode) : null;
  return assemble([
    [item(env, 'logs', 'Logs', view(dock('logs')), { hotkey: 'logs', reason: reasonOf('logs') }),
      item(env, 'shell', 'Shell', view(dock('shell')), { hotkey: 'shell', reason: reasonOf('shell') }),
      item(env, 'inspect', 'Inspect', view(dock('inspect')), { hotkey: 'inspect', reason: reasonOf('inspect') })],
    [...(mode === 'logs' && row ? [item(env, 'reload', 'Logs neu starten', { type: 'dockReload' })] : []),
      target ? item(env, 'popout', 'Als Tab öffnen', { type: 'popout', target }, { hotkey: 'popout', reason: popoutReason })
        // No target to open: a greyed entry with a no-op run.
        : item(env, 'popout', 'Als Tab öffnen', view(), { reason: popoutReason ?? 'Keine Zeile ausgewählt.' })],
    [item(env, 'toggle', 'Panel einklappen', view({ type: 'toggleDock' }), { hotkey: 'toggleDock' })],
  ]);
}

function headerMenu(env: Env, column: ContainerColumn): ContainerMenuEntry[] {
  const state = env.ctx.state;
  const kindView = state.views[state.kind];
  const option = groupOptionsFor(state.kind, state.inventory?.runtime ?? 'docker').find(candidate => candidate.id === column.key);
  const filtered = (kindView.filters[column.key] ?? '') !== '';
  return assemble([
    [item(env, 'sort-asc', 'Aufsteigend sortieren', view({ type: 'sort', key: column.key, dir: 'asc' })),
      item(env, 'sort-desc', 'Absteigend sortieren', view({ type: 'sort', key: column.key, dir: 'desc' })),
      item(env, 'sort-clear', 'Sortierung aufheben', view({ type: 'clearSort' }), { reason: kindView.sort === null ? SORT_HINT : undefined })],
    option ? [item(env, 'group', `Nach ${column.label} gruppieren`, view({ type: 'setGroupBy', groupBy: option.id }))] : [],
    [item(env, 'filter-clear', 'Filter dieser Spalte leeren', view({ type: 'setColumnFilter', key: column.key, value: '' }), { reason: filtered ? undefined : 'Kein Filter gesetzt.' })],
  ]);
}

function backgroundMenu(env: Env): ContainerMenuEntry[] {
  const state = env.ctx.state;
  const kindView = state.views[state.kind];
  return assemble([
    [item(env, 'filter-reset', 'Alle Filter zurücksetzen', view({ type: 'clearFilter' }), { hotkey: 'resetFilter' }),
      item(env, 'group-clear', 'Gruppierung aufheben', view({ type: 'setGroupBy', groupBy: null }), { reason: kindView.groupBy === null ? 'Keine Gruppierung aktiv.' : undefined }),
      item(env, 'sort-clear', 'Sortierung aufheben', view({ type: 'clearSort' }), { reason: kindView.sort === null ? SORT_HINT : undefined })],
    [item(env, 'reload', 'Aktualisieren', { type: 'reload' }, { hotkey: 'reload' }), item(env, 'help', 'Hilfe…', { type: 'help' }, { hotkey: 'help' })],
  ]);
}

export function menuFor(target: ContainerMenuTarget, context: ContainerMenuContext): ContainerMenuEntry[] {
  switch (target.type) {
    case 'row': return rowMenu({ ctx: context, hot: context.state.selected === target.row.uid }, target.row);
    case 'dock': return dockMenu({ ctx: context, hot: true }, target.mode, target.row);
    case 'header': return headerMenu({ ctx: context, hot: false }, target.column);
    case 'background': return backgroundMenu({ ctx: context, hot: true });
  }
}
