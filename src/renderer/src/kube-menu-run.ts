import type { KubeAction, KubeLink, KubeRef, KubeRow, KubeTerminalTarget } from '../../shared/kubernetes';
import type { DiagnoseTarget } from './kube-diagnose';
import type { KubeViewAction } from './kube-view';
import type { MenuAction, MenuTarget } from './kube-menus';

/** The menu target of a right-click: always the clicked row, never `state.selected`. */
export const rowMenuTarget = (row: KubeRow): MenuTarget => ({ type: 'row', row });

export interface MenuRunner {
  dispatch(action: KubeViewAction): void;
  setPrevious(value: boolean): void;
  arm(): void;
  copy(text: string, label: string): void;
  /** The only way to a cluster action: opens the confirmation. */
  confirm(ref: KubeRef, action: KubeAction, currentReplicas?: number): void;
  /** Opens the port-forward dialog for a pod or service row. */
  forward(row: KubeRow): void;
  /** Selects the row, opens the Logs tab of the dock and starts the logs of all its pods. */
  logsAll(row: KubeRow): void;
  /** "Mit KI analysieren": main collects the context, the assistant panel shows it before sending. */
  analyze(target: DiagnoseTarget): void;
  /** "In Argo CD öffnen" / "In Harbor öffnen": main builds the https address from the vault entry and opens the browser. */
  openLink(link: KubeLink): void;
  popout(target: KubeTerminalTarget): void;
  ssh(connectionId: string): void;
  reloadDock(): void;
  help(): void;
}

/** Runs a menu action through the runner; cluster actions never run directly. */
export function runMenuAction(action: MenuAction, runner: MenuRunner): void {
  switch (action.type) {
    case 'view':
      if (action.previous !== undefined) runner.setPrevious(action.previous);
      if (action.armShell) runner.arm();
      for (const step of action.actions) runner.dispatch(step);
      return;
    case 'copy': runner.copy(action.text, action.label); return;
    case 'kubeAction': runner.confirm(action.ref, action.action, action.currentReplicas); return;
    case 'forward': runner.forward(action.row); return;
    case 'logsAll': runner.logsAll(action.row); return;
    case 'analyze': runner.analyze(action.target); return;
    case 'link': runner.openLink(action.link); return;
    case 'popout': runner.popout(action.target); return;
    case 'ssh': runner.ssh(action.connectionId); return;
    case 'dockReload': runner.reloadDock(); return;
    case 'help': runner.help(); return;
  }
}
