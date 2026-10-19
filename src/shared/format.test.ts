import { afterEach, describe, expect, it } from 'vitest';
import { compareText, foldCase, formatDateTime, formatLocale, formatNumber, setFormatLocale } from './format';

const DATE = new Date(2026, 9, 19, 14, 5, 9);

afterEach(() => setFormatLocale('de-DE'));

describe('format', () => {
  it('defaults to de-DE', () => {
    expect(formatLocale()).toBe('de-DE');
  });

  it('formats de-DE dates', () => {
    expect(formatDateTime(DATE, 'short')).toBe('19.10.26, 14:05');
    expect(formatDateTime(DATE, 'long')).toBe('19. Oktober 2026');
    expect(formatDateTime(DATE, 'time')).toBe('14:05:09');
  });

  it('formats en-US dates (U+202F tolerant)', () => {
    setFormatLocale('en-US');
    expect(formatLocale()).toBe('en-US');
    expect(formatDateTime(DATE, 'short')).toMatch(/^10\/19\/26, 2:05\sPM$/u);
    expect(formatDateTime(DATE, 'long')).toBe('October 19, 2026');
    expect(formatDateTime(DATE, 'time')).toMatch(/^2:05:09\sPM$/u);
  });

  it('accepts numbers and strings, invalid input gives empty text', () => {
    expect(formatDateTime(DATE.getTime(), 'long')).toBe('19. Oktober 2026');
    expect(formatDateTime(DATE.toISOString(), 'long')).toMatch(/Oktober 2026$/u);
    expect(formatDateTime('nope', 'short')).toBe('');
    expect(formatDateTime(new Date(NaN), 'time')).toBe('');
  });

  it('formats numbers per locale and options', () => {
    expect(formatNumber(1234.5)).toBe('1.234,5');
    expect(formatNumber(0.5, { style: 'percent' })).toMatch(/^50\s?%$/u);
    setFormatLocale('en-US');
    expect(formatNumber(1234.5)).toBe('1,234.5');
  });

  it('compares numerically and case-insensitively', () => {
    expect(compareText('pod2', 'pod10')).toBeLessThan(0);
    expect(compareText('Alpha', 'alpha')).toBe(0);
    expect(compareText('b', 'a')).toBeGreaterThan(0);
  });

  it('folds case per locale', () => {
    expect(foldCase('ÄBC')).toBe('äbc');
    expect(foldCase('I')).toBe('i');
  });
});
