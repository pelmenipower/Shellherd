import { describe, expect, it } from 'vitest';
import { vaultWriteCode } from './write-errors';

describe('vaultWriteCode', () => {
  it.each([
    ['EACCES', 'core.vaultWriteReadOnly'],
    ['EPERM', 'core.vaultWriteReadOnly'],
    ['EROFS', 'core.vaultWriteReadOnly'],
    ['EBUSY', 'core.vaultWriteLocked'],
    ['ENOENT', 'core.vaultWriteFolderUnreachable'],
    ['ENOSPC', 'core.vaultWriteDiskFull'],
  ])('maps %s', (code, expected) => {
    expect(vaultWriteCode(code)).toBe(expected);
  });

  it('returns undefined for unknown or missing codes', () => {
    expect(vaultWriteCode('EIO')).toBeUndefined();
    expect(vaultWriteCode(undefined)).toBeUndefined();
    expect(vaultWriteCode('toString')).toBeUndefined();
  });
});
