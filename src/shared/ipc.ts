import type { SshPrepareRequest, SshSessionRequest, SshInputRequest, SshResizeRequest, SshAckRequest, SshEvent } from './ssh';
import type { Vault } from './vault/types';
import type { RdpBoundsRequest, RdpEvent, RdpOpenRequest, RdpSessionRequest, RdpVisibleRequest } from './rdp';

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
  rdpOpen: 'rdp:open',
  rdpBounds: 'rdp:bounds',
  rdpVisible: 'rdp:visible',
  rdpFocus: 'rdp:focus',
  rdpClose: 'rdp:close',
  rdpDebugHang: 'rdp:debug-hang',
  rdpEvent: 'rdp:event',
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
  rdpOpen: (request: RdpOpenRequest) => Promise<{ sessionId: string }>;
  rdpBounds: (request: RdpBoundsRequest) => Promise<void>;
  rdpVisible: (request: RdpVisibleRequest) => Promise<void>;
  rdpFocus: (request: RdpSessionRequest) => Promise<void>;
  rdpClose: (request: RdpSessionRequest) => Promise<void>;
  rdpDebugHang: (request: { ms: number }) => Promise<void>;
  onRdpEvent: (listener: (event: RdpEvent) => void) => () => void;
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
