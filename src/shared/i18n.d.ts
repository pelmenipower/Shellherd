import type { resources } from './locales';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: (typeof resources)['de-DE'];
    returnNull: false;
  }
}
