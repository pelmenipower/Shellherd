import type { Vault } from './vault/types';
/** Development-only main-frame UI. Keys/tokens stay in main; validated Vault changes use the normal local session DTO. */
export type SyncLabRole = 'left' | 'right';
export type SyncLabRequest = { clientId: string } & (
  | { kind: 'start' | 'status' | 'close' }
  | { kind: 'connect'; serverUrl: string; privateNetwork?: boolean }
  | { kind: 'requestAccess' | 'refreshAccess' }
  | { kind: 'signIn'; username: string; password: string; deviceName: string }
  | { kind: 'openSession' } | { kind: 'listDevices' } | { kind: 'revokeDevice'; id: string } | { kind: 'regenerateCode' }
  | { kind: 'synchronize'; recoveryCode?: string }
  | { kind: 'keepLocal'; reviewed: true; revision: string }
  | { kind: 'importVault'; recoveryCode: string; password: string }
  | { kind: 'removeForeign' }
  | { kind: 'confirm'; sessionId: string; role: SyncLabRole; fingerprint: string; compared: true }
  | { kind: 'resolve'; sessionId: string; revision: string; reviewed: true; choices: { id: string; side: SyncLabRole }[] });
export interface SyncLabState {
  phase: 'idle' | 'serverReady' | 'compare' | 'conflict' | 'resolved' | 'failed' | 'expired';
  server?: { serverUrl: string; serverId: string; namespace: string; enrollmentAvailable?: boolean; authentication?: 'password' | 'device' | 'enrolled-device'; deviceSessions?: boolean };
  account?: { signedIn: true; username: string; device: { fingerprint: string; name: string; persistent: boolean } };
  enrolled?: { username: string; name: string };
  /** Old serverUrl when this device is enrolled for the same serverId at another address. */
  enrolledElsewhere?: string;
  identity?: { fingerprint: string; persistent: boolean };
  devices?: { id: string; name: string; enrolledAt: number; revokedAt: number | null; ephemeral: boolean; self: boolean }[];
  sync?: { status: 'synced' | 'conflict' | 'bindings'; versions: number; conflicts: number; canKeepLocal: boolean; conflictRevision?: string; approvals: number; skipped?: number; compacted?: number; removedForeign?: number; unknownAuthors?: number; quarantined?: number };
  enrollment?: { status: 'pending' | 'authorized' | 'expired'; requestId: string; fingerprint: string; deviceId: string; expiresAt: number };
  sessionId?: string;
  revision?: string;
  expiresAt?: number;
  peers?: { role: SyncLabRole; fingerprint: string; confirmed: boolean }[];
  conflicts?: { id: string; name: string; leftHost: string; rightHost: string }[];
  preservedIndependentChanges?: number;
}
export type SyncLabErrorCode = 'unavailable' | 'invalid' | 'stale' | 'mismatch' | 'expired' | 'failed' | 'connection' | 'authentication' | 'identity' | 'limit'
  | 'syncLocked' | 'syncChanged' | 'syncHistory' | 'syncWrongVault' | 'syncRecovery' | 'syncLimit' | 'syncConflict' | 'syncBindings'
  | 'syncKey' | 'syncRecoveryCode' | 'syncMigrate' | 'samePassword' | 'samePasswordImport';
/** recoveryCode exists only in a reply, never in SyncLabState. */
export type SyncLabReply = { ok: true; state: SyncLabState; vaultChanged?: { filePath: string; vault: Vault }; recoveryCode?: string }
  | { ok: false; code: SyncLabErrorCode; state?: SyncLabState };
