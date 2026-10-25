import { ACTION_KINDS, refKey, type ClusterStatus, type KubeAction, type KubeKind, type KubeRef, type KubeRow } from '../../shared/kubernetes';
import { attentionChip } from '../../shared/kube-status';
import { actionAccess } from '../../shared/kube-access';
import { refAccessReason, type KubeAccessMap } from './kube-access';
import { visibleRows, type KubeViewState } from './kube-view';
import { t } from './i18n';

export type CommandGroup = 'navigation' | 'view' | 'actions';
export type CommandId = 'down' | 'up' | 'drill' | 'back' | 'filter' | 'tab' | 'logs' | 'shell' | 'events' | 'yaml'
  | 'describe' | 'previous' | 'menu' | 'restart' | 'scale' | 'delete' | 'toggleDock' | 'popout' | 'help' | 'attention' | 'resetFilter';
export interface CommandContext { state: KubeViewState; readOnly: boolean }
export interface KubeCommand {
  id: CommandId;
  group: CommandGroup;
  /** Display form, e.g. ['↓', 'j']. */
  keys: string[];
  /** Matches KeyboardEvent.key plus modifiers, e.g. 'j', 'ArrowDown', 'Ctrl+d', 'Ctrl+Shift+T', 'S'. */
  bindings: string[];
  /** Undefined: available. A string: why not (shown greyed in the help). */
  unavailable?: (context: CommandContext) => string | undefined;
}

/** The row an action would hit: the pod drilled into, else the selected row. */
const selectedRow = (state: KubeViewState): KubeRow | null =>
  state.containersOf ?? visibleRows(state).find(row => refKey(row.ref) === state.selected) ?? null;

/** Pods that cannot take logs or a shell right now. */
export const podNotRunning = (row: KubeRow | null): boolean => row?.cells.status === 'Completed' || row?.cells.status === 'Terminating';

const onlyForPods = (context: CommandContext): string | undefined =>
  context.state.query.kind === 'pods' || context.state.containersOf !== null ? undefined : t('kubeActions:reasons.onlyPods');

/** Keys, not texts: the reason is resolved when asked, in the current language. */
const WRONG_KIND_KEYS = {
  restart: 'kubeActions:reasons.wrongKind.restart', scale: 'kubeActions:reasons.wrongKind.scale', delete: 'kubeActions:reasons.wrongKind.delete',
  cordon: 'kubeActions:reasons.wrongKind.node', uncordon: 'kubeActions:reasons.wrongKind.node', suspend: 'kubeActions:reasons.wrongKind.cronjob',
  resume: 'kubeActions:reasons.wrongKind.cronjob', trigger: 'kubeActions:reasons.wrongKind.cronjob',
} as const satisfies Record<KubeAction, string>;

export interface ActionContext {
  ref: KubeRef | null;
  readOnly: boolean;
  connected: boolean;
  /** Not connected because the cluster is reconnecting: the reason says so. */
  reconnecting?: boolean;
  /** Kind of the current table, used when ref is null. */
  kind?: KubeKind;
  /** RBAC pre-check per namespace; absent or unknown = allowed. */
  access?: KubeAccessMap;
  status?: ClusterStatus | null;
}

/** Undefined when the action may run on ref; otherwise the localized reason. Order: readOnly, connected, kind (ref.kind, else context.kind), ref, rights. */
export function actionReason(action: KubeAction, context: ActionContext): string | undefined {
  if (context.readOnly) return t('errors:kubernetes.readOnly');
  if (!context.connected) return context.reconnecting ? t('kubeActions:reasons.reconnecting') : t('errors:kubernetes.notConnected');
  const kind = context.ref?.kind ?? context.kind;
  if (kind && !ACTION_KINDS[action].includes(kind)) return t(WRONG_KIND_KEYS[action]);
  if (!context.ref) return t('kubeActions:reasons.selectRow');
  const id = context.access ? actionAccess(action, context.ref.kind) : undefined;
  return id && context.access ? refAccessReason(context.access, context.status ?? null, context.ref, id) : undefined;
}

const actionUnavailable = (action: KubeAction) => (context: CommandContext): string | undefined => actionReason(action, {
  ref: selectedRow(context.state)?.ref ?? null, readOnly: context.readOnly, connected: context.state.status?.state === 'ready', reconnecting: context.state.status?.state === 'reconnecting',
  kind: context.state.containersOf ? 'pods' : context.state.query.kind, access: context.state.access, status: context.state.status,
});

/** The right of the selected row (the pod drilled into, else the selection); nothing is greyed out when unknown. */
const accessOfSelection = (context: CommandContext, id: 'logs' | 'shell'): string | undefined => {
  const row = selectedRow(context.state);
  return row ? refAccessReason(context.state.access, context.state.status, row.ref, id) : undefined;
};

const shellUnavailable = (context: CommandContext): string | undefined => {
  if (context.readOnly) return t('errors:kubernetes.readOnly');
  if (context.state.status?.state === 'reconnecting') return t('kubeActions:reasons.reconnecting');
  if (context.state.status?.state !== 'ready') return t('errors:kubernetes.notConnected');
  return onlyForPods(context) ?? (podNotRunning(selectedRow(context.state)) ? t('kubeActions:reasons.notRunning') : undefined) ?? accessOfSelection(context, 'shell');
};

export const KUBE_COMMANDS: KubeCommand[] = [
  { id: 'down', group: 'navigation', keys: ['↓', 'j'], bindings: ['j', 'ArrowDown'] },
  { id: 'up', group: 'navigation', keys: ['↑', 'k'], bindings: ['k', 'ArrowUp'] },
  { id: 'drill', group: 'navigation', keys: ['Enter'], bindings: ['Enter'] },
  { id: 'back', group: 'navigation', keys: ['Esc', '⌫'], bindings: ['Escape', 'Backspace'] },
  { id: 'menu', group: 'navigation', keys: ['Shift+F10'], bindings: ['Shift+F10', 'ContextMenu', 'Shift+ContextMenu'] },
  { id: 'tab', group: 'navigation', keys: ['1–9', '0'], bindings: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] },
  { id: 'help', group: 'navigation', keys: ['?'], bindings: ['?'] },
  { id: 'filter', group: 'view', keys: ['/'], bindings: ['/'],
    unavailable: context => context.state.containersOf ? t('kubeActions:reasons.noFiltersInContainerList') : undefined },
  { id: 'attention', group: 'view', keys: ['w'], bindings: ['w'],
    unavailable: context => attentionChip(context.state.query.kind) ? undefined : t('kubeActions:reasons.noAttentionChip') },
  { id: 'resetFilter', group: 'view', keys: ['F'], bindings: ['F'] },
  { id: 'logs', group: 'view', keys: ['l'], bindings: ['l'], unavailable: context => onlyForPods(context) ?? accessOfSelection(context, 'logs') },
  { id: 'previous', group: 'view', keys: ['p'], bindings: ['p'], unavailable: context => onlyForPods(context) ?? accessOfSelection(context, 'logs') },
  { id: 'shell', group: 'view', keys: ['s'], bindings: ['s'],
    unavailable: shellUnavailable },
  { id: 'events', group: 'view', keys: ['e'], bindings: ['e'] },
  { id: 'yaml', group: 'view', keys: ['y'], bindings: ['y'] },
  { id: 'describe', group: 'view', keys: ['d'], bindings: ['d'] },
  { id: 'toggleDock', group: 'view', keys: ['Ctrl+j'], bindings: ['Ctrl+j'] },
  { id: 'popout', group: 'view', keys: ['Ctrl+Shift+T'], bindings: ['Ctrl+Shift+T'] },
  { id: 'restart', group: 'actions', keys: ['r'], bindings: ['r'],
    unavailable: actionUnavailable('restart') },
  { id: 'scale', group: 'actions', keys: ['S'], bindings: ['S'],
    unavailable: actionUnavailable('scale') },
  { id: 'delete', group: 'actions', keys: ['Ctrl+d'], bindings: ['Ctrl+d'],
    unavailable: actionUnavailable('delete') },
];

const COMMAND_DESCRIPTION_KEYS = {
  down: 'kubeActions:commands.down', up: 'kubeActions:commands.up', drill: 'kubeActions:commands.drill', back: 'kubeActions:commands.back',
  filter: 'kubeActions:commands.filter', tab: 'kubeActions:commands.tab', logs: 'kubeActions:commands.logs', shell: 'kubeActions:commands.shell',
  events: 'kubeActions:commands.events', yaml: 'kubeActions:commands.yaml', describe: 'kubeActions:commands.describe',
  previous: 'kubeActions:commands.previous', menu: 'kubeActions:commands.menu', restart: 'kubeActions:commands.restart',
  scale: 'kubeActions:commands.scale', delete: 'kubeActions:commands.delete', toggleDock: 'kubeActions:commands.toggleDock',
  popout: 'kubeActions:commands.popout', help: 'kubeActions:commands.help', attention: 'kubeActions:commands.attention',
  resetFilter: 'kubeActions:commands.resetFilter',
} as const satisfies Record<CommandId, string>;

/** Localized description of a command, for the help overlay. */
export function commandDescription(command: KubeCommand): string {
  return t(COMMAND_DESCRIPTION_KEYS[command.id]);
}

export function bindingOf(event: { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }): string {
  const modifiers = event.ctrlKey || event.altKey || event.metaKey;
  return [
    event.ctrlKey ? 'Ctrl' : '',
    event.altKey ? 'Alt' : '',
    event.metaKey ? 'Meta' : '',
    event.shiftKey && (modifiers || event.key.length > 1) ? 'Shift' : '',
    event.key,
  ].filter(Boolean).join('+');
}

export function commandForKey(binding: string): KubeCommand | undefined {
  return KUBE_COMMANDS.find(command => command.bindings.includes(binding));
}
