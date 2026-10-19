import { useEffect, useId, useRef } from 'react';
import './editor-ui.css';
import { BusyButton } from './BusyButton';
import { useNativeSurfaceBlock } from '../native-surface';
import { useT } from '../i18n';

interface ConfirmDialogProps {
  title: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  alternateLabel?: string;
  onAlternate?: () => void;
  description: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** Skip the open animation (for confirmations a key can trigger). */
  instant?: boolean;
}

export function ConfirmDialog({ title, description, busy, onCancel, onConfirm, confirmLabel,
  cancelLabel, destructive = true, alternateLabel, onAlternate, instant }: ConfirmDialogProps) {
  const { t } = useT();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useNativeSurfaceBlock(true);

  useEffect(() => {
    dialogRef.current?.showModal();
    cancelRef.current?.focus();
  }, []);

  return (
    <dialog ref={dialogRef} className="confirm-dialog compact-confirm" data-instant={instant ? '' : undefined} aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`} onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}>
      <h2 id={`${id}-title`}>{title}</h2>
      <p id={`${id}-description`}>{description}</p>
      <div className="form-actions">
        <button ref={cancelRef} className="secondary-button" type="button" disabled={busy} onClick={onCancel}>{cancelLabel ?? t('common:actions.cancel')}</button>
        <BusyButton className={destructive ? 'danger-button' : 'primary-button'} type="button" busy={busy} idleLabel={confirmLabel ?? t('app:dialogs.confirmDefault')} onClick={onConfirm} />
        {alternateLabel && onAlternate && <button className="primary-button" type="button" disabled={busy} onClick={onAlternate}>{alternateLabel}</button>}
      </div>
    </dialog>
  );
}
