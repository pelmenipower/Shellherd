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
