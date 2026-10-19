import { useEffect, useId, useRef } from 'react';
import './editor-ui.css';
import { useNativeSurfaceBlock } from '../native-surface';

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
}

export function ConfirmDialog({ title, description, busy, onCancel, onConfirm, confirmLabel = 'Endgültig löschen',
  cancelLabel = 'Abbrechen', destructive = true, alternateLabel, onAlternate }: ConfirmDialogProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useNativeSurfaceBlock(true);

  useEffect(() => {
    dialogRef.current?.showModal();
    cancelRef.current?.focus();
  }, []);

  return (
    <dialog ref={dialogRef} className="confirm-dialog compact-confirm" aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`} onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}>
      <h2 id={`${id}-title`}>{title}</h2>
      <p id={`${id}-description`}>{description}</p>
      <div className="form-actions">
        <button ref={cancelRef} className="secondary-button" type="button" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
        <button className={destructive ? 'danger-button' : 'primary-button'} type="button" disabled={busy} onClick={onConfirm}>
          {busy ? 'Bitte warten ...' : confirmLabel}
        </button>
        {alternateLabel && onAlternate && <button className="primary-button" type="button" disabled={busy} onClick={onAlternate}>{alternateLabel}</button>}
      </div>
    </dialog>
  );
}
