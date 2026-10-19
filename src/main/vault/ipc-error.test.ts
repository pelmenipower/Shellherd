import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors';
import { toVaultAppError } from './ipc-error';

const fsError = (code: string): Error => Object.assign(new Error(`${code}: raw text`), { code });

describe('toVaultAppError', () => {
  it('passes an AppError through unchanged', () => {
    const original = new AppError('core.wrongPassword');
    expect(toVaultAppError(original)).toBe(original);
  });

  it('maps file system errors', () => {
    expect(toVaultAppError(fsError('ENOENT'))).toMatchObject({ code: 'core.vaultFileNotFound' });
    for (const code of ['EACCES', 'EPERM', 'EBUSY']) {
      expect(toVaultAppError(fsError(code))).toMatchObject({ code: 'core.vaultFileAccessDenied' });
    }
  });

  it('maps everything else without leaking the message', () => {
    const mapped = toVaultAppError(new Error('ZodError [ { "path": [] } ]'));
    expect(mapped).toMatchObject({ code: 'core.vaultProcessFailed' });
    expect(mapped.message).not.toContain('Zod');
    expect(toVaultAppError('boom')).toMatchObject({ code: 'core.vaultProcessFailed' });
  });
});
