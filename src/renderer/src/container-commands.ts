import { INVENTORY_ACTIONS, type ContainerDockMode, type InventoryAction, type InventoryKind, type InventoryRow } from '../../shared/containers';
import type { CommandGroup } from './kube-commands';
import { attentionChip } from './container-status';

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

const NO_ROW = 'Keine Zeile ausgewählt.';
const ONLY_CONTAINERS = 'Nur für Container.';
const ACTIVE = new Set(['running', 'paused', 'restarting']);

/** Why `action` cannot run on `row` now; undefined = possible. Used by registry, menus and dock. */
export function actionUnavailable(row: InventoryRow | null, action: InventoryAction): string | undefined {
  if (!row) return NO_ROW;
  const kind = row.ref.kind;
  if (!INVENTORY_ACTIONS[kind].includes(action)) return kind === 'networks' ? 'Netzwerke lassen sich hier nicht ändern.' : ONLY_CONTAINERS;
  const active = ACTIVE.has(row.state ?? '');
  if (kind === 'containers') {
    if (action === 'start' && active) return 'Der Container läuft bereits.';
    if (action === 'stop' && !active) return 'Der Container läuft nicht.';
    if (action === 'remove' && active) return 'Laufende Container zuerst stoppen.';
  }
  if (action === 'remove' && (row.usedBy ?? 0) > 0) {
    if (kind === 'images') return 'Das Image wird noch benutzt.';
    if (kind === 'volumes') return 'Das Volume wird noch benutzt.';
  }
  return undefined;
}

const logsUnavailable = (context: ContainerCommandContext): string | undefined => context.kind === 'containers' ? undefined : ONLY_CONTAINERS;
const shellUnavailable = (context: ContainerCommandContext): string | undefined => {
  if (context.kind !== 'containers') return ONLY_CONTAINERS;
  return context.row?.state === 'running' ? undefined : 'Der Container läuft nicht.';
};
const forAction = (action: InventoryAction) => (context: ContainerCommandContext): string | undefined => actionUnavailable(context.row, action);

export const CONTAINER_COMMANDS: readonly ContainerCommand[] = [
  { id: 'down', group: 'Navigation', description: 'Zeile nach unten', keys: ['↓', 'j'], bindings: ['j', 'ArrowDown'] },
  { id: 'up', group: 'Navigation', description: 'Zeile nach oben', keys: ['↑', 'k'], bindings: ['k', 'ArrowUp'] },
  { id: 'tab', group: 'Navigation', description: 'Reiter wechseln', keys: ['1–4'], bindings: ['1', '2', '3', '4'] },
  { id: 'menu', group: 'Navigation', description: 'Kontextmenü der Zeile öffnen', keys: ['Shift+F10'], bindings: ['Shift+F10', 'ContextMenu', 'Shift+ContextMenu'] },
  { id: 'help', group: 'Navigation', description: 'Hilfe mit allen Tasten und Filtern', keys: ['?'], bindings: ['?'] },
  { id: 'reload', group: 'Ansicht', description: 'Neu laden', keys: ['F5'], bindings: ['F5'] },
  { id: 'filter', group: 'Ansicht', description: 'Name filtern (Images: Repository)', keys: ['/'], bindings: ['/'] },
  { id: 'attention', group: 'Ansicht', description: 'Nur auffällige Container ein/aus', keys: ['w'], bindings: ['w'],
    unavailable: context => attentionChip(context.kind) ? undefined : 'Dieser Reiter hat keinen Chip „Auffällig“.' },
  { id: 'resetFilter', group: 'Ansicht', description: 'Alle Filter des Reiters zurücksetzen (Gruppierung bleibt)', keys: ['F'], bindings: ['F'] },
  { id: 'logs', group: 'Ansicht', description: 'Logs des Containers anzeigen', keys: ['l'], bindings: ['l'], unavailable: logsUnavailable },
  { id: 'shell', group: 'Ansicht', description: 'Shell im Container', keys: ['s'], bindings: ['s'], unavailable: shellUnavailable },
  { id: 'inspect', group: 'Ansicht', description: 'Inspect anzeigen', keys: ['i'], bindings: ['i'],
    unavailable: context => context.row ? undefined : NO_ROW },
  { id: 'toggleDock', group: 'Ansicht', description: 'Unteres Panel ein- und ausblenden', keys: ['Ctrl+j'], bindings: ['Ctrl+j'] },
  { id: 'popout', group: 'Ansicht', description: 'Logs oder Shell als eigenen Tab öffnen', keys: ['Ctrl+Shift+T'], bindings: ['Ctrl+Shift+T'],
    unavailable: context => {
      if (!context.canPopout) return 'Hier lässt sich kein Tab öffnen.';
      if (context.dock === 'inspect') return 'Nur für Logs und Shell.';
      return context.dock === 'shell' ? shellUnavailable(context) : logsUnavailable(context);
    } },
  { id: 'restart', group: 'Aktionen', description: 'Container neu starten', keys: ['r'], bindings: ['r'], unavailable: forAction('restart') },
  { id: 'stop', group: 'Aktionen', description: 'Container stoppen', keys: ['x'], bindings: ['x'], unavailable: forAction('stop') },
  { id: 'remove', group: 'Aktionen', description: 'Container, Image oder Volume entfernen', keys: ['Ctrl+d'], bindings: ['Ctrl+d'], unavailable: forAction('remove') },
];

export function commandForKey(binding: string): ContainerCommand | undefined {
  return CONTAINER_COMMANDS.find(command => command.bindings.includes(binding));
}
