import { describe, expect, it } from 'vitest';
import { isLocale, resolveLocale, systemLocale } from './locale';

describe('systemLocale', () => {
  it.each([
    [['de-AT', 'en'], 'de-DE'],
    [['en'], 'en-US'],
    [['fr-FR'], 'en-US'],
    [['fr-FR', 'de-DE'], 'de-DE'],
    [[], 'en-US'],
  ])('%j -> %s', (preferred, expected) => {
    expect(systemLocale(preferred)).toBe(expected);
  });
});

describe('resolveLocale', () => {
  it('keeps a fixed setting regardless of the system language', () => {
    expect(resolveLocale('de-DE', ['en-US'])).toBe('de-DE');
  });
  it('follows the system language for "system"', () => {
    expect(resolveLocale('system', ['en-GB'])).toBe('en-US');
  });
});

describe('isLocale', () => {
  it('accepts only exact supported locales', () => {
    expect(isLocale('de')).toBe(false);
    expect(isLocale('de-DE')).toBe(true);
    expect(isLocale(undefined)).toBe(false);
  });
});
