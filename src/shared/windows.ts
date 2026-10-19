import type { ConnectionProtocol, VaultNode, Workflow, WorkspaceLayout, WorkspaceView } from './vault/types';
import type { SshStatus } from './ssh';
import type { TerminalTarget } from './containers';
import type { KubeTerminalTarget } from './kubernetes';

export type WindowRole = 'main' | 'secondary';

/** Tab metadata shared between windows; never credentials. */
export interface TabConnection {
  id: string; name: string; protocol: ConnectionProtocol; address: string;
  /** File browser ('files') or container view ('containers') of the connection `id`. */
  view?: 'files' | 'containers';
  /** Container or Proxmox guest on the host `id`. */
  target?: TerminalTarget;
  /** Logs or shell of a pod in the cluster `id`. */
  kube?: KubeTerminalTarget;
}

export interface TransferSession { kind: 'terminal' | 'rdp' | 'sftp'; sessionId: string }

export type TransferTarget =
  | { kind: 'main' }
  /** Screen point in DIP; dropped onto the window under it or into a new window. */
  | { kind: 'drop'; x: number; y: number }
  /** Always a new window at this screen point (DIP). */
  | { kind: 'new'; x: number; y: number };

/** Split layout of a view with tab keys of the sending window. */
export type TransferLayout =
  | { type: 'pane'; id: string; tabIds: string[]; activeTabId: string | null }
  | { type: 'split'; id: string; direction: 'horizontal' | 'vertical'; ratio: number; first: TransferLayout; second: TransferLayout };

export interface ViewTransferTab {
  /** Tab ID in the sending window; referenced by the layout. */
  key: string;
  connection: TabConnection;
  status: SshStatus;
  session?: TransferSession;
  snapshot?: string;
}

/** A whole view (layout, tabs and sessions) moving to another window. */
export interface ViewTransferRequest { name: string; layout: TransferLayout; tabs: ViewTransferTab[]; target: TransferTarget }
export interface IncomingView { name: string; layout: TransferLayout; tabs: ViewTransferTab[] }

export interface TabTransferRequest {
  connection: TabConnection;
  status: SshStatus;
  /** Missing for tabs without a live session (closed or failed). */
  session?: TransferSession;
  /** Serialized terminal screen and scrollback. */
  snapshot?: string;
  target: TransferTarget;
}

export interface IncomingTab {
  connection: TabConnection;
  status: SshStatus;
  session?: TransferSession;
  snapshot?: string;
  /** Viewport point of the drop in the receiving window; absent for new windows. */
  drop?: { x: number; y: number };
}

/** Pointer of a tab dragged from another window, in viewport CSS pixels; null when it left. */
export type ExternalDragHover = { x: number; y: number; label: string; kind?: 'tab' | 'view' } | null;

/** What detached windows know about the vault: connection metadata without secrets. */
export interface ConnectionCatalog { nodes: VaultNode[]; confirmBeforeClosingSession: boolean; workflows: Workflow[] }

export interface WindowBounds { x: number; y: number; width: number; height: number }
export interface WorkspaceWindowState { bounds: WindowBounds; layout: WorkspaceLayout; views?: WorkspaceView[] }
/** A window's saved views; null when it has no tabs. */
export type WindowLayoutReport = { layout: WorkspaceLayout; views?: WorkspaceView[] } | null;
