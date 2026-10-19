/** xterm colours come from tokens.css; the fallbacks are the token values and are checked by terminal-theme.test.ts. */
export type XtermColors = Record<'background' | 'foreground' | 'cursor' | 'selectionBackground', string>;
export const XTERM_FALLBACKS: Readonly<XtermColors> = { background: '#070b14', foreground: '#dce9f8', cursor: '#67e8f9', selectionBackground: '#164e63' };
export const XTERM_TOKENS: Readonly<XtermColors> = { background: '--color-bg-stage', foreground: '--color-text-code', cursor: '--color-accent', selectionBackground: '--color-selection-bg' };
export function xtermTheme(read: (name: string) => string): XtermColors {
  const pick = (key: keyof XtermColors): string => read(XTERM_TOKENS[key]).trim() || XTERM_FALLBACKS[key];
  return { background: pick('background'), foreground: pick('foreground'), cursor: pick('cursor'), selectionBackground: pick('selectionBackground') };
}
