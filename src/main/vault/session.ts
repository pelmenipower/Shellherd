import {
  encryptVaultWithKey,
  unlockVault,
} from './crypto';
import {
  readEncryptedVaultFile,
  writeEncryptedVaultFile,
} from './storage';

import type { EncryptedVaultFile } from '../../shared/vault/file-format';
import type { Vault } from '../../shared/vault/types';

interface ActiveVaultSession {
  filePath: string;
  vault: Vault;
  key: Buffer;
  kdf: EncryptedVaultFile['kdf'];
}

export interface VaultSessionSnapshot {
  filePath: string;
  vault: Vault;
}

export class VaultSessionManager {
  private activeSession:
    | ActiveVaultSession
    | undefined;

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
    };

    return this.getSnapshot();
  }

  public async save(
    vault: Vault,
  ): Promise<VaultSessionSnapshot> {
    const session = this.requireSession();

    const updatedVault: Vault = {
      ...structuredClone(vault),
      updatedAt: new Date().toISOString(),
    };

    const encryptedVault = encryptVaultWithKey(
      updatedVault,
      session.key,
      session.kdf,
    );

    const filePath = await writeEncryptedVaultFile(
      session.filePath,
      encryptedVault,
    );

    session.filePath = filePath;
    session.vault = structuredClone(updatedVault);

    return this.getSnapshot();
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

    this.activeSession.key.fill(0);
    this.activeSession = undefined;
  }

  private requireSession(): ActiveVaultSession {
    if (!this.activeSession) {
      throw new Error(
        'Es ist kein Vault entsperrt.',
      );
    }

    return this.activeSession;
  }
}