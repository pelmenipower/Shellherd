import type { SshPrepareRequest, SshSessionRequest, SshInputRequest, SshResizeRequest, SshAckRequest, SshEvent } from './ssh';
import type { Vault } from './vault/types';

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
  sshEvent: 'ssh:event',
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
  onSshEvent: (listener: (event: SshEvent) => void) => () => void;
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
