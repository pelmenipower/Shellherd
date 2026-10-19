import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { XTERM_FALLBACKS, XTERM_TOKENS, xtermTheme, type XtermColors } from './terminal-theme';

const tokens = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const keys = Object.keys(XTERM_TOKENS) as (keyof XtermColors)[];

describe('xterm theme', () => {
  for (const key of keys) {
    it(`fallback ${key} equals ${XTERM_TOKENS[key]} in tokens.css`, () => {
      const match = new RegExp(`(?<![\\w-])${XTERM_TOKENS[key]}:\\s*([^;]+);`).exec(tokens);
      expect(match?.[1].trim()).toBe(XTERM_FALLBACKS[key]);
    });
  }

  it('falls back when the tokens are empty', () => {
    expect(xtermTheme(() => '')).toEqual(XTERM_FALLBACKS);
  });

  it('trims the read values', () => {
    expect(xtermTheme(() => ' #123456 ')).toEqual({ background: '#123456', foreground: '#123456', cursor: '#123456', selectionBackground: '#123456' });
  });
});
