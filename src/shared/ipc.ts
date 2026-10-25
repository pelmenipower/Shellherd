import type { SshPrepareRequest, SshSessionRequest, SshInputRequest, SshResizeRequest, SshAckRequest, SshEvent, SshForwardRequest, AuthPromptRequest, AuthPromptAnswer } from './ssh';
import type { AiProvider, ConnectionNode, Vault, WorkspaceLayout } from './vault/types';
import type { AiAskRequest, AiCatalog, AiEvent } from './ai';
import type { LanguageSetting, LanguageState, Locale } from './locale';
import type { ConnectionTestResult } from './connection-test';
import type {
  ContainerAction, ContainerHostId, ContainerInventory, ContainerRuntime, ContainerTarget, DiscoveryResult, InventoryAction, InventoryRef,
} from './containers';
import type { ConnectionCatalog, ExternalDragHover, IncomingTab, IncomingView, TabTransferRequest, ViewTransferRequest, WindowLayoutReport, WindowRole, WorkspaceWindowState } from './windows';
import type { LocalOpenRequest, SftpChmodRequest, SftpEditFileRequest, SftpEditRequest, SftpSyncRequest } from './sftp';
import type { DirectoryListing, LocalDeleteRequest, LocalPathRequest, LocalPlaces, LocalRenameRequest, SftpConflictAnswer, SftpDeleteRequest, SftpEvent, SftpJobRequest,
  SftpOpenRequest, SftpPathRequest, SftpRenameRequest, SftpSessionRequest, SftpSessionState, SftpTransferRequest } from './sftp';
import type { RdpActionRequest, RdpBoundsRequest, RdpEvent, RdpOpenRequest, RdpSessionRequest, RdpVisibleRequest } from './rdp';
import type { ImportReadResult, ImportSource } from './import';
import type { KubeActionRequest, KubeAccessRequest, KubeArgoRequest, KubeArgoState, KubeDiagnoseRequest, KubeDiagnosis, KubeOpenLinkRequest, KubeDetail, KubeDetailRequest, KubeEvent, KubeForwardStartRequest, KubeForwardStatus, KubeForwardStopRequest, KubeLogsStartRequest, KubeLogsStopRequest, KubeOpenRequest, KubeOpenResult, KubeProbeRequest, KubeProbeResult, KubeSubscribeRequest, KubeViewRequest } from './kubernetes';
import type { KubeDenied } from './kube-access';
import type { ThemeSetting } from './theme';
import type { KnownHostsImportReply, KnownHostView } from './known-hosts';

/** Sent to every window when the vault locks; without minutes = manual lock. */
export interface VaultLockedInfo { minutes?: number }
/** disconnect: end every session and close secondary windows (switching to another vault file). */
export interface LockVaultRequest { disconnect?: boolean }

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
  vaultActivity: 'vault:activity',
  vaultLocked: 'vault:locked',
  vaultUnlocked: 'vault:unlocked',
  sshPrepare: 'ssh:prepare',
  sshConnect: 'ssh:connect',
  sshInput: 'ssh:input',
  sshResize: 'ssh:resize',
  sshAck: 'ssh:ack',
  sshClose: 'ssh:close',
  sshAttach: 'ssh:attach',
  sshEvent: 'ssh:event',
  sshAuthPrompt: 'ssh:auth-prompt',
  sshAuthPromptClosed: 'ssh:auth-prompt-closed',
  sshAuthPromptAnswer: 'ssh:auth-prompt-answer',
  sshForward: 'ssh:forward',
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
  sftpVerify: 'sftp:verify',
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
  sftpSyncStart: 'sftp:sync-start',
  sftpSyncStop: 'sftp:sync-stop',
  sftpSyncForce: 'sftp:sync-force',
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
  lastVaultFile: 'vault:last-file',
  recentVaults: 'vault:recent-list',
  removeRecentVault: 'vault:recent-remove',
  vaultDropFile: 'vault:drop-file',
  knownHostsList: 'known-hosts:list',
  knownHostsRemove: 'known-hosts:remove',
  knownHostsImport: 'known-hosts:import',
  helloStatus: 'vault:hello-status',
  helloEnable: 'vault:hello-enable',
  helloDisable: 'vault:hello-disable',
  helloUnlock: 'vault:hello-unlock',
  connectionTest: 'connection:test',
  containersList: 'containers:list',
  containersAction: 'containers:action',
  containersInventory: 'containers:inventory',
  containersInspect: 'containers:inspect',
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
  appGetLanguage: 'app:get-language',
  appSetLanguage: 'app:set-language',
  appGetTheme: 'app:get-theme',
  appSetTheme: 'app:set-theme',
  appLocaleChanged: 'app:locale-changed',
  openExternal: 'app:open-external',
  importRead: 'import:read',
  updateStatus: 'app:update-status',
  updateSetEnabled: 'app:update-set-enabled',
  updateSkip: 'app:update-skip',
  kubeOpen: 'k8s:open',
  kubeSubscribe: 'k8s:subscribe',
  kubeDetail: 'k8s:detail',
  kubeAction: 'k8s:action',
  kubeClose: 'k8s:close',
  kubeProbe: 'k8s:probe',
  kubeForwardStart: 'k8s:forward-start',
  kubeForwardStop: 'k8s:forward-stop',
  kubeLogsStart: 'k8s:logs-start',
  kubeLogsStop: 'k8s:logs-stop',
  kubeAccess: 'k8s:access',
  kubeDiagnose: 'k8s:diagnose',
  kubeOpenLink: 'k8s:open-link',
  kubeArgoApp: 'k8s:argo-app',
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

/** Version check state for the main window; see docs/superpowers/specs/2026-10-24-import-update-design.md. */
export interface UpdateStatus { enabled: boolean; current: string; available: { version: string; url: string } | null }

/** One entry of the open screen list. filePath is for display and for the existing unlockVault; the list itself only changes in main. */
export interface RecentVault { id: string; filePath: string; name: string; folder: string; openedAt: number; missing: boolean }

/** Windows Hello for one vault path on this device: available = Windows Hello is set up; enrolled = a wrapped key is stored for the path. */
export interface HelloStatus { available: boolean; enrolled: boolean }

export interface HelloUnlockRequest { filePath: string }

export interface DesktopApi {
  readClipboardText: () => Promise<string>;
  writeClipboardText: (text: string) => Promise<void>;
  /** Opens an http(s) link in the default browser; main validates it again. */
  openExternal: (url: string) => Promise<void>;
  /** Opens the source after a click: file dialog (OpenSSH) or registry export (PuTTY). Main window, unlocked vault. */
  importRead: (source: ImportSource) => Promise<ImportReadResult>;
  /** Runs the check when enabled and due (at most every 24 h), else returns the stored state. */
  updateStatus: () => Promise<UpdateStatus>;
  updateSetEnabled: (enabled: boolean) => Promise<UpdateStatus>;
  updateSkip: (version: string) => Promise<UpdateStatus>;
  sshPrepare: (request: SshPrepareRequest) => Promise<{ sessionId: string }>;
  sshConnect: (request: SshSessionRequest) => Promise<void>;
  sshInput: (request: SshInputRequest) => Promise<void>;
  sshResize: (request: SshResizeRequest) => Promise<void>;
  sshAck: (request: SshAckRequest) => Promise<void>;
  sshClose: (request: SshSessionRequest) => Promise<void>;
  /** Takes over a session transferred from another window. */
  sshAttach: (request: SshSessionRequest) => Promise<void>;
  onSshEvent: (listener: (event: SshEvent) => void) => () => void;
  /** Server questions of a keyboard-interactive login; answered with answerAuthPrompt. */
  onAuthPrompt: (listener: (request: AuthPromptRequest) => void) => () => void;
  onAuthPromptClosed: (listener: (event: { promptId: string }) => void) => () => void;
  answerAuthPrompt: (answer: AuthPromptAnswer) => Promise<void>;
  sshForward: (request: SshForwardRequest) => Promise<void>;
  rdpOpen: (request: RdpOpenRequest) => Promise<{ sessionId: string }>;
  rdpBounds: (request: RdpBoundsRequest) => Promise<void>;
  rdpVisible: (request: RdpVisibleRequest) => Promise<void>;
  rdpFocus: (request: RdpSessionRequest) => Promise<void>;
  rdpClose: (request: RdpSessionRequest) => Promise<void>;
  rdpAction: (request: RdpActionRequest) => Promise<void>;
  onRdpEvent: (listener: (event: RdpEvent) => void) => () => void;
  /** Opens a view on a cluster; the session starts or is shared with other views. */
  kubeOpen: (request: KubeOpenRequest) => Promise<KubeOpenResult>;
  kubeSubscribe: (request: KubeSubscribeRequest) => Promise<void>;
  kubeDetail: (request: KubeDetailRequest) => Promise<KubeDetail>;
  kubeAction: (request: KubeActionRequest) => Promise<void>;
  kubeClose: (request: KubeViewRequest) => Promise<void>;
  /** Reads contexts of the kubeconfig on an SSH host; never returns the config itself. */
  kubeProbe: (request: KubeProbeRequest) => Promise<KubeProbeResult>;
  /** Listens on 127.0.0.1 only and forwards to a pod or service port of the view's cluster; resolves with the running forward. */
  kubeForwardStart: (request: KubeForwardStartRequest) => Promise<KubeForwardStatus>;
  kubeForwardStop: (request: KubeForwardStopRequest) => Promise<void>;
  /** Starts the logs of all pods of a selector for the view (one run per view); batches arrive as `logs` events with the same id. */
  kubeLogsStart: (request: KubeLogsStartRequest) => Promise<void>;
  kubeLogsStop: (request: KubeLogsStopRequest) => Promise<void>;
  /** RBAC pre-check of one namespace; null = unknown, grey out nothing. */
  kubeAccess: (request: KubeAccessRequest) => Promise<KubeDenied[] | null>;
  /** "Mit KI analysieren": status, events, logs and spec of one object as text. Reads only (get, list, get pods/log), never Secrets. */
  kubeDiagnose: (request: KubeDiagnoseRequest) => Promise<KubeDiagnosis>;
  /** "In Argo CD öffnen" / "In Harbor öffnen": main builds the https address from the vault entry and opens the browser. */
  kubeOpenLink: (request: KubeOpenLinkRequest) => Promise<void>;
  /** Self-Heal state of an Argo CD application for the confirmation (get on applications.argoproj.io); null when unreadable. */
  kubeArgoApp: (request: KubeArgoRequest) => Promise<KubeArgoState | null>;
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
  sftpVerify: (request: SftpJobRequest) => Promise<void>;
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
  sftpSyncStart: (request: SftpSyncRequest) => Promise<void>;
  sftpSyncStop: (request: SftpSyncRequest) => Promise<void>;
  sftpSyncForce: (request: SftpSyncRequest) => Promise<void>;
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
  /** Vault file Shellherd was started with from Explorer; returned once. */
  vaultLaunchFile: () => Promise<string | null>;
  /** Path of the vault opened last, if the file still exists; preselected on the open screen. */
  lastVaultFile: () => Promise<string | null>;
  /** Newest first, at most 8. Main window only. */
  recentVaults: () => Promise<RecentVault[]>;
  /** Removes one entry by id and returns the new list; the file itself is untouched. */
  removeRecentVault: (id: string) => Promise<RecentVault[]>;
  /** Main checks a dropped vault path (local drives only) and returns it normalized; rejects with core.vaultPathNotAllowed. */
  dropVaultFile: (filePath: string) => Promise<string>;
  knownHostsList: () => Promise<KnownHostView[]>;
  knownHostsRemove: (id: string) => Promise<KnownHostView[]>;
  /** Native file dialog, then import; nothing is read without that click. */
  knownHostsImport: () => Promise<KnownHostsImportReply>;
  /** Never prompts and never reads the vault file. Main window only. */
  helloStatus: (filePath: string) => Promise<HelloStatus>;
  /** Prompts Windows Hello and stores the key of the unlocked vault for this device; rejects with core.helloCanceled and other codes. */
  helloEnable: () => Promise<HelloStatus>;
  /** Deletes the stored key of the unlocked vault; no prompt. */
  helloDisable: () => Promise<HelloStatus>;
  /** Same path checks and result as unlockVault, with Windows Hello instead of the password. */
  helloUnlock: (request: HelloUnlockRequest) => Promise<UnlockVaultResult>;
  /** Stored colour scheme (default 'dark'). Main window only. */
  getTheme: () => Promise<ThemeSetting>;
  /** Persists first, then applies to all windows; throws core.settingsWriteFailed. */
  setTheme: (setting: ThemeSetting) => Promise<ThemeSetting>;
  /** Dry run of a possibly unsaved connection. */
  connectionTest: (connection: ConnectionNode) => Promise<ConnectionTestResult>;
  /** Probes an SSH connection or this computer for Docker and Podman and lists Proxmox guests; always fresh. */
  containersList: (request: { hostId: ContainerHostId }) => Promise<DiscoveryResult>;
  containersInventory: (request: { hostId: ContainerHostId; runtime?: ContainerRuntime }) => Promise<ContainerInventory>;
  /** Masked, 2-space indented JSON of `<rt> <kind> inspect <ref>`. */
  containersInspect: (request: { hostId: ContainerHostId; ref: InventoryRef }) => Promise<string>;
  containersAction: (request:
    | { hostId: ContainerHostId; target: ContainerTarget; action: ContainerAction }
    | { hostId: ContainerHostId; target: InventoryRef; action: InventoryAction }) => Promise<void>;
  aiCatalog: () => Promise<AiCatalog>;
  onAiCatalog: (listener: (catalog: AiCatalog) => void) => () => void;
  /** Starts a streamed answer; text arrives as `ai:event` deltas. */
  aiAsk: (request: AiAskRequest) => Promise<void>;
  aiCancel: (request: { requestId: string }) => Promise<void>;
  onAiEvent: (listener: (event: AiEvent) => void) => () => void;
  /** Settings form only: one short round trip, returns the model's reply. */
  aiTest: (provider: AiProvider) => Promise<string>;
  /** A vault file opened from Explorer while Shellherd was running. */
  onVaultOpenFile: (listener: (filePath: string) => void) => () => void;
  fileTypeStatus: () => Promise<boolean>;
  fileTypeRegister: () => Promise<void>;
  fileTypeUnregister: () => Promise<void>;
  /** Effective UI language when the window was created (`--shellherd-locale=`); synchronous for the first frame. */
  initialLocale: Locale;
  /** Any Shellherd window. */
  getLanguage: () => Promise<LanguageState>;
  /** Main window only. */
  setLanguage: (setting: LanguageSetting) => Promise<LanguageState>;
  onLocaleChanged: (listener: (state: LanguageState) => void) => () => void;
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

  lockVault: (request?: LockVaultRequest) => Promise<void>;
  /** Reports mouse or keyboard use to the auto-lock; fire-and-forget. */
  vaultActivity: () => void;
  onVaultLocked: (listener: (info: VaultLockedInfo) => void) => () => void;
  onVaultUnlocked: (listener: () => void) => () => void;
}
