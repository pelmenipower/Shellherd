import { expect, it } from 'vitest';
import { RECOVERY_CODE_HEX, RECOVERY_CODE_INPUT_MAX, formatRecoveryCode, normalizeRecoveryCode } from './recovery-code';

const code = '0123456789abcdef0123456789abcdef';
it('exports the fixed lengths', () => { expect(RECOVERY_CODE_HEX).toBe(32); expect(RECOVERY_CODE_INPUT_MAX).toBe(64); });
it('normalizes whitespace, dashes and case', () => {
  expect(normalizeRecoveryCode(code)).toBe(code);
  expect(normalizeRecoveryCode(' 0123-4567 89AB-CDEF\t0123-4567-89ab-cdef\n')).toBe(code);
});
it('rejects wrong length and foreign characters', () => {
  for (const bad of ['', code.slice(1), code + '0', code.replace('0', 'g'), code.replace('0', '_'), code.replace('0', 'ä')]) expect(normalizeRecoveryCode(bad)).toBeNull();
});
it('formats as eight groups of four and rejects invalid codes', () => {
  expect(formatRecoveryCode(code)).toBe('0123-4567-89ab-cdef-0123-4567-89ab-cdef');
  expect(normalizeRecoveryCode(formatRecoveryCode(code))).toBe(code);
  expect(() => formatRecoveryCode('abc')).toThrow();
});
