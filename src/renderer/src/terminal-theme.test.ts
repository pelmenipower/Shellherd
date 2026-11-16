import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIGHT_SCHEME_QUERY, XTERM_FALLBACKS, XTERM_SEARCH_FALLBACKS, XTERM_SEARCH_TOKENS, XTERM_TOKENS, xtermContrast, xtermSearchDecorations, xtermTheme, type XtermColors, type XtermSearchColors } from './terminal-theme';

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

describe('xterm search colours', () => {
  const searchKeys = Object.keys(XTERM_SEARCH_TOKENS) as (keyof XtermSearchColors)[];
  for (const key of searchKeys) {
    const name = XTERM_SEARCH_TOKENS[key];
    const values = [...tokens.matchAll(new RegExp(`(?<![\\w-])${name}:\\s*([^;]+);`, 'g'))].map(match => match[1].trim());
    it(`fallback ${key} equals the dark ${name}`, () => {
      expect(values[0]).toBe(XTERM_SEARCH_FALLBACKS[key]);
    });
    it(`${name} is #RRGGBB in the dark and the light block`, () => {
      expect(values).toHaveLength(2);
      for (const value of values) expect(value).toMatch(/^#[0-9a-f]{6}$/i);
    });
  }

  it('falls back when the tokens are empty', () => {
    expect(xtermSearchDecorations(() => '')).toEqual({
      matchBackground: '#4a3f12', matchOverviewRuler: '#4a3f12', activeMatchBackground: '#7a5c08', activeMatchColorOverviewRuler: '#7a5c08', activeMatchBorder: '#facc15' });
  });

  it('maps the tokens to the decoration fields and trims', () => {
    const values: Record<string, string> = { '--color-match-bg': ' #111111 ', '--color-match-current-bg': '#222222', '--color-match-current-border': '#333333' };
    expect(xtermSearchDecorations(name => values[name])).toEqual({
      matchBackground: '#111111', matchOverviewRuler: '#111111', activeMatchBackground: '#222222', activeMatchColorOverviewRuler: '#222222', activeMatchBorder: '#333333' });
  });
});

describe('xterm contrast', () => {
  it('lifts the foreground to AA on the light stage', () => {
    expect(xtermContrast(true)).toBe(4.5);
  });

  it('keeps xterm\'s palette as is on the dark stage', () => {
    expect(xtermContrast(false)).toBe(1);
  });

  it('queries the light colour scheme', () => {
    expect(LIGHT_SCHEME_QUERY).toBe('(prefers-color-scheme: light)');
  });
});
