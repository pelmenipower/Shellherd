import { AppError } from '../../shared/errors';
import {
  encryptVaultWithKey,
  unlockVault,
} from './crypto';
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

export interface LockedVault { filePath: string; vaultId: string }

export class VaultSessionManager {
  private activeSession:
    | ActiveVaultSession
    | undefined;

  private locked: LockedVault | undefined;

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

    const unlocked = await unlockVault(
      encryptedVault,
      password,
    );

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
    const session = this.requireSession();

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