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

export interface ConnectionNode {
  id: string;
  type: 'connection';
  name: string;
  comment?: string;

  host: string;
  port: number;
  username?: string;

  authentication: Authentication;

  tags: string[];
  color?: string;
  icon?: ConnectionIconName;
}

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
  version: 1;

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
