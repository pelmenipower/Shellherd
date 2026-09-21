import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  mkdtemp,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  decryptVault,
  encryptVault,
} from './crypto';
import {
  readEncryptedVaultFile,
  writeEncryptedVaultFile,
} from './storage';
import { VaultSessionManager } from './session';
import { exampleVault } from '../../shared/vault/example';

const temporaryDirectories: string[] = [];

async function createTestVault(): Promise<{
  directory: string;
  filePath: string;
  password: string;
}> {
  const directory = await mkdtemp(
    join(tmpdir(), 'terminus-session-test-'),
  );

  temporaryDirectories.push(directory);

  const filePath = join(
    directory,
    'session.terminus',
  );

  const password = 'synthetic-vault-pw';

  const encryptedVault = await encryptVault(
    exampleVault,
    password,
    {
      memoryKiB: 16_384,
      iterations: 1,
      parallelism: 1,
    },
  );

  await writeEncryptedVaultFile(
    filePath,
    encryptedVault,
  );

  return {
    directory,
    filePath,
    password,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(
      (directory) =>
        rm(directory, {
          recursive: true,
          force: true,
        }),
    ),
  );
});

describe('VaultSessionManager', () => {
  it('unlocks a vault without exposing the key', async () => {
    const { filePath, password } =
      await createTestVault();

    const manager = new VaultSessionManager();

    const snapshot = await manager.unlock(
      filePath,
      password,
    );

    expect(manager.isUnlocked()).toBe(true);
    expect(snapshot.filePath).toBe(filePath);
    expect(snapshot.vault).toEqual(exampleVault);
    expect(snapshot).not.toHaveProperty('key');

    manager.lock();
  });

  it('saves changes with the session key', async () => {
    const { filePath, password } =
      await createTestVault();

    const manager = new VaultSessionManager();

    const snapshot = await manager.unlock(
      filePath,
      password,
    );

    await manager.save({
      ...snapshot.vault,
      name: 'Gespeicherter Session-Vault',
    });

    manager.lock();

    const encryptedVault =
      await readEncryptedVaultFile(filePath);

    const persistedVault = await decryptVault(
      encryptedVault,
      password,
    );

    expect(persistedVault.name).toBe(
      'Gespeicherter Session-Vault',
    );
  });

  it('rejects saving after the vault was locked', async () => {
    const { filePath, password } =
      await createTestVault();

    const manager = new VaultSessionManager();

    const snapshot = await manager.unlock(
      filePath,
      password,
    );

    manager.lock();

    expect(manager.isUnlocked()).toBe(false);

    await expect(
      manager.save(snapshot.vault),
    ).rejects.toThrow(
      'Es ist kein Vault entsperrt.',
    );
  });
});