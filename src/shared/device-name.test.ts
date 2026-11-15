import { describe, expect, it } from 'vitest';
import { DEVICE_NAME_MAX, isDeviceName, normalizeDeviceName } from './device-name';

const valid = ['Laptop-2024', 'Büro-PC (alt)', 'Gerät A k3x9z', '\u{41d}\u{43e}\u{443}\u{442}\u{431}\u{443}\u{43a}', "O'Brien"];
const invalid: Array<[string, string]> = [
  ['empty', ''], ['65 chars', 'a'.repeat(65)], ['newline', 'a\nb'], ['bidi override', 'a\u{202e}b'], ['zero width space', 'a\u{200b}b'],
  ['hangul filler', 'a\u{3164}b'], ['not NFC', 'a\u{301}'], ['hex run', '3f9a12c4'], ['hex run split by space', '3f9a 12c4'],
  ['fullwidth', 'ＡＢＣＤ１２３４'], ['cyrillic look-alikes', '3f9\u{430}12\u{441}4'], ['hex words', 'Cafe Bad Deck'], ['date', '20241110'],
  ['leading space', ' a'], ['trailing space', 'a '],
];

describe('device name rule', () => {
  it.each(valid)('accepts %s', name => { expect(isDeviceName(name)).toBe(true); });
  it.each(invalid)('rejects %s', (_label, name) => { expect(isDeviceName(name)).toBe(false); });
  it('counts code points and caps at 64', () => {
    expect(DEVICE_NAME_MAX).toBe(64);
    expect(isDeviceName('x'.repeat(64))).toBe(true);
    expect(isDeviceName('😀')).toBe(false);
  });
  it('rejects non-strings', () => { expect(isDeviceName(7)).toBe(false); expect(isDeviceName(undefined)).toBe(false); });
  it('normalizes NFC and trims U+0020 only', () => {
    expect(normalizeDeviceName('  a\u{301}  ')).toBe('\u{e1}');
    expect(isDeviceName(normalizeDeviceName('  Büro  '))).toBe(true);
  });
  it('gives the same answers as scripts/sync-prototype/device-name.mjs', async () => {
    // @ts-expect-error The dev script has no type declarations.
    const mjs = await import('../../scripts/sync-prototype/device-name.mjs') as { isDeviceName(n: unknown): boolean; normalizeDeviceName(n: string): string; DEVICE_NAME_MAX: number };
    expect(mjs.DEVICE_NAME_MAX).toBe(DEVICE_NAME_MAX);
    for (const name of [...valid, ...invalid.map(([, n]) => n), 'a\u{301}', 'x'.repeat(64), 'x'.repeat(65), '\u{1160}', '\u{ffa0}a', 'ａｂｃｄｅｆ１２']) {
      expect(mjs.isDeviceName(name)).toBe(isDeviceName(name));
      expect(mjs.normalizeDeviceName(name)).toBe(normalizeDeviceName(name));
    }
  });
});
