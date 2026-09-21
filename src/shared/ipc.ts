import type { Vault } from './vault/types';

export const IPC_CHANNELS = {
  getVersion: 'app:get-version',
  saveVault: 'vault:save',
  openVault: 'vault:open',
} as const;

export interface SaveVaultRequest {
  vault: Vault;
  password: string;
  suggestedName?: string;
}

export interface OpenVaultRequest {
  password: string;
}

export type SaveVaultResult =
  | {
      canceled: true;
    }
  | {
      canceled: false;
      filePath: string;
    };

export type OpenVaultResult =
  | {
      canceled: true;
    }
  | {
      canceled: false;
      filePath: string;
      vault: Vault;
    };

export interface DesktopApi {
  getVersion: () => Promise<string>;

  saveVault: (
    request: SaveVaultRequest,
  ) => Promise<SaveVaultResult>;

  openVault: (
    request: OpenVaultRequest,
  ) => Promise<OpenVaultResult>;
}