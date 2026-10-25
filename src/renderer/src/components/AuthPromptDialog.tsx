import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import '../auth-prompt.css';
import type { AuthPromptRequest } from '../../../shared/ssh';
import { useNativeSurfaceBlock } from '../native-surface';
import { useT } from '../i18n';

/** Copy of a list with one entry replaced; the list may be shorter (revealed starts empty). */
function withAt<T>(list: T[], index: number, value: T): T[] {
  const next = [...list];
  next[index] = value;
  return next;
}

/** Keyboard-interactive questions of the server. One at a time; never opens while the vault is locked. */
export function AuthPromptDialog({ locked }: { locked: boolean }) {
  const { t } = useT();
  const id = useId();
  const [request, setRequest] = useState<AuthPromptRequest | null>(null);
  const [values, setValues] = useState<string[]>([]);
  const [revealed, setRevealed] = useState<boolean[]>([]);
  // Event handlers read the latest state through refs.
  const current = useRef<AuthPromptRequest | null>(null);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstField = useRef<HTMLInputElement>(null);
  useNativeSurfaceBlock(request !== null);

  function answer(promptId: string, answers: string[] | null): void {
    void window.desktopApi.answerAuthPrompt({ promptId, answers }).catch(() => undefined);
  }

  function close(): void {
    current.current = null;
    setRequest(null); setValues([]); setRevealed([]);
  }

  function cancel(): void {
    const open = current.current;
    if (!open) return;
    answer(open.promptId, null);
    close();
  }

  useEffect(() => {
    const offPrompt = window.desktopApi.onAuthPrompt(next => {
      // A second question while one is open is refused; the server gets a cancel, never a stale answer.
      if (lockedRef.current || current.current) { answer(next.promptId, null); return; }
      current.current = next;
      setRequest(next);
      setValues(next.fields.map(() => ''));
    });
    const offClosed = window.desktopApi.onAuthPromptClosed(({ promptId }) => {
      if (current.current?.promptId === promptId) close();
    });
    const offLocked = window.desktopApi.onVaultLocked(() => cancel());
    return () => { offPrompt(); offClosed(); offLocked(); };
  }, []);

  // Locking while a question is open ends it, even if vault:locked has not arrived yet.
  useEffect(() => { if (locked) cancel(); }, [locked]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!request || !dialog) return;
    if (!dialog.open) dialog.showModal();
    firstField.current?.focus();
  }, [request]);

  if (!request) return null;

  function submit(event: FormEvent): void {
    event.preventDefault();
    const open = current.current;
    if (!open) return;
    answer(open.promptId, values);
    close();
  }

  return (
    <dialog ref={dialogRef} className="confirm-dialog compact-confirm auth-prompt" data-instant="" aria-label={t('app:authPrompt.ariaLabel')}
      aria-describedby={`${id}-host`} onCancel={event => { event.preventDefault(); cancel(); }}>
      <h2 className="auth-prompt-title">{t('app:authPrompt.title', { name: request.connectionName })}</h2>
      <p id={`${id}-host`} className="auth-prompt-host">{t('app:authPrompt.server', { host: request.host })}</p>
      {request.title && <p className="auth-prompt-text">{request.title}</p>}
      {request.instructions && <p className="auth-prompt-text">{request.instructions}</p>}
      <form onSubmit={submit}>
        {request.fields.map((field, index) => {
          const fieldId = `${id}-field-${index}`;
          const label = field.text.trim() === '' ? t('app:authPrompt.field', { index: index + 1 }) : field.text;
          const secret = !field.echo;
          const shown = revealed[index] === true;
          return (
            <div key={index} className="auth-prompt-field">
              <label htmlFor={fieldId}>{label}</label>
              <div className="auth-prompt-input">
                <input ref={index === 0 ? firstField : undefined} id={fieldId} type={secret && !shown ? 'password' : 'text'}
                  value={values[index] ?? ''} autoComplete="off" spellCheck={false}
                  onChange={event => setValues(list => withAt(list, index, event.target.value))} />
                {secret && <button className="secondary-button" type="button" aria-pressed={shown}
                  aria-label={t(shown ? 'connection:form.secret.hideLabel' : 'connection:form.secret.showLabel', { label })}
                  onClick={() => setRevealed(list => withAt(list, index, !shown))}>
                  {t(shown ? 'connection:form.secret.hide' : 'connection:form.secret.show')}</button>}
              </div>
            </div>
          );
        })}
        <p className="auth-prompt-hint">{t('app:authPrompt.hint')}</p>
        <div className="form-actions">
          <button className="secondary-button" type="button" onClick={cancel}>{t('common:actions.cancel')}</button>
          <button className="primary-button" type="submit">{t('app:authPrompt.submit')}</button>
        </div>
      </form>
    </dialog>
  );
}
