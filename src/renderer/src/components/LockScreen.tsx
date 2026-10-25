import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import '../lock-ui.css';
import mark from '../../../../resources/mark-64.png';
import { ConfirmDialog } from './ConfirmDialog';
import { errorText } from '../error-text';
import { useT } from '../i18n';
import { useNativeSurfaceBlock } from '../native-surface';
import { isHelloCancel } from '../hello';

export interface LockScreenProps {
  /** Absent in secondary windows: the title is app:lock.titlePlain. */
  vaultName?: string;
  /** Auto-lock reason in minutes; absent = manual lock or secondary window. */
  minutes?: number;
  /** Running sessions of this window; the line is hidden at 0. */
  running: number;
  /** Main window only; rejects with the unlock error, which the dialog shows under the field. */
  onUnlock?: (password: string) => Promise<void>;
  /** Main window with Windows Hello set up for this vault; rejects like onUnlock, a canceled prompt (core.helloCanceled) stays silent. */
  onHelloUnlock?: () => Promise<void>;
  /** Main window only: after a confirmation, disconnect everything and pick another vault file. */
  onSwitch?: () => void;
}

export function LockScreen({ vaultName, minutes, running, onUnlock, onHelloUnlock, onSwitch }: LockScreenProps) {
  const { t } = useT();
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const helloRef = useRef<HTMLButtonElement>(null);
  const [waiting, setWaiting] = useState(false);
  const helloOffered = onHelloUnlock !== undefined;
  // The Hello status arrives after the first paint: take the focus only while no password was typed and the user has not moved it elsewhere.
  // A button that vanishes under the focus leaves it on body; the password field takes it over, as on the open screen (K8).
  useEffect(() => {
    if (helloOffered && field.current?.value === '' && (document.activeElement === field.current || document.activeElement === document.body)) helloRef.current?.focus();
    else if (!helloOffered && document.activeElement === document.body) field.current?.focus();
  }, [helloOffered]);
  useNativeSurfaceBlock(true);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    // A modal opened later (conflict, Explorer file) would lie above in the top layer and block this one: re-raise in the same task, no frame in between.
    const observer = new MutationObserver(records => {
      if (records.some(record => record.target instanceof HTMLDialogElement && record.target !== dialog && !dialog.contains(record.target) && record.target.open)) {
        dialog.close(); dialog.showModal(); setConfirmSwitch(false);
      }
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
    return () => observer.disconnect();
  }, []);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!onUnlock || pending || waiting || password === '') return;
    setPending(true); setError(null);
    try { await onUnlock(password); }
    catch (cause) { setError(errorText(cause, t('app:errors.vaultFailed'))); }
    finally { setPending(false); setPassword(''); field.current?.focus(); }
  }

  async function unlockWithHello(): Promise<void> {
    if (!onHelloUnlock || pending || waiting) return;
    setWaiting(true); setError(null);
    try { await onHelloUnlock(); }
    catch (cause) {
      if (isHelloCancel(cause)) helloRef.current?.focus();
      else { setError(errorText(cause, t('app:errors.vaultFailed'))); field.current?.focus(); }
    }
    finally { setWaiting(false); }
  }

  const reasonId = `${id}-reason`;
  const sessionsId = `${id}-sessions`;
  const describedBy = [minutes !== undefined && reasonId, running > 0 && sessionsId].filter(Boolean).join(' ') || undefined;
  return (
    <dialog ref={ref} className="lock-screen" aria-labelledby={`${id}-title`} aria-describedby={describedBy}
      onCancel={event => event.preventDefault()}
      onClose={() => { const dialog = ref.current; if (dialog?.isConnected && !dialog.open) dialog.showModal(); }}>
      <section className="welcome-card">
        <div className="brand large-brand">
          <img className="brand-mark" src={mark} alt="" />
          <span>Shellherd</span>
        </div>
        <h1 id={`${id}-title`}>{vaultName === undefined ? t('app:lock.titlePlain') : t('app:lock.title', { name: vaultName })}</h1>
        {minutes !== undefined && <p id={reasonId} className="subtitle" role="status">{t('app:lock.autoLocked', { count: minutes })}</p>}
        {running > 0 && <p id={sessionsId} className="subtitle">{t('app:lock.sessions', { count: running })}</p>}
        {onUnlock ? (
          <form onSubmit={event => void submit(event)}>
            {onHelloUnlock && <button ref={helloRef} type="button" className="secondary-button" aria-disabled={pending || waiting || undefined}
              onClick={() => void unlockWithHello()}>{waiting ? t('app:hello.waiting') : t('app:hello.unlock')}</button>}
            <label>{t('app:open.password')}
              <input ref={field} type="password" autoComplete="current-password" autoFocus value={password} readOnly={pending || waiting}
                aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
                onChange={event => setPassword(event.target.value)} />
            </label>
            {error && <p id={`${id}-error`} className="error-message" role="alert">{error}</p>}
            <div className="form-actions">
              {onSwitch && <button className="secondary-button" type="button" disabled={pending || waiting} onClick={() => setConfirmSwitch(true)}>{t('app:lock.switch')}</button>}
              <button className="primary-button" type="submit" disabled={pending || waiting || password === ''}>{pending ? t('app:open.submitting') : t('app:lock.unlock')}</button>
            </div>
          </form>
        ) : <p className="subtitle">{t('app:lock.secondary')}</p>}
      </section>
      {confirmSwitch && <ConfirmDialog title={t('app:lock.switchTitle')} description={t('app:lock.switchDescription')} confirmLabel={t('app:lock.switchConfirm')}
        busy={false} onCancel={() => setConfirmSwitch(false)} onConfirm={() => { setConfirmSwitch(false); onSwitch?.(); }} />}
    </dialog>
  );
}
