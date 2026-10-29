import type { ConnectionIconName } from './appearance';
import type { ContainerRuntime, ContainerTarget, TerminalTargetMode } from '../containers';
import type { KubeViewSnapshot } from '../kubernetes';

export type Authentication =
  | {
      method: 'agent';
    }
  | {
      method: 'password';
      password: string;
    }
  | {
      method: 'privateKey';
      keyPath: string;
      passphrase?: string;
    };

/** Connection kinds. Remote kinds connect to a host; local kinds start a shell on this computer. */
export type ConnectionProtocol = 'ssh' | 'sftp' | 'rdp' | 'powershell' | 'cmd' | 'bash' | 'zsh' | 'fish' | 'aicli' | 'kubernetes';
export type LocalShellProtocol = 'powershell' | 'cmd' | 'bash' | 'zsh' | 'fish';

/** Timeouts of SSH-backed sessions; see docs/superpowers/specs/2026-10-21-connection-timeouts-design.md. */
export interface ConnectionTimeouts {
  /** Minutes without input or output before the session is closed; 0 = never. */
  idleMinutes: number;
  /** Seconds between ssh2 keepalive probes. */
  keepaliveSeconds: number;
  /** Unanswered probes before the connection counts as dead. */
  keepaliveCount: number;
  /** Seconds the SSH handshake may take, including an open host-key prompt. */
  connectSeconds: number;
}

interface ConnectionBase {
  id: string;
  type: 'connection';
  name: string;
  comment?: string;

  tags: string[];
  color?: string;
  icon?: ConnectionIconName;
  /** Greyed out and never opened (single, folder or workspace) until re-enabled. */
  disabled?: boolean;
}

/** A local folder mirrored into a server folder while its file view is open; one way, never deletes. */
export interface AutoUploadBinding {
  /** crypto.randomUUID(); unique within the connection. */
  id: string;
  /** Windows path on the computer that created the binding; may not exist elsewhere. */
  localPath: string;
  /** Absolute POSIX path on the server, never `/`. */
  remotePath: string;
  /** gitignore-style patterns, see src/shared/exclude-glob.ts. */
  excludes: string[];
  /** Off: kept, but not started with the session. */
  enabled: boolean;
}

/** Port forward of an SSH connection; ids unique within the connection, see docs/superpowers/specs/2026-10-24-ssh-pro-design.md 5.1. */
export type PortForward =
  | { id: string; kind: 'local'; localPort: number; targetHost: string; targetPort: number; auto: boolean }
  | { id: string; kind: 'remote'; remotePort: number; targetHost: string; targetPort: number; auto: boolean }
  | { id: string; kind: 'dynamic'; localPort: number; auto: boolean };

export interface SshConnectionNode extends ConnectionBase {
  protocol: 'ssh';
  host: string;
  port: number;
  username?: string;
  authentication: Authentication;
  /** Container discovery and tabs; see docs/superpowers/specs/2026-10-14-container-integration-design.md. */
  containers?: { sudo?: boolean };
  /** Auto-upload bindings; see docs/superpowers/specs/2026-10-20-sftp-auto-upload-design.md. */
  autoUpload?: AutoUploadBinding[];
  /** Per-connection override; absent keys fall back to the vault setting. */
  timeouts?: Partial<ConnectionTimeouts>;
  /** Root shell and typed start commands after login; see docs/superpowers/specs/2026-10-21-login-commands-design.md. */
  login?: { sudo?: boolean; commands?: string[] };
  /** Id of an SSH connection to hop through first; one hop only, see docs/superpowers/specs/2026-10-24-ssh-pro-design.md 4.1. */
  jumpHost?: string;
  /** Port forwards run by the terminal session; at most 16. */
  forwards?: PortForward[];
}

/** File transfer over SSH; same target and authentication as an SSH connection. */
export interface SftpConnectionNode extends ConnectionBase {
  protocol: 'sftp';
  host: string;
  port: number;
  username?: string;
  authentication: Authentication;
  /** Auto-upload bindings; see docs/superpowers/specs/2026-10-20-sftp-auto-upload-design.md. */
  autoUpload?: AutoUploadBinding[];
  /** Per-connection override; absent keys fall back to the vault setting. */
  timeouts?: Partial<ConnectionTimeouts>;
  /** Id of an SSH connection to hop through first; see SshConnectionNode.jumpHost. */
  jumpHost?: string;
}

export interface RdpOptions {
  /** Separate domain; alternatively `DOMAIN\user` or a UPN in the user name, never both. */
  domain?: string;
  /** Clipboard redirection; server policies may still restrict it. */
  clipboard: boolean;
}

export interface RdpConnectionNode extends ConnectionBase {
  protocol: 'rdp';
  host: string;
  port: number;
  username?: string;
  /** Empty: the RDP client asks for credentials when connecting. */
  password?: string;
  rdp: RdpOptions;
}

export interface LocalShellConnectionNode extends ConnectionBase {
  protocol: LocalShellProtocol;
  /** Start directory; defaults to the user profile. */
  workingDirectory?: string;
}

export type RemoteConnectionNode = SshConnectionNode | SftpConnectionNode | RdpConnectionNode;
export type AiCliTool = 'claude' | 'codex' | 'gemini' | 'custom';

/** An AI command line tool (Claude Code, Codex …) started in a local terminal. */
export interface AiCliConnectionNode extends ConnectionBase {
  protocol: 'aicli';
  tool: AiCliTool;
  /** Custom tools only: the command line to run. */
  command?: string;
  /** Project folder; defaults to the user profile. */
  workingDirectory?: string;
}

export type LocalConnectionNode = LocalShellConnectionNode | AiCliConnectionNode;

/** Kubernetes cluster reached through SSH connections; see docs/superpowers/specs/2026-10-16-kubernetes-integration-design.md. */
export interface KubernetesConnectionNode extends ConnectionBase {
  protocol: 'kubernetes';
  /** Ordered SSH connection ids; the first reachable one carries the tunnel. */
  accessHosts: string[];
  kubeconfig: { source: 'auto' } | { source: 'path'; path: string };
  /** Context in the kubeconfig; default is current-context. */
  context?: string;
  /** Namespace the tab opens with; default is "default". */
  namespace?: string;
  production: boolean;
  readOnly: boolean;
  /** Argo CD web address, normalized https (kube-links.ts httpsBase); only for links, Shellherd never calls it. */
  argoUrl?: string;
  /** Harbor web address, normalized https; images on its host get "In Harbor öffnen". */
  harborUrl?: string;
}

export type ConnectionNode = RemoteConnectionNode | LocalConnectionNode | KubernetesConnectionNode;

export interface FolderNode {
  id: string;
  type: 'folder';
  name: string;
  comment?: string;
  children: VaultNode[];
}

export type VaultNode = FolderNode | ConnectionNode;

export interface Vault {
  format: 'terminus-vault';
  version: 2;

  id: string;
  name: string;
  comment?: string;

  createdAt: string;
  updatedAt: string;

  nodes: VaultNode[];
  workspaces: Workspace[];
  settings: VaultSettings;
  /** AI providers for the terminal assistant; keys stay encrypted in the vault. */
  ai?: AiSettings;
  /** Legacy data only; retained on save, no longer used by the application. */
  workflows?: unknown;
  toolbar?: import('../toolbar').ToolbarConfig;
}

export type AiProviderKind = 'openai' | 'azure' | 'anthropic' | 'gemini';

export interface AiProvider {
  id: string;
  name: string;
  kind: AiProviderKind;
  /** Model ID; for Azure the deployment name. */
  model: string;
  apiKey?: string;
  /** OpenAI-compatible base URL, Azure endpoint, or an override for Anthropic/Gemini. */
  baseUrl?: string;
  /** Azure only, e.g. 2024-10-21. */
  apiVersion?: string;
  /** Absent or true: secrets are masked before sending; false only by the user's choice. */
  maskSecrets?: boolean;
}

export interface AiSettings {
  providers: AiProvider[];
  defaultProviderId?: string;
}

export interface Workspace {
  id: string;
  name: string;
  comment?: string;
  /** First view; kept for workspaces with a single view. */
  layout: WorkspaceLayout;
  /** All views when there are several; `layout` then equals views[0].layout. */
  views?: WorkspaceView[];
  /** Detached windows with screen position (DIP) and their own layout. */
  windows?: WorkspaceWindow[];
}

export interface WorkspaceView {
  name: string;
  layout: WorkspaceLayout;
}

export interface WorkspaceWindow {
  bounds: { x: number; y: number; width: number; height: number };
  layout: WorkspaceLayout;
  views?: WorkspaceView[];
}

export type WorkspaceLayout = WorkspacePane | WorkspaceSplit;

/** A container tab in a workspace; `index` is its position in `connectionIds` (the host's SSH connection). */
export interface WorkspaceContainerTab { index: number; target: ContainerTarget; mode: TerminalTargetMode }

/** A cluster tab; `index` is its position in `connectionIds` (the cluster connection). */
export interface WorkspaceKubeTab { index: number; view: KubeViewSnapshot }

/** Container view at `index` in `connectionIds`; a bare number means no fixed runtime. */
export interface WorkspaceContainerView { index: number; runtime?: ContainerRuntime }

export interface WorkspacePane {
  type: 'pane';
  connectionIds: string[];
  activeConnectionId?: string;
  /** Positions in `connectionIds` of SSH connections opened as file browser instead of terminal. */
  fileBrowsers?: number[];
  /** Positions in `connectionIds` of SSH connections opened as container view; objects carry a fixed runtime. */
  containerViews?: (number | WorkspaceContainerView)[];
  containerTabs?: WorkspaceContainerTab[];
  kubeTabs?: WorkspaceKubeTab[];
}

export interface WorkspaceSplit {
  type: 'split';
  direction: 'horizontal' | 'vertical';

  /**
   * Größenverhältnis des ersten Bereichs.
   * 0.5 bedeutet: beide Bereiche sind gleich groß.
   */
  ratio: number;

  first: WorkspaceLayout;
  second: WorkspaceLayout;
}

export type TerminalCursorStyle = 'block' | 'bar' | 'underline';
export interface TerminalSettings {
  /** One font name; '' = default chain. Fallbacks are always appended. */
  fontFamily: string;
  fontSize: number;
  scrollback: number;
  cursorStyle: TerminalCursorStyle;
  cursorBlink: boolean;
}

export interface VaultSettings {
  theme: 'dark' | 'light' | 'system';
  autoLockMinutes: number;
  confirmBeforeClosingSession: boolean;
  /** Absent in older vaults: DEFAULT_TIMEOUTS apply. */
  timeouts?: ConnectionTimeouts;
  /** Absent in older vaults: DEFAULT_TERMINAL_SETTINGS apply. */
  terminal?: TerminalSettings;
}
