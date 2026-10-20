import { afterEach, describe, expect, it } from 'vitest';

import { mainT, mainTFor, setMainLocale } from './i18n';

describe('main i18n', () => {
  afterEach(() => setMainLocale('de-DE'));

  it('mainT follows setMainLocale', () => {
    expect(mainT('window.secondary')).toBe('Shellherd – Sitzungen');
    setMainLocale('en-US');
    expect(mainT('window.secondary')).toBe('Shellherd – Sessions');
    setMainLocale('de-DE');
    expect(mainT('dialogs.closeApp.title')).toBe('Shellherd schließen');
  });

  it('mainTFor is bound to its locale', () => {
    expect(mainTFor('en-US')('dialogs.cancel')).toBe('Cancel');
    expect(mainTFor('de-DE')('dialogs.cancel')).toBe('Abbrechen');
  });

  it('does not escape interpolations (fingerprint stays unchanged)', () => {
    const fingerprint = 'a/b+c=';
    expect(mainT('dialogs.hostKey.detail', { fingerprint })).toContain(fingerprint);
    expect(mainT('dialogs.hostKey.message', { host: 'h', port: 22 })).toBe('Server-Schlüssel für h:22 prüfen');
  });
});
