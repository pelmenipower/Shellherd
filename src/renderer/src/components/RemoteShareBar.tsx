import type { RemoteLabSession } from '../../../shared/remote-lab';
import { useState } from 'react';
import { formatDateTime } from '../../../shared/format';
import { useT } from '../i18n';

/** Always-visible notice while this device's screen is being shared; stylesheet comes with the remote-lab dialogs. */
export function RemoteShareBar({ session, onStop }: { session: RemoteLabSession; onStop: () => void }) {
  const { t } = useT();
  // Freeze the fallback while connecting so the shown time does not follow every render.
  const [fallback] = useState(() => Date.now());
  const time = formatDateTime(session.startedAt ?? fallback, 'time');
  return (
    <div className="remote-share-bar" role="status" aria-live="polite">
      <span className="remote-share-bar-text">{t('remoteLab:bar.viewing', { name: session.peer.name, time })}</span>
      <button type="button" className="secondary-button" onClick={onStop}>{t('remoteLab:bar.stop')}</button>
    </div>
  );
}
