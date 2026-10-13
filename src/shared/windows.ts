import type { ConnectionProtocol, VaultNode, WorkspaceLayout, WorkspaceView } from './vault/types';
import type { SshStatus } from './ssh';

export type WindowRole = 'main' | 'secondary';

/** Tab metadata shared between windows; never credentials. */
export interface TabConnection { id: string; name: string; protocol: ConnectionProtocol; address: string }

export interface TransferSession { kind: 'terminal' | 'rdp'; sessionId: string }

export type TransferTarget =
  | { kind: 'main' }
  /** Screen point in DIP; dropped onto the window under it or into a new window. */
  | { kind: 'drop'; x: number; y: number };

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
  /** Viewport point of the drop in the receiving window; absent for new windows and evacuation. */
  drop?: { x: number; y: number };
}

/** Pointer of a tab dragged from another window, in viewport CSS pixels; null when it left. */
export type ExternalDragHover = { x: number; y: number; label: string } | null;

/** What detached windows know about the vault: connection metadata without secrets. */
export interface ConnectionCatalog { nodes: VaultNode[]; confirmBeforeClosingSession: boolean }

export interface WindowBounds { x: number; y: number; width: number; height: number }
export interface WorkspaceWindowState { bounds: WindowBounds; layout: WorkspaceLayout; views?: WorkspaceView[] }
/** A window's saved views; null when it has no tabs. */
export type WindowLayoutReport = { layout: WorkspaceLayout; views?: WorkspaceView[] } | null;
