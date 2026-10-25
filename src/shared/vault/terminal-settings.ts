import type { TerminalSettings, VaultSettings } from './types';

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = { fontFamily: '', fontSize: 14, scrollback: 5000, cursorStyle: 'block', cursorBlink: true };
export const TERMINAL_LIMITS = { fontSize: [8, 32], scrollback: [1_000, 50_000] } as const satisfies Record<'fontSize' | 'scrollback', readonly [number, number]>;
export const FONT_FAMILY_MAX = 64;
/** Letters, digits, space, dot, underscore, hyphen; '' allowed. No quotes or commas: the name goes into a CSS font list. */
export const FONT_FAMILY_PATTERN = /^[\p{L}\p{N} ._-]*$/u;
export const FALLBACK_FONTS = 'Consolas, "Cascadia Mono", monospace';

/** Defaults, then the vault's values. */
export function effectiveTerminalSettings(settings?: Pick<VaultSettings, 'terminal'>): TerminalSettings {
  return { ...DEFAULT_TERMINAL_SETTINGS, ...settings?.terminal };
}
/** '"<name>", Consolas, "Cascadia Mono", monospace' for a non-blank trimmed name, else FALLBACK_FONTS. */
export function xtermFontFamily(fontFamily: string): string {
  const name = fontFamily.trim();
  return name ? `"${name}", ${FALLBACK_FONTS}` : FALLBACK_FONTS;
}
