import { useEffect, useState } from 'react';
import { THEME_SETTINGS } from '../../../shared/theme';
import type { ThemeSetting as Setting } from '../../../shared/theme';
import { errorText } from '../error-text';
import { useT } from '../i18n';

/** Full literals, so unused keys can be found by search. */
const THEME_LABELS = { system: 'app:theme.system', dark: 'app:theme.dark', light: 'app:theme.light' } as const;

/** Colour scheme: dark, light or like Windows. Main window only; main applies it to every window. */
export function ThemeSetting() {
  const { t } = useT();
  const [setting, setSetting] = useState<Setting | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void window.desktopApi.getTheme().then(value => { if (current) setSetting(value); }).catch(() => {});
    return () => { current = false; };
  }, []);
  if (!setting) return null;
  const change = (value: Setting): void => {
    void window.desktopApi.setTheme(value).then(saved => { setFailure(null); setSetting(saved); }).catch(error => setFailure(errorText(error)));
  };
  return (
    <label className="file-type-setting language-setting">
      <span>{t('app:theme.label')}</span>
      <select aria-label={t('app:theme.aria')} value={setting} onChange={event => change(event.target.value as Setting)}>
        {THEME_SETTINGS.map(value => <option key={value} value={value}>{t(THEME_LABELS[value])}</option>)}
      </select>
      {failure && <small className="field-error" role="alert">{failure}</small>}
    </label>
  );
}
