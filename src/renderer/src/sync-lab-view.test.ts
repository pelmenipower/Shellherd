import { describe, expect, it } from 'vitest';
import { canRevoke, enrollReady, importReady, needsRecoveryCode, recoveryCodeValid } from './sync-lab-view';

const CODE = '0123456789abcdef0123456789abcdef';
describe('sync lab view rules', () => {
  it('asks for the recovery code only for its two error codes', () => {
    expect(needsRecoveryCode('syncKey')).toBe(true);
    expect(needsRecoveryCode('syncRecoveryCode')).toBe(true);
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
    expect(importReady(CODE, 'a', 'a')).toBe(true);
    expect(importReady(CODE, 'a', 'b')).toBe(false);
    expect(importReady(CODE, '', '')).toBe(false);
    expect(importReady('abc', 'a', 'a')).toBe(false);
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
    expect(enrollReady('alice', 'pw', 'x'.repeat(81))).toBe(false);
  });
});
