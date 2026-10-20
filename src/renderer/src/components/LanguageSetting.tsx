import { useEffect, useState } from 'react';
import { LANGUAGE_SETTINGS, LOCALE_NAMES } from '../../../shared/locale';
import type { LanguageSetting as Setting, LanguageState } from '../../../shared/locale';
import { errorText } from '../error-text';
import { useT } from '../i18n';

/** UI language: follow the system or pick one. Main window only; the choice reaches every window. */
export function LanguageSetting() {
  const { t } = useT();
  const [state, setState] = useState<LanguageState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void window.desktopApi.getLanguage().then(value => { if (current) setState(value); }).catch(() => {});
    const unsubscribe = window.desktopApi.onLocaleChanged(value => { if (current) setState(value); });
    return () => { current = false; unsubscribe(); };
  }, []);
  if (!state) return null;
  const change = (setting: Setting): void => {
    void window.desktopApi.setLanguage(setting).then(value => { setFailure(null); setState(value); }).catch(error => setFailure(errorText(error)));
  };
  return (
    <label className="file-type-setting language-setting">
      <span>{t('app:language.label')}</span>
      <select aria-label={t('app:language.aria')} value={state.setting} onChange={event => change(event.target.value as Setting)}>
        {LANGUAGE_SETTINGS.map(setting => <option key={setting} value={setting}>
          {setting === 'system' ? t('app:language.system', { language: LOCALE_NAMES[state.system] }) : LOCALE_NAMES[setting]}
        </option>)}
      </select>
      {failure && <small className="field-error" role="alert">{failure}</small>}
    </label>
  );
}
