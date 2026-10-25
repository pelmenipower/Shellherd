import { describe, expect, it } from 'vitest';

import { exampleVault } from '../../shared/vault/example';
import { encryptVault, unlockVault, unlockVaultWithKey } from './crypto';
import { decryptVault } from '../../test/vault-helpers';

const TEST_OPTIONS = {
  memoryKiB: 16_384,
  iterations: 1,
  parallelism: 1,
};

describe('vault encryption', () => {
  it('encrypts and decrypts a vault', async () => {
    const encrypted = await encryptVault(
      exampleVault,
      'ein gutes testpasswort',
      TEST_OPTIONS,
    );

    const decrypted = await decryptVault(
      encrypted,
      'ein gutes testpasswort',
    );

    expect(decrypted).toEqual(exampleVault);
  });

  it('reports a structurally wrong file as damaged', async () => {
    await expect(decryptVault({ unexpected: true }, 'passwort')).rejects.toThrow(
      expect.objectContaining({ code: 'core.vaultFileCorrupt' }),
    );
  });

  it('rejects an incorrect password', async () => {
    const encrypted = await encryptVault(
      exampleVault,
      'richtiges passwort',
      TEST_OPTIONS,
    );

    await expect(
      decryptVault(encrypted, 'falsches passwort'),
    ).rejects.toThrow(expect.objectContaining({ code: 'core.wrongPassword' }));
  });

  it('detects a manipulated payload', async () => {
    const encrypted = await encryptVault(
      exampleVault,
      'testpasswort',
      TEST_OPTIONS,
    );

    encrypted.payload =
      encrypted.payload.slice(0, -4) + 'AAAA';

    await expect(
      decryptVault(encrypted, 'testpasswort'),
    ).rejects.toThrow(expect.objectContaining({ code: 'core.wrongPassword' }));
  });

  it('never stores the plaintext password', async () => {
    const password = 'mein-geheimes-passwort';

    const encrypted = await encryptVault(
      exampleVault,
      password,
      TEST_OPTIONS,
    );

    const serialized = JSON.stringify(encrypted);

    expect(serialized).not.toContain(password);
  });
});

describe('unlockVaultWithKey', () => {
  it('opens with the right key and zeroes a wrong or short one', async () => {
    const file = await encryptVault(exampleVault, 'ein gutes testpasswort', TEST_OPTIONS);
    const { key } = await unlockVault(file, 'ein gutes testpasswort');
    const opened = unlockVaultWithKey(file, key);
    expect(opened.vault).toEqual(exampleVault);
    expect(opened.key).toBe(key);
    expect(opened.kdf).toEqual(file.kdf);
    const wrong = Buffer.alloc(32, 1);
    expect(() => unlockVaultWithKey(file, wrong)).toThrow(expect.objectContaining({ code: 'core.wrongPassword' }));
    expect(wrong.equals(Buffer.alloc(32))).toBe(true);
    const short = Buffer.alloc(31, 1);
    expect(() => unlockVaultWithKey(file, short)).toThrow(expect.objectContaining({ code: 'core.vaultKeyLength' }));
    expect(short.equals(Buffer.alloc(31))).toBe(true);
  });
});