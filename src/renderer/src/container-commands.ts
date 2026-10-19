import { INVENTORY_ACTIONS, type ContainerDockMode, type InventoryAction, type InventoryKind, type InventoryRow } from '../../shared/containers';
import type { CommandGroup } from './kube-commands';
import { attentionChip } from './container-status';
import { t } from './i18n';

export type ContainerCommandId = 'down' | 'up' | 'tab' | 'menu' | 'help' | 'reload' | 'filter' | 'attention' | 'resetFilter'
  | 'logs' | 'shell' | 'inspect' | 'toggleDock' | 'popout' | 'restart' | 'stop' | 'remove';
/** Independent of the reducer; the view builds it. */
export interface ContainerCommandContext { kind: InventoryKind; row: InventoryRow | null; dock: ContainerDockMode; canPopout: boolean }
export interface ContainerCommand {
  id: ContainerCommandId;
  group: CommandGroup;
  description: string;
  /** Display form, e.g. ['↓', 'j']. */
  keys: string[];
  /** Matches KeyboardEvent.key plus modifiers, e.g. 'j', 'ArrowDown', 'Ctrl+d', 'Ctrl+Shift+T'. */
  bindings: string[];
  /** Undefined: available. A string: why not (shown greyed in the help). */
  unavailable?: (context: ContainerCommandContext) => string | undefined;
}

const noRow = (): string => t('containers:reasons.noRow');
const onlyContainers = (): string => t('containers:reasons.onlyContainers');
const notRunning = (): string => t('containers:reasons.notRunning');
const ACTIVE = new Set(['running', 'paused', 'restarting']);

/** Why `action` cannot run on `row` now; undefined = possible. Used by registry, menus and dock. */
export function actionUnavailable(row: InventoryRow | null, action: InventoryAction): string | undefined {
  if (!row) return noRow();
  const kind = row.ref.kind;
  if (!INVENTORY_ACTIONS[kind].includes(action)) return kind === 'networks' ? t('containers:reasons.networksReadOnly') : onlyContainers();
  const active = ACTIVE.has(row.state ?? '');
  if (kind === 'containers') {
    if (action === 'start' && active) return t('containers:reasons.alreadyRunning');
    if (action === 'stop' && !active) return notRunning();
    if (action === 'remove' && active) return t('containers:reasons.stopFirst');
  }
  if (action === 'remove' && (row.usedBy ?? 0) > 0) {
    if (kind === 'images') return t('containers:reasons.imageInUse');
    if (kind === 'volumes') return t('containers:reasons.volumeInUse');
  }
  return undefined;
}

const logsUnavailable = (context: ContainerCommandContext): string | undefined => context.kind === 'containers' ? undefined : onlyContainers();
const shellUnavailable = (context: ContainerCommandContext): string | undefined => {
  if (context.kind !== 'containers') return onlyContainers();
  if (!context.row) return noRow();
  return context.row.state === 'running' ? undefined : notRunning();
};
const forAction = (action: InventoryAction) => (context: ContainerCommandContext): string | undefined => actionUnavailable(context.row, action);

const DESCRIPTION_KEYS = {
  down: 'containers:commands.down', up: 'containers:commands.up', tab: 'containers:commands.tab', menu: 'containers:commands.menu',
  help: 'containers:commands.help', reload: 'containers:commands.reload', filter: 'containers:commands.filter',
  attention: 'containers:commands.attention', resetFilter: 'containers:commands.resetFilter', logs: 'containers:commands.logs',
  shell: 'containers:commands.shell', inspect: 'containers:commands.inspect', toggleDock: 'containers:commands.toggleDock',
  popout: 'containers:commands.popout', restart: 'containers:commands.restart', stop: 'containers:commands.stop',
  remove: 'containers:commands.remove',
} as const satisfies Record<ContainerCommandId, string>;

// `description` is a getter: it reads the language when it is used, not when the module loads.
const command = (id: ContainerCommandId, group: CommandGroup, keys: string[], bindings: string[],
  unavailable?: ContainerCommand['unavailable']): ContainerCommand => ({
  id, group, get description() { return t(DESCRIPTION_KEYS[id]); }, keys, bindings, ...(unavailable ? { unavailable } : {}),
});

export const CONTAINER_COMMANDS: readonly ContainerCommand[] = [
  command('down', 'navigation', ['↓', 'j'], ['j', 'ArrowDown']),
  command('up', 'navigation', ['↑', 'k'], ['k', 'ArrowUp']),
  command('tab', 'navigation', ['1–4'], ['1', '2', '3', '4']),
  command('menu', 'navigation', ['Shift+F10'], ['Shift+F10', 'ContextMenu', 'Shift+ContextMenu']),
  command('help', 'navigation', ['?'], ['?']),
  command('reload', 'view', ['F5'], ['F5']),
  command('filter', 'view', ['/'], ['/']),
  command('attention', 'view', ['w'], ['w'], context => attentionChip(context.kind) ? undefined : t('containers:reasons.noAttentionChip')),
  command('resetFilter', 'view', ['F'], ['F']),
  command('logs', 'view', ['l'], ['l'], logsUnavailable),
  command('shell', 'view', ['s'], ['s'], shellUnavailable),
  command('inspect', 'view', ['i'], ['i'], context => context.row ? undefined : noRow()),
  command('toggleDock', 'view', ['Ctrl+j'], ['Ctrl+j']),
  command('popout', 'view', ['Ctrl+Shift+T'], ['Ctrl+Shift+T'], context => {
    if (!context.canPopout) return t('containers:reasons.noPopout');
    if (context.dock === 'inspect') return t('containers:reasons.logsShellOnly');
    if (!context.row) return noRow();
    return context.dock === 'shell' ? shellUnavailable(context) : logsUnavailable(context);
  }),
  command('restart', 'actions', ['r'], ['r'], forAction('restart')),
  command('stop', 'actions', ['x'], ['x'], forAction('stop')),
  command('remove', 'actions', ['Ctrl+d'], ['Ctrl+d'], forAction('remove')),
];

export function commandForKey(binding: string): ContainerCommand | undefined {
  return CONTAINER_COMMANDS.find(command => command.bindings.includes(binding));
}
