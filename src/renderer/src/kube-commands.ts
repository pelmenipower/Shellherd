import { ACTION_KINDS, KIND_INFO, KUBE_KINDS, KUBE_NAME, MAX_REPLICAS, NOT_CONNECTED_MESSAGE, READ_ONLY_MESSAGE, refKey, type KubeAction, type KubeKind, type KubeRef, type KubeRow } from '../../shared/kubernetes';
import { attentionChip, CHIPS, knownChips } from '../../shared/kube-status';
import { visibleRows, type KubeViewState } from './kube-view';

export type CommandGroup = 'Navigation' | 'Ansicht' | 'Aktionen';
export type CommandId = 'down' | 'up' | 'drill' | 'back' | 'filter' | 'command' | 'tab' | 'logs' | 'shell' | 'events' | 'yaml'
  | 'describe' | 'previous' | 'menu' | 'restart' | 'scale' | 'delete' | 'toggleDock' | 'popout' | 'help' | 'kind' | 'namespace' | 'attention' | 'resetFilter' | 'status';
export interface CommandContext { state: KubeViewState; readOnly: boolean }
export interface KubeCommand {
  id: CommandId;
  group: CommandGroup;
  description: string;
  /** Display form, e.g. ['↓', 'j']. */
  keys: string[];
  /** Matches KeyboardEvent.key plus modifiers, e.g. 'j', 'ArrowDown', 'Ctrl+d', 'Ctrl+Shift+T', 'S'. */
  bindings: string[];
  /** `:` command with syntax for the help, e.g. { name: 'ns', syntax: ':ns <name|all>', example: ':ns shop' }. */
  command?: { name: string; syntax: string; example: string };
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
  /** Kind of the current table, used when ref is null. */
  kind?: KubeKind;
}

/** Undefined when the action may run on ref; otherwise the German reason. Order: readOnly, connected, kind (ref.kind, else context.kind), ref. */
export function actionReason(action: KubeAction, context: ActionContext): string | undefined {
  if (context.readOnly) return READ_ONLY_MESSAGE;
  if (!context.connected) return NOT_CONNECTED_MESSAGE;
  const kind = context.ref?.kind ?? context.kind;
  if (kind && !ACTION_KINDS[action].includes(kind)) return WRONG_KIND[action];
  if (!context.ref) return 'Wähle zuerst eine Zeile.';
  return undefined;
}

const actionUnavailable = (action: KubeAction) => (context: CommandContext): string | undefined => actionReason(action, {
  ref: selectedRow(context.state)?.ref ?? null, readOnly: context.readOnly, connected: context.state.status?.state === 'ready',
  kind: context.state.containersOf ? 'pods' : context.state.query.kind,
});

const shellUnavailable = (context: CommandContext): string | undefined => {
  if (context.readOnly) return READ_ONLY_MESSAGE;
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
  { id: 'command', group: 'Navigation', description: 'Befehlszeile öffnen', keys: [':'], bindings: [':'] },
  { id: 'kind', group: 'Navigation', description: 'Ressourcentyp wechseln', keys: [], bindings: [],
    command: { name: 'pods', syntax: KUBE_KINDS.map(kind => `:${KIND_INFO[kind].command}`).join(' | '), example: ':deploy' } },
  { id: 'namespace', group: 'Navigation', description: 'Namespace wechseln', keys: [], bindings: [],
    command: { name: 'ns', syntax: ':ns <name|all>', example: ':ns shop' } },
  { id: 'help', group: 'Navigation', description: 'Hilfe mit allen Tasten und Befehlen', keys: ['?'], bindings: ['?'],
    command: { name: 'help', syntax: ':help', example: ':help' } },
  { id: 'filter', group: 'Ansicht', description: 'Suchen: Freitext, Qualifier, Labels', keys: ['/'], bindings: ['/'],
    command: { name: 'filter', syntax: ':filter <suche>', example: ':filter status:crash' } },
  { id: 'attention', group: 'Ansicht', description: 'Nur auffällige Zeilen ein/aus (Events: Warning)', keys: ['w'], bindings: ['w'],
    unavailable: context => attentionChip(context.state.query.kind) ? undefined : 'Dieser Reiter hat keinen Chip „Auffällig“.' },
  { id: 'resetFilter', group: 'Ansicht', description: 'Suche und Status-Filter des Reiters zurücksetzen', keys: ['F'], bindings: ['F'] },
  { id: 'status', group: 'Ansicht', description: 'Status-Filter setzen', keys: [], bindings: [],
    command: { name: 'status', syntax: ':status <id>[,<id>] | :status alle', example: ':status failed,waiting' } },
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
    command: { name: 'restart', syntax: ':restart', example: ':restart' },
    unavailable: actionUnavailable('restart') },
  { id: 'scale', group: 'Aktionen', description: 'Replikate skalieren', keys: ['S'], bindings: ['S'],
    command: { name: 'scale', syntax: ':scale <0–1000>', example: ':scale 3' },
    unavailable: actionUnavailable('scale') },
  { id: 'delete', group: 'Aktionen', description: 'Pod oder Job löschen', keys: ['Ctrl+d'], bindings: ['Ctrl+d'],
    command: { name: 'delete', syntax: ':delete', example: ':delete' },
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

export type ParsedCommand =
  | { id: 'kind'; kind: KubeKind } | { id: 'namespace'; namespace: string | null } | { id: 'scale'; replicas: number }
  | { id: 'filter'; text: string } | { id: 'status'; chips: string[] | 'all' }
  | { id: 'restart' } | { id: 'delete' } | { id: 'help' } | { error: string };

/** Command names that take an argument; their completion ends with a space. */
const TAKES_ARGUMENT = new Set(['ns', 'scale', 'filter', 'status']);
const PLAIN_COMMANDS = ['delete', 'filter', 'help', 'ns', 'restart', 'scale', 'status'];

export function parseCommandLine(line: string): ParsedCommand {
  const text = line.trim().replace(/^:/, '');
  if (text === '') return { error: 'Kein Befehl eingegeben.' };
  const [name, ...rest] = text.split(/\s+/);
  const arg = rest.join(' ');

  const kind = KUBE_KINDS.find(candidate => KIND_INFO[candidate].command === name);
  if (kind) return { id: 'kind', kind };

  switch (name) {
    case 'ns':
      if (arg === '') return { error: 'Namespace fehlt. Syntax: :ns <name|all>' };
      if (arg === 'all') return { id: 'namespace', namespace: null };
      if (!KUBE_NAME.test(arg)) return { error: `Ungültiger Namespace „${arg}“.` };
      return { id: 'namespace', namespace: arg };
    case 'scale': {
      const replicas = /^\d+$/.test(arg) ? Number(arg) : NaN;
      if (!(replicas <= MAX_REPLICAS)) return { error: `Replicas: ganze Zahl von 0 bis ${MAX_REPLICAS}.` };
      return { id: 'scale', replicas };
    }
    case 'filter':
      return { id: 'filter', text: text.slice(name.length).trim() };
    case 'status': {
      if (arg === '') return { error: 'Status fehlt. Syntax: :status <id>[,<id>] | :status alle' };
      if (arg === 'alle' || arg === 'all') return { id: 'status', chips: 'all' };
      return { id: 'status', chips: arg.toLowerCase().split(',').map(part => part.trim()).filter(Boolean) };
    }
    case 'restart':
      return { id: 'restart' };
    case 'delete':
      return { id: 'delete' };
    case 'help':
      return { id: 'help' };
    default:
      return { error: `Unbekannter Befehl „${name}“. Mit ? siehst du alle Befehle.` };
  }
}

/** New chip list for `:status`: replaces the chips of the groups the ids belong to, keeps other groups; 'all' clears. */
export function applyStatusCommand(kind: KubeKind, current: readonly string[], chips: string[] | 'all'): string[] | { error: string } {
  if (chips === 'all') return [];
  const defs = CHIPS[kind];
  if (defs.length === 0) return { error: `Für ${KIND_INFO[kind].label} gibt es keine Status-Filter.` };
  const unknown = chips.find(id => !defs.some(def => def.id === id));
  if (unknown !== undefined) return { error: `Unbekannter Status „${unknown}“. Möglich: ${defs.map(def => def.id).join(', ')}` };
  const groups = new Set(defs.filter(def => chips.includes(def.id)).map(def => def.group));
  const kept = knownChips(kind, current).filter(id => !groups.has(defs.find(def => def.id === id)!.group));
  return [...kept, ...knownChips(kind, chips)];
}

/** chipIds: chip ids of the current kind for `:status` completion. */
export function completions(prefix: string, namespaces: string[], chipIds?: string[]): string[] {
  const text = prefix.replace(/^:/, '');
  const space = text.indexOf(' ');
  if (space === -1) {
    const names = [...KUBE_KINDS.map(kind => KIND_INFO[kind].command), ...PLAIN_COMMANDS].sort();
    return names
      .filter(name => name.startsWith(text))
      .map(name => `:${name}${TAKES_ARGUMENT.has(name) ? ' ' : ''}`);
  }
  const name = text.slice(0, space);
  if (name === 'status') {
    if (!chipIds) return [];
    const argument = text.slice(space + 1);
    const comma = argument.lastIndexOf(',');
    const head = argument.slice(0, comma + 1);
    return ['alle', ...chipIds].sort()
      .filter(id => id.startsWith(argument.slice(comma + 1)))
      .map(id => `:status ${head}${id}`);
  }
  if (name !== 'ns') return [];
  const argument = text.slice(space + 1);
  return ['all', ...namespaces].sort()
    .filter(name => name.startsWith(argument))
    .map(name => `:ns ${name}`);
}
