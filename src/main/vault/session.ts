import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { hashWire, ensure, stable } from '../sync-prototype/sync-core';
import { AppError } from '../../shared/errors';
import { deriveKey, encryptVaultWithKey, unlockVault, unlockVaultWithKey } from './crypto';
import type { UnlockedVault } from './crypto';
import {
  backupVaultFile,
  readEncryptedVaultFile,
  writeEncryptedVaultFile,
} from './storage';

import { VaultSchema } from '../../shared/vault/schema';

import type { EncryptedVaultFile } from '../../shared/vault/file-format';
import type { Vault } from '../../shared/vault/types';

interface ActiveVaultSession {
  filePath: string;
  vault: Vault;
  key: Buffer;
  kdf: EncryptedVaultFile['kdf'];
  /** Older on-disk format; the original file is backed up before the first save. */
  migratedFrom?: number;
}

export interface VaultSessionSnapshot {
  filePath: string;
  vault: Vault;
}

export interface SyncLease {
  snapshot: VaultSessionSnapshot;
  key: Buffer;
  kdf: EncryptedVaultFile['kdf'];
  assertCurrent(): void;
  commit(vault: Vault, check?: () => void): Promise<VaultSessionSnapshot>;
}

export interface LockedVault { filePath: string; vaultId: string }

/** Only the same vault in the same file keeps its sessions; a replaced file counts as a switch. */
export function resumesLocked(previous: LockedVault | undefined, snapshot: { filePath: string; vault: { id: string } }): boolean {
  return previous?.filePath === snapshot.filePath && previous.vaultId === snapshot.vault.id;
}

export class VaultSessionManager {
  private activeSession:
    | ActiveVaultSession
    | undefined;

  private locked: LockedVault | undefined;
  private saving = 0;
  private syncing = false;

  /** File and vault ID locked last, until the next successful unlock; only the same vault resumes its sessions. */
  public lockedVault(): LockedVault | undefined {
    return this.locked;
  }

  public isUnlocked(): boolean {
    return this.activeSession !== undefined;
  }

  public async unlock(
    filePath: string,
    password: string,
  ): Promise<VaultSessionSnapshot> {
    const encryptedVault =
      await readEncryptedVaultFile(filePath);

    return this.open(filePath, await unlockVault(encryptedVault, password));
  }

  /** Windows Hello: the file was read before the prompt; takes ownership of key (kept on success, zeroed on failure). */
  public openWithKey(filePath: string, file: EncryptedVaultFile, key: Buffer): VaultSessionSnapshot {
    return this.open(filePath, unlockVaultWithKey(file, key));
  }

  /** File and KDF salt of the unlocked vault, for Windows Hello; core.vaultLocked without one. */
  public helloTarget(): { filePath: string; salt: string } {
    const session = this.requireSession();
    return { filePath: session.filePath, salt: session.kdf.salt };
  }

  /** Copy of the session key, only while the same file with the same KDF salt is unlocked; the caller zeroes it. */
  public keyCopy(filePath: string, salt: string): Buffer {
    const session = this.requireSession();
    if (session.filePath !== filePath || session.kdf.salt !== salt) throw new AppError('core.vaultLocked');
    return Buffer.from(session.key);
  }

  /** Constant-time check of a password against the session key; false for empty, core.vaultLocked if locked (also during derivation). */
  public async matchesPassword(password: string): Promise<boolean> {
    const session = this.requireSession();
    if (password.length === 0) return false;
    const { salt, memoryKiB, iterations, parallelism } = session.kdf;
    const candidate = await deriveKey(password, Buffer.from(salt, 'base64'), memoryKiB, iterations, parallelism);
    try {
      if (this.activeSession !== session) throw new AppError('core.vaultLocked');
      return candidate.length === session.key.length && timingSafeEqual(candidate, session.key);
    } finally {
      candidate.fill(0);
    }
  }

  private open(filePath: string, unlocked: UnlockedVault): VaultSessionSnapshot {
    /*
     * Die bestehende Session wird erst gelöscht,
     * nachdem der neue Vault erfolgreich geöffnet wurde.
     * Bei einem falschen Passwort bleibt die alte Session erhalten.
     */
    this.lock();

    this.activeSession = {
      filePath,
      vault: structuredClone(unlocked.vault),
      key: unlocked.key,
      kdf: {
        ...unlocked.kdf,
      },
      migratedFrom: unlocked.migratedFrom,
    };
    this.locked = undefined;

    return this.getSnapshot();
  }

  public async save(
    vault: Vault,
  ): Promise<VaultSessionSnapshot> {
    ensure(!this.syncing, 'changed');
    const session = this.requireSession();
    this.saving++;
    try {
      const updatedVault: Vault = {
        ...VaultSchema.parse(vault),
        updatedAt: new Date().toISOString(),
      };

      const encryptedVault = encryptVaultWithKey(
        updatedVault,
        session.key,
        session.kdf,
      );

      // A failed backup aborts the save; the original file stays untouched.
      if (session.migratedFrom !== undefined) {
        await backupVaultFile(session.filePath, `v${session.migratedFrom}`);
        session.migratedFrom = undefined;
      }

      const filePath = await writeEncryptedVaultFile(
        session.filePath,
        encryptedVault,
      );

      session.filePath = filePath;
      session.vault = updatedVault;

      // Built from local values: the session may have been locked or replaced during the awaits.
      return { filePath, vault: structuredClone(updatedVault) };
    } finally {
      this.saving--;
    }
  }

  /** Main-process-only lease. Never send key/closures over IPC. */
  public async captureForSync(): Promise<SyncLease> {
    ensure(this.isUnlocked(), 'locked'); ensure(!this.saving && !this.syncing, 'changed');
    const session = this.requireSession(); const snapshot = this.getSnapshot();
    let expected = stable(snapshot.vault); let disk = hashWire(await readFile(session.filePath, 'utf8'));
    const assertCurrent = (): void => {
      ensure(this.activeSession === session, 'locked'); ensure(!this.saving && stable(session.vault) === expected, 'changed');
    };
    assertCurrent();
    // Detect externally changed content even if it happened before the lease was taken.
    const file = await readEncryptedVaultFile(session.filePath);
    const opened = unlockVaultWithKey(file, Buffer.from(session.key));
    try { ensure(stable(opened.vault) === expected && stable(file.kdf) === stable(session.kdf), 'changed'); }
    finally { opened.key.fill(0); }
    assertCurrent();
    const assertDisk = async (): Promise<void> => { const current = hashWire(await readFile(session.filePath, 'utf8')); assertCurrent(); ensure(current === disk, 'changed'); };
    await assertDisk();
    return {
      snapshot, key: Buffer.from(session.key), kdf: { ...session.kdf }, assertCurrent,
      commit: async (vault, check = () => {}) => {
        assertCurrent(); ensure(!this.syncing, 'changed'); this.syncing = true;
        try {
          const beforeCommit = async (): Promise<void> => { check(); await assertDisk(); check(); };
          const updatedVault = VaultSchema.parse({ ...vault, updatedAt: new Date().toISOString() });
          const encrypted = encryptVaultWithKey(updatedVault, session.key, session.kdf);
          await beforeCommit(); await backupVaultFile(session.filePath, 'sync'); await beforeCommit();
          let committed = false;
          try {
            await writeEncryptedVaultFile(session.filePath, encrypted, beforeCommit, {
              durable: true,
              onCommitted: wire => {
                committed = true;
                session.vault = updatedVault; session.migratedFrom = undefined;
                expected = stable(updatedVault); disk = hashWire(wire);
              },
            });
          } catch (error) {
            if (committed) ensure(false, 'recovery');
            throw error;
          }
          assertCurrent();
          return { filePath: session.filePath, vault: structuredClone(updatedVault) };
        } finally { this.syncing = false; }
      },
    };
  }

  public getSnapshot(): VaultSessionSnapshot {
    const session = this.requireSession();

    return {
      filePath: session.filePath,
      vault: structuredClone(session.vault),
    };
  }

  public lock(): void {
    if (!this.activeSession) {
      return;
    }

    this.locked = { filePath: this.activeSession.filePath, vaultId: this.activeSession.vault.id };
    this.activeSession.key.fill(0);
    this.activeSession = undefined;
  }

  private requireSession(): ActiveVaultSession {
    if (!this.activeSession) {
      throw new AppError('core.vaultLocked');
    }

    return this.activeSession;
  }
}
