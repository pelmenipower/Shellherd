import {
  describe,
  expect,
  it,
} from 'vitest';

import { decryptVault } from '../../test/vault-helpers';
import {
  encryptVault,
  encryptVaultWithKey,
  unlockVault,
} from './crypto';
import { exampleVault } from '../../shared/vault/example';

describe('vault session key', () => {
  it('saves changes without retaining the password', async () => {
    const password = 'synthetic-vault-pw';

    const initialFile = await encryptVault(
      exampleVault,
      password,
      {
        memoryKiB: 16_384,
        iterations: 1,
        parallelism: 1,
      },
    );

    const unlocked = await unlockVault(
      initialFile,
      password,
    );

    try {
      const updatedVault = {
        ...unlocked.vault,
        name: 'Geänderter Vault',
        updatedAt: new Date().toISOString(),
      };

      const updatedFile = encryptVaultWithKey(
        updatedVault,
        unlocked.key,
        unlocked.kdf,
      );

      const decryptedVault = await decryptVault(
        updatedFile,
        password,
      );

      expect(decryptedVault.name).toBe(
        'Geänderter Vault',
      );

      expect(updatedFile.cipher.nonce).not.toBe(
        initialFile.cipher.nonce,
      );
    } finally {
      unlocked.key.fill(0);
    }
  });

  it('allows the session key to be erased', async () => {
    const encryptedFile = await encryptVault(
      exampleVault,
      'synthetic-vault-pw',
      {
        memoryKiB: 16_384,
        iterations: 1,
        parallelism: 1,
      },
    );

    const unlocked = await unlockVault(
      encryptedFile,
      'synthetic-vault-pw',
    );

    unlocked.key.fill(0);

    expect(
      Array.from(unlocked.key).every(
        (value) => value === 0,
      ),
    ).toBe(true);
  });
});