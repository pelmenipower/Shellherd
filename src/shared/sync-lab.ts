import type { Vault } from './vault/types';
/** Development-only main-frame UI. Keys/tokens stay in main; validated Vault changes use the normal local session DTO. */
export type SyncLabRequest = { clientId: string } & (
  | { kind: 'status' | 'close' }
  | { kind: 'connect'; serverUrl: string; privateNetwork?: boolean }
  | { kind: 'signIn'; username: string; password: string; deviceName: string; confirmElsewhere?: true }
  | { kind: 'openSession' } | { kind: 'listDevices' } | { kind: 'revokeDevice'; id: string } | { kind: 'regenerateCode'; confirmed: true }
  | { kind: 'synchronize'; recoveryCode?: string }
  | { kind: 'keepLocal'; reviewed: true; revision: string }
  | { kind: 'importVault'; recoveryCode: string; password: string }
  | { kind: 'removeForeign'; versions?: true });
export interface SyncLabState {
  phase: 'idle' | 'serverReady';
  server?: { serverUrl: string; serverId: string; namespace: string; enrollmentAvailable?: boolean; authentication?: 'password' | 'device' | 'enrolled-device'; deviceSessions?: boolean };
  account?: { signedIn: true; username: string; device: { fingerprint: string; name: string; persistent: boolean } };
  enrolled?: { username: string; name: string };
  /** Old serverUrl when this device is enrolled for the same serverId at another address. */
  enrolledElsewhere?: string;
  identity?: { fingerprint: string; persistent: boolean };
  devices?: { id: string; name: string; enrolledAt: number; revokedAt: number | null; ephemeral: boolean; self: boolean }[];
  sync?: { status: 'synced' | 'conflict' | 'bindings'; versions: number; conflicts: number; canKeepLocal: boolean; conflictRevision?: string; approvals: number; skipped?: number; compacted?: number; removedForeign?: number; unknownAuthors?: number; quarantined?: number };
}
export type SyncLabErrorCode = 'unavailable' | 'invalid' | 'stale' | 'connection' | 'authentication' | 'identity' | 'limit' | 'enrolledElsewhere'
  | 'syncLocked' | 'syncChanged' | 'syncHistory' | 'syncWrongVault' | 'syncRecovery' | 'syncLimit' | 'syncConflict' | 'syncBindings'
  | 'syncKey' | 'syncRecoveryCode' | 'syncMigrate' | 'syncForeignKey' | 'syncOtherServer' | 'syncPlatform' | 'samePassword' | 'samePasswordImport';
/** recoveryCode exists only in a reply, never in SyncLabState. */
export type SyncLabReply = { ok: true; state: SyncLabState; vaultChanged?: { filePath: string; vault: Vault }; recoveryCode?: string }
  | { ok: false; code: SyncLabErrorCode; state?: SyncLabState };
