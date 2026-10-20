export const SUPPORTED_LOCALES = ['de-DE', 'en-US'] as const;
export type Locale = typeof SUPPORTED_LOCALES[number];
export type LanguageSetting = 'system' | Locale;
export const LANGUAGE_SETTINGS = ['system', 'de-DE', 'en-US'] as const;
export interface LanguageState { setting: LanguageSetting; effective: Locale; system: Locale }
/** Endonyms; never translated. */
export const LOCALE_NAMES: Record<Locale, string> = { 'de-DE': 'Deutsch', 'en-US': 'English' };
export const LOCALE_ARG = '--shellherd-locale=';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** First entry whose base language is supported wins (`de-*` → de-DE, `en-*` → en-US); none → en-US. */
export function systemLocale(preferred: readonly string[]): Locale {
  for (const entry of preferred) {
    const base = entry.split(/[-_]/)[0]?.toLowerCase();
    if (base === 'de') return 'de-DE';
    if (base === 'en') return 'en-US';
  }
  return 'en-US';
}

export function resolveLocale(setting: LanguageSetting, preferred: readonly string[]): Locale {
  return setting === 'system' ? systemLocale(preferred) : setting;
}
