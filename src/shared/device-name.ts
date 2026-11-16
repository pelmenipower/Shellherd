// Device name rule shared with scripts/sync-prototype/device-name.mjs (parity test). Keep both files identical in behavior.
export const DEVICE_NAME_MAX = 64;
const ALLOWED = /^[\p{L}\p{Nd} \-_.,()']+$/u;
// Hangul fillers are letters (Lo) but render blank.
const FILLERS = /[\u{115f}\u{1160}\u{3164}\u{ffa0}]/u;
// Cyrillic/Greek letters that look like Latin hex digits; NFKC does not fold them.
const HOMOGLYPHS: Record<string, string> = { '\u{430}': 'a', '\u{441}': 'c', '\u{435}': 'e', '\u{501}': 'd', '\u{410}': 'A', '\u{412}': 'B', '\u{421}': 'C', '\u{415}': 'E', '\u{391}': 'A', '\u{392}': 'B', '\u{395}': 'E' };

/** NFC plus trim of U+0020; what clients send. */
export function normalizeDeviceName(input: string): string {
  return input.normalize('NFC').replace(/^ +| +$/g, '');
}

/** True only for an already normalized name that satisfies the rule. */
export function isDeviceName(name: unknown): name is string {
  if (typeof name !== 'string' || name !== name.normalize('NFC') || name.startsWith(' ') || name.endsWith(' ')) return false;
  const length = [...name].length;
  if (length < 1 || length > DEVICE_NAME_MAX) return false;
  if (!ALLOWED.test(name) || FILLERS.test(name)) return false;
  // A verification code must not be forgeable inside a name, even split by separators or written with look-alikes.
  const skeleton = [...name.normalize('NFKC')].map(c => HOMOGLYPHS[c] ?? c).join('').replace(/[ \-_.,()']/g, '');
  return !/[0-9a-fA-F]{8}/.test(skeleton);
}
