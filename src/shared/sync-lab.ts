import type { Vault } from './vault/types';
/** Development-only main-frame UI. Keys/tokens stay in main; validated Vault changes use the normal local session DTO. */
export type SyncLabRole = 'left' | 'right';
export type SyncLabRequest = { clientId: string } & (
  | { kind: 'start' | 'status' | 'close' }
  | { kind: 'connect'; serverUrl: string }
  | { kind: 'requestAccess' | 'refreshAccess' }
  | { kind: 'signIn'; username: string; password: string }
  | { kind: 'synchronize' }
  | { kind: 'keepLocal'; reviewed: true; revision: string }
  | { kind: 'importVault'; password: string }
  | { kind: 'confirm'; sessionId: string; role: SyncLabRole; fingerprint: string; compared: true }
  | { kind: 'resolve'; sessionId: string; revision: string; reviewed: true; choices: { id: string; side: SyncLabRole }[] });
export interface SyncLabState {
  phase: 'idle' | 'serverReady' | 'compare' | 'conflict' | 'resolved' | 'failed' | 'expired';
  server?: { serverUrl: string; serverId: string; namespace: string; enrollmentAvailable?: boolean; authentication?: 'password' | 'device' };
  account?: { signedIn: true; username: string };
  sync?: { status: 'synced' | 'conflict' | 'bindings'; versions: number; conflicts: number; canKeepLocal: boolean; conflictRevision?: string; approvals: number; skipped?: number };
  enrollment?: { status: 'pending' | 'authorized' | 'expired'; requestId: string; fingerprint: string; deviceId: string; expiresAt: number };
  sessionId?: string;
  revision?: string;
  expiresAt?: number;
  peers?: { role: SyncLabRole; fingerprint: string; confirmed: boolean }[];
  conflicts?: { id: string; name: string; leftHost: string; rightHost: string }[];
  preservedIndependentChanges?: number;
}
export type SyncLabReply = { ok: true; state: SyncLabState; vaultChanged?: { filePath: string; vault: Vault } }
  | { ok: false; code: 'unavailable' | 'invalid' | 'stale' | 'mismatch' | 'expired' | 'failed' | 'connection' | 'authentication' | 'syncLocked' | 'syncChanged' | 'syncHistory' | 'syncWrongVault' | 'syncRecovery' | 'syncLimit' | 'syncConflict' | 'syncBindings' | 'samePassword'; state?: SyncLabState };
