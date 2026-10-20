/** Context menus of the container view as pure data; see docs/superpowers/specs/2026-10-18-container-view-validation.md (C24-C27). */
import { IMAGE_NAME_TAG, type ContainerDockMode, type InventoryAction, type InventoryRow, type TerminalTarget } from '../../shared/containers';
import { columnLabel, groupOptionsFor, type ContainerColumn } from './container-columns';
import { t } from './i18n';
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

const noPopout = (): string => t('containers:reasons.noPopout');
const notRunning = (): string => t('containers:reasons.notRunning');
const noTag = (): string => t('containers:reasons.noTag');
const sortHint = (): string => t('containers:reasons.sortHint');

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
  return items.length === 0 ? [] : [{ kind: 'heading', label: t('common:actions.copy') }, ...items];
}

function actionGroup(env: Env, row: InventoryRow): Group {
  const kind = row.ref.kind;
  if (kind === 'networks') return [];
  const all: [InventoryAction, string, ContainerCommandId | undefined][] = [
    ['start', t('containers:menu.start'), undefined], ['stop', t('containers:menu.stop'), 'stop'],
    ['restart', t('containers:menu.restart'), 'restart'], ['remove', t('containers:menu.remove'), 'remove'],
  ];
  const wanted = kind === 'containers' ? all : all.filter(([action]) => action === 'remove');
  return [{ kind: 'heading', label: t('containers:menu.actions') },
    ...wanted.map(([action, label, hotkey]) => item(env, action, label, { type: 'containerAction', row, action }, { hotkey, reason: actionUnavailable(row, action) }))];
}

function rowMenu(env: Env, row: InventoryRow): ContainerMenuEntry[] {
  const kind = row.ref.kind;
  const rt = row.ref.runtime;
  const inspect = item(env, 'inspect', t('containers:menu.inspect'), view(select(row), dock('inspect')), { hotkey: 'inspect' });
  if (kind === 'containers') {
    const running = row.state === 'running';
    const tab = (mode: 'logs' | 'shell'): ContainerMenuEntry => item(env, `tab-${mode}`, mode === 'logs' ? t('containers:menu.logsTab') : t('containers:menu.shellTab'),
      { type: 'popout', target: terminalTargetOf(row, mode) }, { reason: env.ctx.canPopout ? undefined : noPopout() });
    const chip = primaryChip('containers', row);
    const ref = row.ref.ref;
    const ports = cell(row, 'ports');
    return assemble([
      [item(env, 'logs', t('containers:menu.logs'), view(select(row), dock('logs')), { hotkey: 'logs' }),
        item(env, 'shell', t('containers:menu.shellOpen'), view(select(row), dock('shell'), { type: 'arm' }), { hotkey: 'shell', reason: running ? undefined : notRunning() }),
        inspect],
      [tab('logs'), ...(running ? [tab('shell')] : [])],
      [...(row.project ? [item(env, 'project', t('containers:menu.onlyProject', { project: row.project }), view({ type: 'setColumnFilter', key: 'project', value: row.project }))] : []),
        ...(chip ? [item(env, 'chip', t('containers:menu.onlyChip', { chip: chip.label }), view({ type: 'setChips', ids: [chip.id] }))] : [])],
      copyGroup(env, [
        ['name', columnLabel('name'), row.name], ['id', columnLabel('id'), row.id], ['image', columnLabel('image'), cell(row, 'image') || undefined],
        ['ports', columnLabel('ports'), ports, ports === '' ? t('containers:reasons.noPorts') : undefined],
        ['logs', t('containers:menu.copyCommand'), `${rt} logs -f ${ref}`], ['exec', t('containers:menu.copyCommand'), `${rt} exec -it ${ref} sh`],
      ]),
      actionGroup(env, row),
    ]);
  }
  if (kind === 'images') {
    const tag = cell(row, 'tag');
    const name = tag === '' ? '' : `${cell(row, 'repository')}:${tag}`;
    const pullReason = tag === '' ? noTag() : IMAGE_NAME_TAG.test(name) ? undefined : t('containers:reasons.invalidName');
    const value = cell(row, 'repository') || row.id.slice(0, 12);
    return assemble([
      [inspect, item(env, 'containers-with', t('containers:menu.containersWithImage'), view({ type: 'showContainersWith', key: 'image', value }))],
      copyGroup(env, [
        ['ref', t('containers:menu.copyReference'), name, tag === '' ? noTag() : undefined], ['id', columnLabel('id'), row.id],
        ['pull', t('containers:menu.copyCommand'), `${rt} pull ${name}`, pullReason],
      ]),
      actionGroup(env, row),
    ]);
  }
  if (kind === 'volumes') {
    return assemble([[inspect], copyGroup(env, [['name', columnLabel('name'), row.name], ['mountpoint', columnLabel('mountpoint'), cell(row, 'mountpoint') || undefined]]), actionGroup(env, row)]);
  }
  return assemble([
    [inspect, item(env, 'containers-with', t('containers:menu.containersInNetwork'), view({ type: 'showContainersWith', key: 'networks', value: row.name }))],
    copyGroup(env, [['name', columnLabel('name'), row.name], ['id', columnLabel('id'), row.id]]),
  ]);
}

function dockMenu(env: Env, mode: ContainerDockMode, row: InventoryRow | null): ContainerMenuEntry[] {
  const context: ContainerCommandContext = { kind: env.ctx.state.kind, row, dock: mode, canPopout: env.ctx.canPopout };
  const reasonOf = (id: ContainerCommandId): string | undefined => CONTAINER_COMMANDS.find(command => command.id === id)?.unavailable?.(context);
  const popoutReason = reasonOf('popout');
  const target = row && (mode === 'logs' || mode === 'shell') ? terminalTargetOf(row, mode) : null;
  return assemble([
    [item(env, 'logs', t('containers:menu.logs'), view(dock('logs')), { hotkey: 'logs', reason: reasonOf('logs') }),
      item(env, 'shell', t('containers:menu.shell'), view(dock('shell')), { hotkey: 'shell', reason: reasonOf('shell') }),
      item(env, 'inspect', t('containers:menu.inspect'), view(dock('inspect')), { hotkey: 'inspect', reason: reasonOf('inspect') })],
    [...(mode === 'logs' && row ? [item(env, 'reload', t('containers:menu.restartLogs'), { type: 'dockReload' })] : []),
      target ? item(env, 'popout', t('containers:menu.popout'), { type: 'popout', target }, { hotkey: 'popout', reason: popoutReason })
        // No target to open: a greyed entry with a no-op run.
        : item(env, 'popout', t('containers:menu.popout'), view(), { reason: popoutReason ?? t('containers:reasons.noRow') })],
    [item(env, 'toggle', t('containers:menu.collapse'), view({ type: 'toggleDock' }), { hotkey: 'toggleDock' })],
  ]);
}

function headerMenu(env: Env, column: ContainerColumn): ContainerMenuEntry[] {
  const state = env.ctx.state;
  const kindView = state.views[state.kind];
  const option = groupOptionsFor(state.kind, state.inventory?.runtime ?? 'docker').find(candidate => candidate.id === column.key);
  const filtered = (kindView.filters[column.key] ?? '') !== '';
  return assemble([
    [item(env, 'sort-asc', t('containers:menu.sortAsc'), view({ type: 'sort', key: column.key, dir: 'asc' })),
      item(env, 'sort-desc', t('containers:menu.sortDesc'), view({ type: 'sort', key: column.key, dir: 'desc' })),
      item(env, 'sort-clear', t('containers:menu.sortClear'), view({ type: 'clearSort' }), { reason: kindView.sort === null ? sortHint() : undefined })],
    option ? [item(env, 'group', t('containers:menu.groupBy', { column: column.label }), view({ type: 'setGroupBy', groupBy: option.id }))] : [],
    [item(env, 'filter-clear', t('containers:menu.filterClear'), view({ type: 'setColumnFilter', key: column.key, value: '' }), { reason: filtered ? undefined : t('containers:reasons.noFilter') })],
  ]);
}

function backgroundMenu(env: Env): ContainerMenuEntry[] {
  const state = env.ctx.state;
  const kindView = state.views[state.kind];
  return assemble([
    [item(env, 'filter-reset', t('containers:menu.filterReset'), view({ type: 'clearFilter' }), { hotkey: 'resetFilter' }),
      item(env, 'group-clear', t('containers:menu.groupClear'), view({ type: 'setGroupBy', groupBy: null }), { reason: kindView.groupBy === null ? t('containers:reasons.noGrouping') : undefined }),
      item(env, 'sort-clear', t('containers:menu.sortClear'), view({ type: 'clearSort' }), { reason: kindView.sort === null ? sortHint() : undefined })],
    [item(env, 'reload', t('containers:refresh'), { type: 'reload' }, { hotkey: 'reload' }), item(env, 'help', t('containers:menu.help'), { type: 'help' }, { hotkey: 'help' })],
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
