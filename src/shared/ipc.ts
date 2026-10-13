import type { SshPrepareRequest, SshSessionRequest, SshInputRequest, SshResizeRequest, SshAckRequest, SshEvent } from './ssh';
import type { Vault, WorkspaceLayout } from './vault/types';
import type { ConnectionCatalog, ExternalDragHover, IncomingTab, TabTransferRequest, WindowRole, WorkspaceWindowState } from './windows';
import type { RdpActionRequest, RdpBoundsRequest, RdpEvent, RdpOpenRequest, RdpSessionRequest, RdpVisibleRequest } from './rdp';

export const IPC_CHANNELS = {
  getVersion: 'app:get-version',
  readClipboardText: 'clipboard:read-text',
  writeClipboardText: 'clipboard:write-text',
  saveVault: 'vault:save',
  selectVaultFile: 'vault:select-file',
  selectPrivateKeyFile: 'ssh:select-key-file',
  unlockVault: 'vault:unlock',
  saveCurrentVault: 'vault:save-current',
  lockVault: 'vault:lock',
  sshPrepare: 'ssh:prepare',
  sshConnect: 'ssh:connect',
  sshInput: 'ssh:input',
  sshResize: 'ssh:resize',
  sshAck: 'ssh:ack',
  sshClose: 'ssh:close',
  sshAttach: 'ssh:attach',
  sshEvent: 'ssh:event',
  rdpOpen: 'rdp:open',
  rdpBounds: 'rdp:bounds',
  rdpVisible: 'rdp:visible',
  rdpFocus: 'rdp:focus',
  rdpClose: 'rdp:close',
  rdpAction: 'rdp:action',
  rdpEvent: 'rdp:event',
  windowReady: 'window:ready',
  windowCloseReady: 'window:close-ready',
  windowEvacuate: 'window:evacuate',
  connectionCatalog: 'window:connection-catalog',
  connectionCatalogChanged: 'window:connection-catalog-changed',
  tabTransfer: 'tabs:transfer',
  tabIncoming: 'tabs:incoming',
  tabDragMove: 'tabs:drag-move',
  tabDragHover: 'tabs:drag-hover',
  workspaceWindows: 'workspace:windows',
  workspaceCollect: 'workspace:collect',
  workspaceReport: 'workspace:report',
  workspaceOpenWindows: 'workspace:open-windows',
  workspaceRestore: 'workspace:restore',
  closeSecondaryWindows: 'window:close-secondaries',
} as const;

export type SelectVaultFileResult =
  | {
      canceled: true;
    }
  | {
      canceled: false;
      filePath: string;
    };

export interface UnlockVaultRequest {
  filePath: string;
  password: string;
}

export interface UnlockVaultResult {
  filePath: string;
  vault: Vault;
}

export interface SaveCurrentVaultRequest {
  vault: Vault;
}

export interface VaultSessionResult {
  filePath: string;
  vault: Vault;
}

export interface SaveVaultRequest {
  vault: Vault;
  password: string;
  suggestedName?: string;
}

export type SaveVaultResult =
  | {
      canceled: true;
    }
  | {
      canceled: false;
      filePath: string;
    };

export interface DesktopApi {
  readClipboardText: () => Promise<string>;
  writeClipboardText: (text: string) => Promise<void>;
  sshPrepare: (request: SshPrepareRequest) => Promise<{ sessionId: string }>;
  sshConnect: (request: SshSessionRequest) => Promise<void>;
  sshInput: (request: SshInputRequest) => Promise<void>;
  sshResize: (request: SshResizeRequest) => Promise<void>;
  sshAck: (request: SshAckRequest) => Promise<void>;
  sshClose: (request: SshSessionRequest) => Promise<void>;
  /** Takes over a session transferred from another window. */
  sshAttach: (request: SshSessionRequest) => Promise<void>;
  onSshEvent: (listener: (event: SshEvent) => void) => () => void;
  rdpOpen: (request: RdpOpenRequest) => Promise<{ sessionId: string }>;
  rdpBounds: (request: RdpBoundsRequest) => Promise<void>;
  rdpVisible: (request: RdpVisibleRequest) => Promise<void>;
  rdpFocus: (request: RdpSessionRequest) => Promise<void>;
  rdpClose: (request: RdpSessionRequest) => Promise<void>;
  rdpAction: (request: RdpActionRequest) => Promise<void>;
  onRdpEvent: (listener: (event: RdpEvent) => void) => () => void;
  windowReady: () => Promise<{ role: WindowRole }>;
  windowCloseReady: () => Promise<void>;
  onWindowEvacuate: (listener: () => void) => () => void;
  connectionCatalog: () => Promise<ConnectionCatalog>;
  onConnectionCatalog: (listener: (catalog: ConnectionCatalog) => void) => () => void;
  transferTab: (request: TabTransferRequest) => Promise<void>;
  onIncomingTab: (listener: (tab: IncomingTab) => void) => () => void;
  /** Screen point (DIP) of a tab dragged outside its window; null ends the hover. */
  tabDragMove: (point: { x: number; y: number; label: string } | null) => void;
  onTabDragHover: (listener: (hover: ExternalDragHover) => void) => () => void;
  workspaceWindows: () => Promise<WorkspaceWindowState[]>;
  onWorkspaceCollect: (listener: (request: { requestId: string }) => void) => () => void;
  workspaceReport: (report: { requestId: string; layout: WorkspaceLayout | null }) => Promise<void>;
  openWorkspaceWindows: (windows: WorkspaceWindowState[]) => Promise<void>;
  onWorkspaceRestore: (listener: (layout: WorkspaceLayout) => void) => () => void;
  closeSecondaryWindows: () => Promise<void>;
  getVersion: () => Promise<string>;
  selectVaultFile: () => Promise<SelectVaultFileResult>;
  selectPrivateKeyFile: () => Promise<SelectVaultFileResult>;

  saveVault: (
    request: SaveVaultRequest,
  ) => Promise<SaveVaultResult>;

  unlockVault: (
    request: UnlockVaultRequest,
  ) => Promise<UnlockVaultResult>;

  saveCurrentVault: (
    request: SaveCurrentVaultRequest,
  ) => Promise<VaultSessionResult>;

  lockVault: () => Promise<void>;
}
