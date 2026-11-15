/** Recovery code helpers; pure (no node:*) so the renderer can import them. */
export const RECOVERY_CODE_HEX = 32;
export const RECOVERY_CODE_INPUT_MAX = 64;
const CODE = /^[0-9a-f]{32}$/;
/** Strips whitespace and '-', lower-cases; exactly 32 hex digits or null. */
export function normalizeRecoveryCode(input: string): string | null {
  if (typeof input !== 'string') return null;
  const code = input.replace(/[\s-]/g, '').toLowerCase();
  return CODE.test(code) ? code : null;
}
/** Eight groups of four, separated by '-'; throws for an invalid code. */
export function formatRecoveryCode(code: string): string {
  const normalized = normalizeRecoveryCode(code);
  if (normalized === null) throw new Error('Invalid recovery code');
  return normalized.match(/.{4}/g)!.join('-');
}
