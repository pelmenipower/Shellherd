import { describe, expect, it } from 'vitest';
import { isTypeaheadKey, typeahead } from './file-typeahead';
import type { Typeahead } from './file-typeahead';

const names = ['Bilder', 'www', 'alpha.txt', 'Beta.md', 'bravo.sh', 'ärger.txt'];

/** Types keys one after another and returns the visited names. */
function type(list: string[], keys: [string, number][], start: string | null = null): (string | null)[] {
  let cursor = start;
  let state: Typeahead | null = null;
  return keys.map(([key, at]) => {
    const hit = typeahead(list, cursor, state, key, at);
    state = hit.state;
    if (hit.name) cursor = hit.name;
    return hit.name;
  });
}

describe('typeahead', () => {
  it('cycles through matches of one character, ignoring case, and wraps', () => {
    expect(type(names, [['b', 0], ['b', 1300], ['b', 2600], ['b', 3900]])).toEqual(['Bilder', 'Beta.md', 'bravo.sh', 'Bilder']);
  });

  it('extends the prefix within the window, searching from the cursor inclusive', () => {
    expect(typeahead(names, 'Bilder', { text: 'b', at: 0 }, 'r', 300).name).toBe('bravo.sh');
  });

  it('starts a new buffer after the window and keeps it on no match', () => {
    const hit = typeahead(names, 'Bilder', { text: 'b', at: 0 }, 'r', 1500);
    expect(hit.name).toBeNull();
    expect(hit.state.text).toBe('r');
  });

  it('matches umlauts in either case', () => {
    expect(typeahead(names, null, null, 'ä', 0).name).toBe('ärger.txt');
    expect(typeahead(names, null, null, 'Ä', 0).name).toBe('ärger.txt');
  });

  it('stays on the only match when repeated', () => {
    expect(type(names, [['w', 0], ['w', 100]])).toEqual(['www', 'www']);
  });

  it('returns null for an empty list', () => {
    expect(typeahead([], null, null, 'a', 0).name).toBeNull();
  });

  it('treats b then B as a repeat, not as the prefix bb', () => {
    expect(typeahead(names, 'Bilder', { text: 'b', at: 0 }, 'B', 200).name).toBe('Beta.md');
  });

  it('does not throw for a prefix without cursor after a miss', () => {
    expect(type(['alpha'], [['q', 0], ['u', 100]])).toEqual([null, null]);
    expect(type(['xa.txt'], [['x', 0], ['a', 100]])).toEqual(['xa.txt', 'xa.txt']);
  });
});

describe('isTypeaheadKey', () => {
  const key = (k: string, mods: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean } = {}) => isTypeaheadKey({ key: k, ctrlKey: false, altKey: false, metaKey: false, ...mods });

  it('accepts single printable characters', () => {
    expect(key('a')).toBe(true);
    expect(key('ä')).toBe(true);
    expect(key('.')).toBe(true);
  });

  it('rejects space, named keys and modifier combinations', () => {
    expect(key(' ')).toBe(false);
    expect(key('F5')).toBe(false);
    expect(key('Backspace')).toBe(false);
    expect(key('Dead')).toBe(false);
    expect(key('a', { ctrlKey: true })).toBe(false);
    expect(key('a', { altKey: true })).toBe(false);
    expect(key('a', { metaKey: true })).toBe(false);
  });

  it('rejects AltGr characters, which Chromium reports as Ctrl+Alt', () => {
    expect(key('@', { ctrlKey: true, altKey: true })).toBe(false);
  });
});
