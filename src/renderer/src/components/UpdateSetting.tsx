import { useEffect, useId, useState } from 'react';
import { errorText } from '../error-text';
import { useT } from '../i18n';
import { updateStore, useUpdateStatus } from '../update-store';

/** Update check on or off. Works without a vault: the stored setting is read and saved in the main process. */
export function UpdateSetting() {
  const { t } = useT();
  const id = useId();
  const state = useUpdateStatus();
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    void window.desktopApi.updateStatus().then(value => updateStore.set(value)).catch(() => {});
  }, []);
  if (!state) return null;
  // The store is shared with the badge, so turning the check off hides it at once.
  const change = (enabled: boolean): void => {
    void window.desktopApi.updateSetEnabled(enabled).then(value => { setFailure(null); updateStore.set(value); }).catch(error => setFailure(errorText(error)));
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
