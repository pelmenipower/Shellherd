import { useEffect, useId, useState } from 'react';
import type { UpdateStatus } from '../../../shared/ipc';
import { errorText } from '../error-text';
import { useT } from '../i18n';

/** Update check on or off. Works without a vault: the stored setting is read and saved in the main process. */
export function UpdateSetting() {
  const { t } = useT();
  const id = useId();
  const [state, setState] = useState<UpdateStatus | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void window.desktopApi.updateStatus().then(value => { if (current) setState(value); }).catch(() => {});
    return () => { current = false; };
  }, []);
  if (!state) return null;
  const change = (enabled: boolean): void => {
    void window.desktopApi.updateSetEnabled(enabled).then(value => { setFailure(null); setState(value); }).catch(error => setFailure(errorText(error)));
  };
  return (
    <>
      <label className="settings-check">
        <input type="checkbox" checked={state.enabled} aria-describedby={`${id}-hint`}
          onChange={event => change(event.target.checked)} />
        {t('app:update.setting.label')}</label>
      <p className="settings-hint" id={`${id}-hint`}>{t('app:update.setting.hint')}</p>
      {failure && <p className="field-error" role="alert">{failure}</p>}
    </>
  );
}
