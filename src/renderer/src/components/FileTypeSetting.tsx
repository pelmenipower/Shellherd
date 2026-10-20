import { useEffect, useState } from 'react';
import { useT } from '../i18n';

/** Lets Explorer open `.term` vault files with Shellherd (per user, no administrator rights). */
export function FileTypeSetting() {
  const { t } = useT();
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { void window.desktopApi.fileTypeStatus().then(setRegistered).catch(() => setRegistered(false)); }, []);
  const change = (register: boolean): void => {
    setPending(true); setMessage(null);
    void (register ? window.desktopApi.fileTypeRegister() : window.desktopApi.fileTypeUnregister())
      .then(() => { setRegistered(register); setMessage(register ? t('app:fileType.registeredMessage') : t('app:fileType.removedMessage')); })
      .catch(() => setMessage(t('app:fileType.failed')))
      .finally(() => setPending(false));
  };
  if (registered === null) return null;
  return (
    <div className="file-type-setting">
      <span>{registered ? t('app:fileType.registered') : t('app:fileType.unregistered')}</span>
      <button type="button" className="secondary-button" disabled={pending} onClick={() => change(!registered)}>
        {registered ? t('app:fileType.remove') : t('app:fileType.register')}</button>
      {message && <small role="status">{message}</small>}
    </div>
  );
}
