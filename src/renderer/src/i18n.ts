import i18next from 'i18next';
import { initReactI18next, useTranslation, Trans } from 'react-i18next';
import { NAMESPACES, resources } from '../../shared/locales';
import { isLocale, type Locale } from '../../shared/locale';
import type { FormatterModule } from 'i18next';
import { formatNumber, setFormatLocale } from '../../shared/format';

// Counts and limits follow the language; ports, exit codes and IDs stay raw.
const COUNT_KEYS = new Set(['count', 'done', 'opened', 'total', 'shown', 'selected', 'max']);
// i18next replaces interpolation.format with its formatter module, so the hook is a formatter module.
const countFormatter: FormatterModule = { type: 'formatter', init: () => {}, add: () => {}, addCached: () => {},
  format: (value, _format, _lng, options) =>
    typeof value === 'number' && COUNT_KEYS.has(String(options?.interpolationkey)) ? formatNumber(value) : value };

function initialLocale(): Locale {
  const value = typeof window === 'undefined' ? undefined : window.desktopApi?.initialLocale;
  return isLocale(value) ? value : 'de-DE';
}
function applyLocale(locale: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  setFormatLocale(locale);
}
void i18next.use(initReactI18next).use(countFormatter).init({ resources, lng: initialLocale(), fallbackLng: 'de-DE', load: 'currentOnly',
  defaultNS: 'common', ns: NAMESPACES, initAsync: false, interpolation: { escapeValue: false, alwaysFormat: true }, returnNull: false,
  react: { useSuspense: false } });
applyLocale(currentLocale());
i18next.on('languageChanged', language => applyLocale(isLocale(language) ? language : 'de-DE'));

export const i18n = i18next;
/** For logic modules; call inside functions, never at module level. */
export const t = i18next.t;
export function currentLocale(): Locale { return isLocale(i18next.language) ? i18next.language : 'de-DE'; }
/** The only hook components use; allows every `ns:key`. */
export function useT() { return useTranslation(NAMESPACES); }
export { Trans };
