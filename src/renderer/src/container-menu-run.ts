import type { InventoryAction, InventoryRow, TerminalTarget } from '../../shared/containers';
import type { ContainerViewAction } from './container-view';
import type { ContainerMenuAction, ContainerMenuTarget } from './container-menus';

/** The menu target of a right-click: always the clicked row, never `state.selected`. */
export const rowMenuTarget = (row: InventoryRow): ContainerMenuTarget => ({ type: 'row', row });

export interface ContainerMenuRunner {
  dispatch(action: ContainerViewAction): void;
  copy(text: string, label: string): void;
  /** The only way to a container action: dialog or, for start, direct run. */
  confirm(row: InventoryRow, action: InventoryAction): void;
  popout(target: TerminalTarget): void;
  reload(): void;
  reloadDock(): void;
  help(): void;
}

/** Runs a menu action through the runner; container actions never run directly. */
export function runMenuAction(action: ContainerMenuAction, runner: ContainerMenuRunner): void {
  switch (action.type) {
    case 'view': for (const step of action.actions) runner.dispatch(step); return;
    case 'copy': runner.copy(action.text, action.label); return;
    case 'containerAction': runner.confirm(action.row, action.action); return;
    case 'popout': runner.popout(action.target); return;
    case 'reload': runner.reload(); return;
    case 'dockReload': runner.reloadDock(); return;
    case 'help': runner.help(); return;
  }
}
