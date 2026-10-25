import { useId, useState } from 'react';
import { errorText } from '../error-text';
import { isHelloCancel, useHelloStatus } from '../hello';
import { useT } from '../i18n';

/** Vault section: unlock this vault with Windows Hello on this device. Stored outside the vault, in hello-unlock.json. */
export function HelloSetting({ filePath, busy }: { filePath: string; busy: boolean }) {
  const { t } = useT();
  const id = useId();
  const [status, refresh] = useHelloStatus(filePath);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const change = (enable: boolean): void => {
    setPending(true); setMessage(null);
    void (enable ? window.desktopApi.helloEnable() : window.desktopApi.helloDisable())
      .then(() => setMessage(enable ? t('app:hello.enabledMessage') : t('app:hello.disabledMessage')))
      .catch(cause => { if (!isHelloCancel(cause)) setMessage(errorText(cause)); })
      .finally(() => { setPending(false); refresh(); });
  };
  if (status === null) return null;
  if (!status.available && !status.enrolled) return <p className="settings-hint">{t('app:hello.unavailable')}</p>;
  return (<>
    {/* aria-disabled while the prompt is open: the checkbox keeps the focus; the controlled value ignores clicks meanwhile. */}
    <label className="settings-check">
      <input type="checkbox" checked={status.enrolled} disabled={busy} aria-disabled={pending || undefined} aria-describedby={`${id}-hint`}
        onChange={event => { if (!pending) change(event.target.checked); }} />
      {t('app:hello.setting')}</label>
    <p className="settings-hint" id={`${id}-hint`}>{t('app:hello.hint')}</p>
    {message && <p className="settings-hint" role="status">{message}</p>}
  </>);
}
