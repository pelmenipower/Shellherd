import { useEffect, useId, useRef, useState } from 'react';
import { formatDateTime } from '../../../shared/format';
import type { RemoteLabSession } from '../../../shared/remote-lab';
import { groupFingerprint, secondsLeft } from '../remote-lab';
import type { RemoteSessionController } from '../remote-peer';
import { useNativeSurfaceBlock } from '../native-surface';
import { useT } from '../i18n';
import '../remote-lab.css';

/** Accept is locked briefly after opening so a stray click or key press cannot share the screen. */
const ACCEPT_DELAY_MS = 1000;

function grouped(fingerprint: string): string {
  try { return groupFingerprint(fingerprint); } catch { return fingerprint; }
}

export function RemoteConsentDialog({ controller, session }: { controller: RemoteSessionController; session: RemoteLabSession }) {
  const { t } = useT(); const id = useId();
  const dialog = useRef<HTMLDialogElement>(null); const decline = useRef<HTMLButtonElement>(null);
  const [armed, setArmed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useNativeSurfaceBlock(true);
  useEffect(() => {
    dialog.current?.showModal(); decline.current?.focus();
    const unlock = setTimeout(() => setArmed(true), ACCEPT_DELAY_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearTimeout(unlock); clearInterval(tick); };
  }, []);
  const declineRequest = (): void => { void controller.act({ kind: 'decline', sessionId: session.id }); };
  const known = session.peer.known;
  return <dialog ref={dialog} className="confirm-dialog remote-consent-dialog" data-instant="" aria-labelledby={`${id}-title`}
    aria-describedby={`${id}-body`} onCancel={event => { event.preventDefault(); declineRequest(); }}>
    <h2 id={`${id}-title`}>{t('remoteLab:consent.title')}</h2>
    <p id={`${id}-body`}>{t('remoteLab:consent.body', { name: session.peer.name })}</p>
    <h3 className="remote-lab-caption">{t('remoteLab:consent.fingerprint')}</h3>
    <code className="remote-lab-fingerprint">{grouped(session.peer.id)}</code>
    <p className="remote-lab-caption">{known ? t('remoteLab:consent.known', { date: formatDateTime(known.firstSeen, 'short') }) : t('remoteLab:consent.unknown')}</p>
    <p className="remote-lab-caption" role="timer">{t('remoteLab:consent.expires', { seconds: secondsLeft(session.expiresAt, now) })}</p>
    {window.desktopApi.capabilities.platform === 'linux' && <p className="remote-lab-warning">{t('remoteLab:consent.linuxHint')}</p>}
    <div className="remote-consent-actions">
      <button ref={decline} type="button" className="secondary-button" onClick={declineRequest}>{t('remoteLab:consent.decline')}</button>
      <button type="button" className="primary-button" disabled={!armed} onClick={() => { void controller.share(session.id); }}>{t('remoteLab:consent.accept')}</button>
    </div>
  </dialog>;
}
