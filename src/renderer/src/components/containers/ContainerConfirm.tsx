import { useEffect, useId, useRef, useState } from 'react';
import type { ContainerConfirmation } from '../../container-confirm';
import { useNativeSurfaceBlock } from '../../native-surface';
import { useT } from '../../i18n';

interface ContainerConfirmProps {
  confirmation: ContainerConfirmation;
  /** Runs the action; the view reports a failure in its status line. */
  onConfirm: () => void;
  onClose: () => void;
}

/** Dialog for stop, restart and remove. Removing needs the name typed. */
export function ContainerConfirm({ confirmation, onConfirm, onClose }: ContainerConfirmProps) {
  const { t } = useT();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState('');
  useNativeSurfaceBlock(true);

  const canConfirm = confirmation.requireTyping === null || typed === confirmation.requireTyping;

  useEffect(() => {
    dialogRef.current?.showModal();
    (field.current ?? dialogRef.current?.querySelector<HTMLButtonElement>('.kube-confirm-cancel'))?.focus();
  }, []);

  const confirm = () => {
    if (!canConfirm) return;
    onClose();
    onConfirm();
  };

  return (
    <dialog ref={dialogRef} className="confirm-dialog compact-confirm kube-confirm" aria-labelledby={`${id}-title`} aria-describedby={`${id}-body`}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement && canConfirm) { event.preventDefault(); confirm(); }
      }}>
      <h2 id={`${id}-title`}>{confirmation.title}</h2>
      <p id={`${id}-body`}>{confirmation.body}</p>
      {confirmation.requireTyping !== null && (
        <label className="kube-field">
          <span>{t('containers:confirm.typeToConfirm', { name: confirmation.requireTyping })}</span>
          <input ref={field} type="text" autoComplete="off" spellCheck={false} value={typed} onChange={event => setTyped(event.target.value)} />
        </label>
      )}
      <div className="form-actions">
        <button className="secondary-button kube-confirm-cancel" type="button" onClick={onClose}>{t('common:actions.cancel')}</button>
        <button className="danger-button" type="button" disabled={!canConfirm} onClick={confirm}>{confirmation.confirmLabel}</button>
      </div>
    </dialog>
  );
}
