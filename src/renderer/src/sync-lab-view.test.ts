import { describe, expect, it } from 'vitest';
import { canRevoke, deferVaultChange, enrollReady, importReady, inviteReady, needsRecoveryCode, passwordTooShort, recoveryCodeValid } from './sync-lab-view';

const CODE = '0123456789abcdef0123456789abcdef';
describe('sync lab view rules', () => {
  it('asks for the recovery code only for its two error codes', () => {
    expect(needsRecoveryCode('syncKey')).toBe(true);
    expect(needsRecoveryCode('syncRecoveryCode')).toBe(true);
    expect(needsRecoveryCode('syncRotated')).toBe(true);
    expect(needsRecoveryCode('syncInviteKey')).toBe(true);
    expect(needsRecoveryCode('failed')).toBe(false);
    expect(needsRecoveryCode(null)).toBe(false);
  });
  it('accepts grouped codes and rejects malformed ones', () => {
    expect(recoveryCodeValid(CODE)).toBe(true);
    expect(recoveryCodeValid(CODE.match(/.{4}/g)!.join('-').toUpperCase())).toBe(true);
    expect(recoveryCodeValid(CODE.slice(1))).toBe(false);
    expect(recoveryCodeValid(`${CODE}0`)).toBe(false);
    expect(recoveryCodeValid('g'.repeat(32))).toBe(false);
  });
  it('blocks the import for unequal or empty passwords and bad codes', () => {
    expect(importReady(CODE, 'abcdefgh', 'abcdefgh')).toBe(true);
    expect(importReady(CODE, 'abcdefgh', 'abcdefgi')).toBe(false);
    expect(importReady(CODE, '', '')).toBe(false);
    expect(importReady('abc', 'abcdefgh', 'abcdefgh')).toBe(false);
  });
  it('requires the vault password minimum of 8 characters (C5)', () => {
    expect(importReady(CODE, 'abcdefg', 'abcdefg')).toBe(false);
    expect(passwordTooShort('')).toBe(false);
    expect(passwordTooShort('abcdefg')).toBe(true);
    expect(passwordTooShort('abcdefgh')).toBe(false);
  });
  it('offers removal only for other, active devices', () => {
    expect(canRevoke({ id: 'a', self: false, revokedAt: null })).toBe(true);
    expect(canRevoke({ id: 'a', self: true, revokedAt: null })).toBe(false);
    expect(canRevoke({ id: 'a', self: false, revokedAt: 5 })).toBe(false);
  });
  it('validates the enrollment form', () => {
    expect(enrollReady('alice', 'pw', 'Laptop')).toBe(true);
    expect(enrollReady('a b', 'pw', 'Laptop')).toBe(false);
    expect(enrollReady('alice', '', 'Laptop')).toBe(false);
    expect(enrollReady('alice', 'pw', '  ')).toBe(false);
    expect(enrollReady('alice', 'pw', 'x'.repeat(65))).toBe(false);
    expect(enrollReady('alice', 'pw', 'x'.repeat(64))).toBe(true);
    expect(enrollReady('alice', 'pw', ' Laptop ')).toBe(true); // Trimmed before sending.
    expect(enrollReady('alice', 'pw', '20241110')).toBe(false);
    expect(enrollReady('alice', 'pw', 'Cafe Bad Deck')).toBe(false);
    expect(enrollReady('alice', 'pw', 'Laptop-2024')).toBe(true);
  });
  it('blocks enrollment for another known address until it is confirmed (C1)', () => {
    expect(enrollReady('alice', 'pw', 'Laptop', false)).toBe(false);
    expect(enrollReady('alice', 'pw', 'Laptop', true)).toBe(true);
  });
});

describe('enrollment code rules', () => {
  it('needs no recovery code for an import while an enrollment code is held', () => {
    expect(importReady('', 'abcdefgh', 'abcdefgh', true)).toBe(true);
    expect(importReady('', 'abcdefgh', 'abcdefgh')).toBe(false);
    expect(importReady('', 'abcdefg', 'abcdefg', true)).toBe(false);
    expect(importReady('', 'abcdefgh', 'abcdefgi', true)).toBe(false);
  });
  it('enrolls with a valid code, a valid device name and the confirmation', () => {
    expect(inviteReady(CODE, 'Laptop')).toBe(true);
    expect(inviteReady(CODE.match(/.{4}/g)!.join('-'), 'Laptop')).toBe(true);
    expect(inviteReady('abc', 'Laptop')).toBe(false);
    expect(inviteReady(CODE, '20241110')).toBe(false);
    expect(inviteReady(CODE, 'Laptop', false)).toBe(false);
  });
});

describe('vault change after a sync', () => {
  it('holds the vault change back while a new recovery code is still on screen', () => {
    expect(deferVaultChange({ vaultChanged: {}, recoveryCode: 'code' })).toBe(true);
    expect(deferVaultChange({ vaultChanged: {} })).toBe(false);
    expect(deferVaultChange({ recoveryCode: 'code' })).toBe(false);
  });
});
