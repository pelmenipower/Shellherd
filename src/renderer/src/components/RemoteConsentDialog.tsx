import { useEffect, useId, useRef, useState } from 'react';
import { formatDateTime } from '../../../shared/format';
import type { RemoteLabSession } from '../../../shared/remote-lab';
import { REMOTE_LAB_LIMITS } from '../../../shared/remote-lab';
import { normalizeVerification } from '../../../shared/remote-signal';
import { groupFingerprint, secondsLeft } from '../remote-lab';
import type { RemoteSessionController } from '../remote-peer';
import { useNativeSurfaceBlock } from '../native-surface';
import { useT } from '../i18n';
import '../remote-lab.css';

function grouped(fingerprint: string): string {
  try { return groupFingerprint(fingerprint); } catch { return fingerprint; }
}

export function RemoteConsentDialog({ controller, session }: { controller: RemoteSessionController; session: RemoteLabSession }) {
  const { t } = useT(); const id = useId();
  const dialog = useRef<HTMLDialogElement>(null); const decline = useRef<HTMLButtonElement>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [typed, setTyped] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useNativeSurfaceBlock(true);
  useEffect(() => {
    // Re-arm for every session: the lock and the focus on "decline" restart with a new request.
    setUnlocked(false); setNow(Date.now());
    if (!dialog.current?.open) dialog.current?.showModal();
    decline.current?.focus();
    const unlock = setTimeout(() => setUnlocked(true), REMOTE_LAB_LIMITS.acceptDelayMs);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearTimeout(unlock); clearInterval(tick); };
  }, [session.id]);
  // A failed attempt (the host counts them) empties the field.
  useEffect(() => { setTyped(''); }, [session.attemptsLeft]);
  const declineRequest = (): void => { void controller.act({ kind: 'decline', sessionId: session.id }); };
  const verified = session.peer.known?.verified === true;
  const verification = verified ? null : normalizeVerification(typed);
  const canAccept = unlocked && !session.armed && session.state === 'consent' && (verified || verification !== null);
  const accept = (): void => {
    // Only arms the capture; the host shows the native dialog after a short delay (V8).
    void controller.share(session.id, verification).then(() => { if (controller.view.error === 'mismatch') setTyped(''); });
  };
  return <dialog ref={dialog} className="confirm-dialog remote-consent-dialog" data-instant="" aria-labelledby={`${id}-title`}
    aria-describedby={`${id}-body`} onCancel={event => { event.preventDefault(); declineRequest(); }}>
    <h2 id={`${id}-title`}>{t('remoteLab:consent.title')}</h2>
    <p id={`${id}-body`}>{t('remoteLab:consent.body', { name: session.peer.name })}</p>
    {verified ? <>
      <h3 className="remote-lab-caption">{t('remoteLab:consent.fingerprint')}</h3>
      <code className="remote-lab-fingerprint">{grouped(session.peer.id)}</code>
      <p className="remote-lab-caption">{t('remoteLab:verify.verified', { date: formatDateTime(session.peer.known?.verifiedAt ?? session.peer.known?.firstSeen ?? 0, 'short') })}</p>
    </> : <>
      <label htmlFor={`${id}-verify`}>{t('remoteLab:verify.label')}</label>
      <input id={`${id}-verify`} className="remote-lab-verify" maxLength={23} autoComplete="off" spellCheck={false} inputMode="text"
        value={typed} disabled={session.state !== 'consent'} onChange={event => setTyped(event.target.value)} />
      <p className="remote-lab-caption">{t('remoteLab:verify.hint')}</p>
    </>}
    {session.peer.changed && <p className="remote-lab-warning">{t('remoteLab:verify.changed', { name: session.peer.name })}</p>}
    <p className="remote-lab-caption">{t('remoteLab:consent.nativeHint')}</p>
    <p className="remote-lab-caption" role="timer">{t('remoteLab:consent.expires', { seconds: secondsLeft(session.expiresAt, now) })}</p>
    {session.armed && <p className="remote-lab-caption" role="status">{t('remoteLab:consent.armedHint')}</p>}
    {window.desktopApi.capabilities.platform === 'win32' && <p className="remote-lab-caption">{t('remoteLab:consent.windowsHint')}</p>}
    {window.desktopApi.capabilities.platform === 'linux' && <p className="remote-lab-warning">{t('remoteLab:consent.linuxHint')}</p>}
    <div className="remote-consent-actions">
      <button ref={decline} type="button" className="secondary-button" onClick={declineRequest}>{t('remoteLab:consent.decline')}</button>
      <button type="button" className="primary-button" disabled={!canAccept} onClick={accept}>{t('remoteLab:consent.accept')}</button>
    </div>
  </dialog>;
}
