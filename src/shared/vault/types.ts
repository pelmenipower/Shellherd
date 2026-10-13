import type { ConnectionIconName } from './appearance';

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
export type ConnectionProtocol = 'ssh' | 'rdp' | 'powershell' | 'cmd';
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

export type RemoteConnectionNode = SshConnectionNode | RdpConnectionNode;
export type ConnectionNode = RemoteConnectionNode | LocalShellConnectionNode;

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
}

export interface Workspace {
  id: string;
  name: string;
  comment?: string;
  layout: WorkspaceLayout;
  /** Detached windows with screen position (DIP) and their own layout. */
  windows?: WorkspaceWindow[];
}

export interface WorkspaceWindow {
  bounds: { x: number; y: number; width: number; height: number };
  layout: WorkspaceLayout;
}

export type WorkspaceLayout = WorkspacePane | WorkspaceSplit;

export interface WorkspacePane {
  type: 'pane';
  connectionIds: string[];
  activeConnectionId?: string;
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
