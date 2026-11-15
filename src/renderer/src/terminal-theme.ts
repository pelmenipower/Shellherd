import type { ISearchOptions } from '@xterm/addon-search';

/** xterm colours come from tokens.css; the fallbacks are the token values and are checked by terminal-theme.test.ts. */
export type XtermColors = Record<'background' | 'foreground' | 'cursor' | 'selectionBackground', string>;
export const XTERM_FALLBACKS: Readonly<XtermColors> = { background: '#0b1018', foreground: '#e6e2dc', cursor: '#e8935a', selectionBackground: '#3f2e22' };
export const XTERM_TOKENS: Readonly<XtermColors> = { background: '--color-bg-stage', foreground: '--color-text-code', cursor: '--color-accent', selectionBackground: '--color-selection-bg' };
export function xtermTheme(read: (name: string) => string): XtermColors {
  const pick = (key: keyof XtermColors): string => read(XTERM_TOKENS[key]).trim() || XTERM_FALLBACKS[key];
  return { background: pick('background'), foreground: pick('foreground'), cursor: pick('cursor'), selectionBackground: pick('selectionBackground') };
}
export const LIGHT_SCHEME_QUERY = '(prefers-color-scheme: light)';
/** Light stage: xterm lifts every foreground to WCAG AA against its cell background; dark keeps xterm's palette as is. */
export function xtermContrast(light: boolean): number { return light ? 4.5 : 1; }

/** Search hit colours for the search addon's decorations; xterm needs #RRGGBB, which terminal-theme.test.ts checks in tokens.css. */
export type XtermSearchColors = Record<'match' | 'activeMatch' | 'activeBorder', string>;
export const XTERM_SEARCH_FALLBACKS: Readonly<XtermSearchColors> = { match: '#4a3f12', activeMatch: '#7a5c08', activeBorder: '#facc15' };
export const XTERM_SEARCH_TOKENS: Readonly<XtermSearchColors> = { match: '--color-match-bg', activeMatch: '--color-match-current-bg', activeBorder: '--color-match-current-border' };
export function xtermSearchDecorations(read: (name: string) => string): NonNullable<ISearchOptions['decorations']> {
  const pick = (key: keyof XtermSearchColors): string => read(XTERM_SEARCH_TOKENS[key]).trim() || XTERM_SEARCH_FALLBACKS[key];
  // The overview ruler colours are required by the type; there is no ruler option, so they repeat the hit colours.
  return { matchBackground: pick('match'), matchOverviewRuler: pick('match'), activeMatchBackground: pick('activeMatch'), activeMatchColorOverviewRuler: pick('activeMatch'), activeMatchBorder: pick('activeBorder') };
}
