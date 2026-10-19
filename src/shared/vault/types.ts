import type { ConnectionIconName } from './appearance';
import type { ContainerTarget, TerminalTargetMode } from '../containers';

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
export type ConnectionProtocol = 'ssh' | 'sftp' | 'rdp' | 'powershell' | 'cmd' | 'aicli';
export type LocalShellProtocol = 'powershell' | 'cmd';

interface ConnectionBase {
  id: string;
  type: 'connection';
  name: string;
  comment?: string;

  tags: string[];
  color?: string;
  icon?: ConnectionIconName;
}

export interface SshConnectionNode extends ConnectionBase {
  protocol: 'ssh';
  host: string;
  port: number;
  username?: string;
  authentication: Authentication;
  /** Container discovery and tabs; see docs/superpowers/specs/2026-10-14-container-integration-design.md. */
  containers?: { sudo?: boolean };
}

/** File transfer over SSH; same target and authentication as an SSH connection. */
export interface SftpConnectionNode extends ConnectionBase {
  protocol: 'sftp';
  host: string;
  port: number;
  username?: string;
  authentication: Authentication;
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
export type ConnectionNode = RemoteConnectionNode | LocalConnectionNode;

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
  /** Saved commands with {{placeholders}}, typed into a terminal on demand. */
  workflows?: Workflow[];
}

export interface Workflow {
  id: string;
  name: string;
  /** One line; `{{name}}` marks a value asked for when the workflow is used. */
  command: string;
  description?: string;
  tags: string[];
  /** Shell the command is written for; absent means any. */
  shell?: 'ssh' | 'powershell' | 'cmd';
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

export interface WorkspacePane {
  type: 'pane';
  connectionIds: string[];
  activeConnectionId?: string;
  /** Positions in `connectionIds` of SSH connections opened as file browser instead of terminal. */
  fileBrowsers?: number[];
  containerTabs?: WorkspaceContainerTab[];
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

export interface VaultSettings {
  theme: 'dark' | 'light' | 'system';
  autoLockMinutes: number;
  confirmBeforeClosingSession: boolean;
}
