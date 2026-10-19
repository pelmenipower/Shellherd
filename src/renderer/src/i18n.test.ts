import { afterEach, describe, expect, it } from 'vitest';
import { formatLocale } from '../../shared/format';
import { currentLocale, i18n, t } from './i18n';

afterEach(async () => {
  await i18n.changeLanguage('de-DE');
});

describe('renderer i18n', () => {
  it('starts on de-DE', () => {
    expect(currentLocale()).toBe('de-DE');
    expect(t('common:actions.cancel')).toBe('Abbrechen');
  });

  it('switches to en-US and syncs the format locale', async () => {
    await i18n.changeLanguage('en-US');
    expect(currentLocale()).toBe('en-US');
    expect(formatLocale()).toBe('en-US');
    expect(t('common:actions.cancel')).toBe('Cancel');
  });

  it('falls back to de-DE for a key missing in en-US', async () => {
    // Throwaway namespace so the real catalogs stay untouched.
    i18n.addResource('de-DE', 'probe', 'onlyDe', 'nur deutsch');
    await i18n.changeLanguage('en-US');
    expect((t as (key: string) => string)('probe:onlyDe')).toBe('nur deutsch');
    i18n.removeResourceBundle('de-DE', 'probe');
  });

  it('pluralises common:count.tabs in both languages', async () => {
    expect(t('common:count.tabs', { count: 1 })).toBe('1 Tab');
    expect(t('common:count.tabs', { count: 2 })).toBe('2 Tabs');
    await i18n.changeLanguage('en-US');
    expect(t('common:count.tabs', { count: 1 })).toBe('1 tab');
    expect(t('common:count.tabs', { count: 2 })).toBe('2 tabs');
  });
});
