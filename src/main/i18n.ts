import { createInstance } from 'i18next';

import mainDe from '../shared/locales/de-DE/main.json';
import mainEn from '../shared/locales/en-US/main.json';
import type { Locale } from '../shared/locale';

// Own instance: main never touches the default i18next singleton (renderer shares the process in tests).
const instance = createInstance();
void instance.init({
  resources: { 'de-DE': { main: mainDe }, 'en-US': { main: mainEn } },
  lng: 'de-DE',
  fallbackLng: 'de-DE',
  ns: ['main'],
  defaultNS: 'main',
  initAsync: false,
  load: 'currentOnly',
  // Fingerprints contain `/` and `+`; escaping would corrupt what the user compares.
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** Follows setMainLocale; keys without prefix, e.g. mainT('dialogs.closeApp.title'). */
export const mainT = instance.getFixedT(null, 'main');
export const mainTFor = (locale: Locale) => instance.getFixedT(locale, 'main');
export function setMainLocale(locale: Locale): void { void instance.changeLanguage(locale); }
