import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TERMINAL_SETTINGS,
  FALLBACK_FONTS,
  FONT_FAMILY_MAX,
  FONT_FAMILY_PATTERN,
  TERMINAL_LIMITS,
  effectiveTerminalSettings,
  xtermFontFamily,
} from './terminal-settings';

describe('terminal settings defaults', () => {
  it('uses the values the terminal had before the settings existed', () => {
    expect(DEFAULT_TERMINAL_SETTINGS).toEqual({ fontFamily: '', fontSize: 14, scrollback: 5000, cursorStyle: 'block', cursorBlink: true });
  });

  it('keeps the limits of the settings dialog', () => {
    expect(TERMINAL_LIMITS.fontSize).toEqual([8, 32]);
    expect(TERMINAL_LIMITS.scrollback).toEqual([1_000, 50_000]);
    expect(FONT_FAMILY_MAX).toBe(64);
  });

  it('accepts letters, digits, space, dot, underscore and hyphen only', () => {
    expect(FONT_FAMILY_PATTERN.test('Fira Code')).toBe(true);
    expect(FONT_FAMILY_PATTERN.test('JetBrains_Mono-2.0')).toBe(true);
    expect(FONT_FAMILY_PATTERN.test('')).toBe(true);
    expect(FONT_FAMILY_PATTERN.test('A"B')).toBe(false);
    expect(FONT_FAMILY_PATTERN.test('A,B')).toBe(false);
  });
});

describe('effectiveTerminalSettings', () => {
  it('returns the defaults for a missing or empty vault setting', () => {
    expect(effectiveTerminalSettings(undefined)).toEqual(DEFAULT_TERMINAL_SETTINGS);
    expect(effectiveTerminalSettings({})).toEqual(DEFAULT_TERMINAL_SETTINGS);
  });

  it('lets the vault values override single fields', () => {
    expect(effectiveTerminalSettings({ terminal: { ...DEFAULT_TERMINAL_SETTINGS, fontSize: 18, cursorStyle: 'bar' } }))
      .toEqual({ ...DEFAULT_TERMINAL_SETTINGS, fontSize: 18, cursorStyle: 'bar' });
  });
});

describe('xtermFontFamily', () => {
  const fallback = 'Consolas, "Cascadia Mono", monospace';

  it('falls back for blank names', () => {
    expect(FALLBACK_FONTS).toBe(fallback);
    expect(xtermFontFamily('')).toBe(fallback);
    expect(xtermFontFamily('  ')).toBe(fallback);
  });

  it('puts the trimmed name first, quoted, before the fallbacks', () => {
    expect(xtermFontFamily(' Fira Code ')).toBe(`"Fira Code", ${fallback}`);
  });
});
