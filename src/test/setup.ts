import { createInstance } from 'i18next';
import { NAMESPACES, resources } from '../shared/locales';

// Wave 1.0 stand-in: own instance on de-DE, no renderer code yet (replaced by the renderer i18n in 1.1).
await createInstance().init({
  resources,
  lng: 'de-DE',
  fallbackLng: 'de-DE',
  defaultNS: 'common',
  ns: NAMESPACES,
  initAsync: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});
