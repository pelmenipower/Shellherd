import { ACTION_KINDS, NOT_CONNECTED_MESSAGE, READ_ONLY_MESSAGE, RECONNECTING_MESSAGE, refKey, type KubeAction, type KubeKind, type KubeRef, type KubeRow } from '../../shared/kubernetes';
import { attentionChip } from '../../shared/kube-status';
import { visibleRows, type KubeViewState } from './kube-view';

export type CommandGroup = 'Navigation' | 'Ansicht' | 'Aktionen';
export type CommandId = 'down' | 'up' | 'drill' | 'back' | 'filter' | 'tab' | 'logs' | 'shell' | 'events' | 'yaml'
  | 'describe' | 'previous' | 'menu' | 'restart' | 'scale' | 'delete' | 'toggleDock' | 'popout' | 'help' | 'attention' | 'resetFilter';
export interface CommandContext { state: KubeViewState; readOnly: boolean }
export interface KubeCommand {
  id: CommandId;
  group: CommandGroup;
  description: string;
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
  context.state.query.kind === 'pods' || context.state.containersOf !== null ? undefined : 'Nur für Pods.';

const WRONG_KIND: Record<KubeAction, string> = {
  restart: 'Nur für Deployments, StatefulSets und DaemonSets.', scale: 'Nur für Deployments und StatefulSets.', delete: 'Nur für Pods und Jobs.',
  cordon: 'Nur für Nodes.', uncordon: 'Nur für Nodes.', suspend: 'Nur für CronJobs.', resume: 'Nur für CronJobs.', trigger: 'Nur für CronJobs.',
};

export interface ActionContext {
  ref: KubeRef | null;
  readOnly: boolean;
  connected: boolean;
  /** Not connected because the cluster is reconnecting: the reason says so. */
  reconnecting?: boolean;
  /** Kind of the current table, used when ref is null. */
  kind?: KubeKind;
}

/** Undefined when the action may run on ref; otherwise the German reason. Order: readOnly, connected, kind (ref.kind, else context.kind), ref. */
export function actionReason(action: KubeAction, context: ActionContext): string | undefined {
  if (context.readOnly) return READ_ONLY_MESSAGE;
  if (!context.connected) return context.reconnecting ? RECONNECTING_MESSAGE : NOT_CONNECTED_MESSAGE;
  const kind = context.ref?.kind ?? context.kind;
  if (kind && !ACTION_KINDS[action].includes(kind)) return WRONG_KIND[action];
  if (!context.ref) return 'Wähle zuerst eine Zeile.';
  return undefined;
}

const actionUnavailable = (action: KubeAction) => (context: CommandContext): string | undefined => actionReason(action, {
  ref: selectedRow(context.state)?.ref ?? null, readOnly: context.readOnly, connected: context.state.status?.state === 'ready', reconnecting: context.state.status?.state === 'reconnecting',
  kind: context.state.containersOf ? 'pods' : context.state.query.kind,
});

const shellUnavailable = (context: CommandContext): string | undefined => {
  if (context.readOnly) return READ_ONLY_MESSAGE;
  if (context.state.status?.state === 'reconnecting') return RECONNECTING_MESSAGE;
  if (context.state.status?.state !== 'ready') return NOT_CONNECTED_MESSAGE;
  return onlyForPods(context) ?? (podNotRunning(selectedRow(context.state)) ? 'Der Pod läuft nicht.' : undefined);
};

export const KUBE_COMMANDS: KubeCommand[] = [
  { id: 'down', group: 'Navigation', description: 'Zeile nach unten', keys: ['↓', 'j'], bindings: ['j', 'ArrowDown'] },
  { id: 'up', group: 'Navigation', description: 'Zeile nach oben', keys: ['↑', 'k'], bindings: ['k', 'ArrowUp'] },
  { id: 'drill', group: 'Navigation', description: 'Öffnen: Ressource, Pods eines Workloads oder Container', keys: ['Enter'], bindings: ['Enter'] },
  { id: 'back', group: 'Navigation', description: 'Eine Ebene zurück', keys: ['Esc', '⌫'], bindings: ['Escape', 'Backspace'] },
  { id: 'menu', group: 'Navigation', description: 'Kontextmenü der Zeile öffnen', keys: ['Shift+F10'], bindings: ['Shift+F10', 'ContextMenu', 'Shift+ContextMenu'] },
  { id: 'tab', group: 'Navigation', description: 'Tab wechseln (1–9, 0 für den zehnten)', keys: ['1–9', '0'], bindings: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] },
  { id: 'help', group: 'Navigation', description: 'Hilfe mit allen Tasten und Filtern', keys: ['?'], bindings: ['?'] },
  { id: 'filter', group: 'Ansicht', description: 'Name filtern (Events: Meldung)', keys: ['/'], bindings: ['/'],
    unavailable: context => context.state.containersOf ? 'In der Container-Liste gibt es keine Filter.' : undefined },
  { id: 'attention', group: 'Ansicht', description: 'Nur auffällige Zeilen ein/aus (Events: Warning)', keys: ['w'], bindings: ['w'],
    unavailable: context => attentionChip(context.state.query.kind) ? undefined : 'Dieser Reiter hat keinen Chip „Auffällig“.' },
  { id: 'resetFilter', group: 'Ansicht', description: 'Alle Filter des Reiters zurücksetzen (Gruppierung bleibt)', keys: ['F'], bindings: ['F'] },
  { id: 'logs', group: 'Ansicht', description: 'Logs des Pods anzeigen', keys: ['l'], bindings: ['l'], unavailable: onlyForPods },
  { id: 'previous', group: 'Ansicht', description: 'Logs des vorherigen Containers anzeigen', keys: ['p'], bindings: ['p'], unavailable: onlyForPods },
  { id: 'shell', group: 'Ansicht', description: 'Shell im Container öffnen', keys: ['s'], bindings: ['s'],
    unavailable: shellUnavailable },
  { id: 'events', group: 'Ansicht', description: 'Ereignisse anzeigen', keys: ['e'], bindings: ['e'] },
  { id: 'yaml', group: 'Ansicht', description: 'YAML anzeigen', keys: ['y'], bindings: ['y'] },
  { id: 'describe', group: 'Ansicht', description: 'Describe anzeigen', keys: ['d'], bindings: ['d'] },
  { id: 'toggleDock', group: 'Ansicht', description: 'Unteres Panel ein- und ausblenden', keys: ['Ctrl+j'], bindings: ['Ctrl+j'] },
  { id: 'popout', group: 'Ansicht', description: 'Ansicht in eigenem Fenster öffnen', keys: ['Ctrl+Shift+T'], bindings: ['Ctrl+Shift+T'] },
  { id: 'restart', group: 'Aktionen', description: 'Workload neu starten', keys: ['r'], bindings: ['r'],
    unavailable: actionUnavailable('restart') },
  { id: 'scale', group: 'Aktionen', description: 'Replikate skalieren', keys: ['S'], bindings: ['S'],
    unavailable: actionUnavailable('scale') },
  { id: 'delete', group: 'Aktionen', description: 'Pod oder Job löschen', keys: ['Ctrl+d'], bindings: ['Ctrl+d'],
    unavailable: actionUnavailable('delete') },
];

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
