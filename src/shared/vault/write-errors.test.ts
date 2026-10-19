import { describe, expect, it } from 'vitest';
import { isVaultWriteMessage, vaultWriteMessage } from './write-errors';

describe('vaultWriteMessage', () => {
  it.each([
    ['EACCES', 'Die Vault-Datei ist schreibgeschützt.'],
    ['EPERM', 'Die Vault-Datei ist schreibgeschützt.'],
    ['EROFS', 'Die Vault-Datei ist schreibgeschützt.'],
    ['EBUSY', 'Die Vault-Datei ist von einem anderen Programm gesperrt.'],
    ['ENOENT', 'Der Ordner der Vault-Datei ist nicht erreichbar.'],
    ['ENOSPC', 'Auf dem Laufwerk ist kein Platz mehr.'],
  ])('maps %s', (code, text) => {
    expect(vaultWriteMessage(code)).toBe(text);
  });

  it('returns undefined for unknown or missing codes', () => {
    expect(vaultWriteMessage('EIO')).toBeUndefined();
    expect(vaultWriteMessage(undefined)).toBeUndefined();
    expect(vaultWriteMessage('toString')).toBeUndefined();
  });
});

describe('isVaultWriteMessage', () => {
  it('accepts only the fixed messages', () => {
    expect(isVaultWriteMessage('Auf dem Laufwerk ist kein Platz mehr.')).toBe(true);
    expect(isVaultWriteMessage('Die Vault-Datei ist schreibgeschützt.')).toBe(true);
    expect(isVaultWriteMessage('EACCES: permission denied, open file')).toBe(false);
    expect(isVaultWriteMessage('')).toBe(false);
  });
});
