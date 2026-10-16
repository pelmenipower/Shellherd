import type { SshPrepareRequest, SshSessionRequest, SshInputRequest, SshResizeRequest, SshAckRequest, SshEvent } from './ssh';
import type { AiProvider, ConnectionNode, Vault, WorkspaceLayout } from './vault/types';
import type { AiAskRequest, AiCatalog, AiEvent } from './ai';
import type { ConnectionTestResult } from './connection-test';
import type { ContainerAction, ContainerHostId, ContainerTarget, DiscoveryResult } from './containers';
import type { ConnectionCatalog, ExternalDragHover, IncomingTab, IncomingView, TabTransferRequest, ViewTransferRequest, WindowLayoutReport, WindowRole, WorkspaceWindowState } from './windows';
import type { LocalOpenRequest, SftpChmodRequest, SftpEditFileRequest, SftpEditRequest } from './sftp';
import type { DirectoryListing, LocalDeleteRequest, LocalPathRequest, LocalPlaces, LocalRenameRequest, SftpConflictAnswer, SftpDeleteRequest, SftpEvent, SftpJobRequest,
  SftpOpenRequest, SftpPathRequest, SftpRenameRequest, SftpSessionRequest, SftpSessionState, SftpTransferRequest } from './sftp';
import type { RdpActionRequest, RdpBoundsRequest, RdpEvent, RdpOpenRequest, RdpSessionRequest, RdpVisibleRequest } from './rdp';
import type { KubeActionRequest, KubeDetail, KubeDetailRequest, KubeEvent, KubeOpenRequest, KubeProbeRequest, KubeProbeResult, KubeSubscribeRequest, KubeViewRequest } from './kubernetes';

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
  sftpOpen: 'sftp:open',
  sftpHome: 'sftp:home',
  sftpList: 'sftp:list',
  sftpMkdir: 'sftp:mkdir',
  sftpRename: 'sftp:rename',
  sftpDelete: 'sftp:delete',
  sftpTransfer: 'sftp:transfer',
  sftpCancel: 'sftp:cancel',
  sftpResolve: 'sftp:resolve',
  sftpClearFinished: 'sftp:clear-finished',
  sftpState: 'sftp:state',
  sftpClose: 'sftp:close',
  sftpChmod: 'sftp:chmod',
  sftpEdit: 'sftp:edit',
  sftpCreateFile: 'sftp:create-file',
  localCreateFile: 'local:create-file',
  localOpen: 'local:open',
  sftpEditOpen: 'sftp:edit-open',
  sftpEditUpload: 'sftp:edit-upload',
  sftpEditClose: 'sftp:edit-close',
  sftpEvent: 'sftp:event',
  localPlaces: 'local:places',
  localList: 'local:list',
  localMkdir: 'local:mkdir',
  localRename: 'local:rename',
  localDelete: 'local:delete',
  windowReady: 'window:ready',
  windowCloseReady: 'window:close-ready',
  connectionCatalog: 'window:connection-catalog',
  connectionCatalogChanged: 'window:connection-catalog-changed',
  tabTransfer: 'tabs:transfer',
  viewTransfer: 'views:transfer',
  viewIncoming: 'views:incoming',
  tabIncoming: 'tabs:incoming',
  tabDragMove: 'tabs:drag-move',
  tabDragHover: 'tabs:drag-hover',
  workspaceWindows: 'workspace:windows',
  workspaceCollect: 'workspace:collect',
  workspaceReport: 'workspace:report',
  workspaceOpenWindows: 'workspace:open-windows',
  workspaceRestore: 'workspace:restore',
  closeSecondaryWindows: 'window:close-secondaries',
  vaultLaunchFile: 'vault:launch-file',
  connectionTest: 'connection:test',
  containersList: 'containers:list',
  containersAction: 'containers:action',
  aiCatalog: 'ai:catalog',
  aiCatalogChanged: 'ai:catalog-changed',
  aiAsk: 'ai:ask',
  aiCancel: 'ai:cancel',
  aiTest: 'ai:test',
  aiEvent: 'ai:event',
  vaultOpenFile: 'vault:open-file',
  fileTypeStatus: 'app:file-type-status',
  fileTypeRegister: 'app:file-type-register',
  fileTypeUnregister: 'app:file-type-unregister',
  kubeOpen: 'k8s:open',
  kubeSubscribe: 'k8s:subscribe',
  kubeDetail: 'k8s:detail',
  kubeAction: 'k8s:action',
  kubeClose: 'k8s:close',
  kubeProbe: 'k8s:probe',
  kubeEvent: 'k8s:event',
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
  /** Opens a view on a cluster; the session starts or is shared with other views. */
  kubeOpen: (request: KubeOpenRequest) => Promise<{ viewId: string }>;
  kubeSubscribe: (request: KubeSubscribeRequest) => Promise<void>;
  kubeDetail: (request: KubeDetailRequest) => Promise<KubeDetail>;
  kubeAction: (request: KubeActionRequest) => Promise<void>;
  kubeClose: (request: KubeViewRequest) => Promise<void>;
  /** Reads contexts of the kubeconfig on an SSH host; never returns the config itself. */
  kubeProbe: (request: KubeProbeRequest) => Promise<KubeProbeResult>;
  onKubeEvent: (listener: (event: KubeEvent) => void) => () => void;
  sftpOpen: (request: SftpOpenRequest) => Promise<{ sessionId: string }>;
  sftpHome: (request: SftpSessionRequest) => Promise<string>;
  sftpList: (request: SftpPathRequest) => Promise<DirectoryListing>;
  sftpMkdir: (request: SftpPathRequest) => Promise<void>;
  sftpRename: (request: SftpRenameRequest) => Promise<void>;
  sftpDelete: (request: SftpDeleteRequest) => Promise<void>;
  sftpTransfer: (request: SftpTransferRequest) => Promise<{ jobId: string }>;
  sftpCancel: (request: SftpJobRequest) => Promise<void>;
  sftpResolve: (request: SftpConflictAnswer) => Promise<void>;
  sftpClearFinished: (request: SftpSessionRequest) => Promise<void>;
  sftpState: (request: SftpSessionRequest) => Promise<SftpSessionState>;
  sftpClose: (request: SftpSessionRequest) => Promise<void>;
  sftpChmod: (request: SftpChmodRequest) => Promise<void>;
  sftpEdit: (request: SftpEditFileRequest) => Promise<{ editId: string }>;
  sftpCreateFile: (request: SftpPathRequest) => Promise<void>;
  localCreateFile: (request: LocalPathRequest) => Promise<void>;
  /** Opens a local file for editing; programs and scripts open in Notepad instead of running. */
  localOpen: (request: LocalOpenRequest) => Promise<void>;
  sftpEditOpen: (request: SftpEditRequest) => Promise<void>;
  sftpEditUpload: (request: SftpEditRequest) => Promise<void>;
  sftpEditClose: (request: SftpEditRequest) => Promise<void>;
  onSftpEvent: (listener: (event: SftpEvent) => void) => () => void;
  localPlaces: () => Promise<LocalPlaces>;
  localList: (request: LocalPathRequest) => Promise<DirectoryListing>;
  localMkdir: (request: LocalPathRequest) => Promise<void>;
  localRename: (request: LocalRenameRequest) => Promise<void>;
  localDelete: (request: LocalDeleteRequest) => Promise<void>;
  /** Absolute path of a file dropped from Explorer; empty for files without one. */
  pathForFile: (file: File) => string;
  windowReady: () => Promise<{ role: WindowRole }>;
  windowCloseReady: () => Promise<void>;
  connectionCatalog: () => Promise<ConnectionCatalog>;
  onConnectionCatalog: (listener: (catalog: ConnectionCatalog) => void) => () => void;
  transferTab: (request: TabTransferRequest) => Promise<void>;
  onIncomingTab: (listener: (tab: IncomingTab) => void) => () => void;
  transferView: (request: ViewTransferRequest) => Promise<void>;
  onIncomingView: (listener: (view: IncomingView) => void) => () => void;
  /** Screen point (DIP) of a tab dragged outside its window; null ends the hover. */
  tabDragMove: (point: { x: number; y: number; label: string; kind?: 'tab' | 'view' } | null) => void;
  onTabDragHover: (listener: (hover: ExternalDragHover) => void) => () => void;
  workspaceWindows: () => Promise<WorkspaceWindowState[]>;
  onWorkspaceCollect: (listener: (request: { requestId: string }) => void) => () => void;
  workspaceReport: (report: { requestId: string; report: WindowLayoutReport }) => Promise<void>;
  openWorkspaceWindows: (windows: WorkspaceWindowState[]) => Promise<void>;
  onWorkspaceRestore: (listener: (saved: NonNullable<WindowLayoutReport>) => void) => () => void;
  closeSecondaryWindows: () => Promise<void>;
  /** Vault file Terminus was started with from Explorer; returned once. */
  vaultLaunchFile: () => Promise<string | null>;
  /** Dry run of a possibly unsaved connection. */
  connectionTest: (connection: ConnectionNode) => Promise<ConnectionTestResult>;
  /** Lists containers and Proxmox guests of an SSH connection or of this computer; always fresh. */
  containersList: (request: { hostId: ContainerHostId }) => Promise<DiscoveryResult>;
  containersAction: (request: { hostId: ContainerHostId; target: ContainerTarget; action: ContainerAction }) => Promise<void>;
  aiCatalog: () => Promise<AiCatalog>;
  onAiCatalog: (listener: (catalog: AiCatalog) => void) => () => void;
  /** Starts a streamed answer; text arrives as `ai:event` deltas. */
  aiAsk: (request: AiAskRequest) => Promise<void>;
  aiCancel: (request: { requestId: string }) => Promise<void>;
  onAiEvent: (listener: (event: AiEvent) => void) => () => void;
  /** Settings form only: one short round trip, returns the model's reply. */
  aiTest: (provider: AiProvider) => Promise<string>;
  /** A vault file opened from Explorer while Terminus was running. */
  onVaultOpenFile: (listener: (filePath: string) => void) => () => void;
  fileTypeStatus: () => Promise<boolean>;
  fileTypeRegister: () => Promise<void>;
  fileTypeUnregister: () => Promise<void>;
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
