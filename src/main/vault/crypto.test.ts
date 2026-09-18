import { describe, expect, it } from 'vitest';

import { exampleVault } from '../../shared/vault/example';
import { decryptVault, encryptVault } from './crypto';

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

  it('rejects an incorrect password', async () => {
    const encrypted = await encryptVault(
      exampleVault,
      'richtiges passwort',
      TEST_OPTIONS,
    );

    await expect(
      decryptVault(encrypted, 'falsches passwort'),
    ).rejects.toThrow();
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
    ).rejects.toThrow();
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