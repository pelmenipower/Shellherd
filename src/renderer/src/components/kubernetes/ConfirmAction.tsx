import { useEffect, useId, useRef, useState } from 'react';
import { MAX_REPLICAS, type KubeActionRequest, type KubeAction, type KubeRef } from '../../../../shared/kubernetes';
import { confirmationFor } from '../../confirm-action';
import { errorText } from '../../error-text';
import { useNativeSurfaceBlock } from '../../native-surface';
import { useT } from '../../i18n';

export interface PendingAction {
  ref: KubeRef;
  action: KubeAction;
  /** Current replicas of the workload, for scale. */
  currentReplicas?: number;
  /** Replicas typed in the command line (`:scale 3`). */
  replicas?: number;
}

interface ConfirmActionProps {
  pending: PendingAction;
  cluster: { name: string; production: boolean };
  run: (request: Omit<KubeActionRequest, 'viewId'>) => Promise<void>;
  onClose: () => void;
}

/** Confirmation for restart, scale and delete. Production and scale-to-zero need the name typed. */
export function ConfirmAction({ pending, cluster, run, onClose }: ConfirmActionProps) {
  const { t } = useT();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const isScale = pending.action === 'scale';
  const [replicasText, setReplicasText] = useState(String(pending.replicas ?? pending.currentReplicas ?? 1));
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useNativeSurfaceBlock(true);

  const replicas = /^\d+$/.test(replicasText) ? Number(replicasText) : NaN;
  const replicasValid = !isScale || (Number.isInteger(replicas) && replicas >= 0 && replicas <= MAX_REPLICAS);
  const confirmation = confirmationFor({
    ref: pending.ref, action: pending.action,
    ...(isScale && replicasValid ? { replicas, currentReplicas: pending.currentReplicas } : {}),
  }, cluster);
  const typingOk = confirmation.requireTyping === null || typed === confirmation.requireTyping;
  const canConfirm = replicasValid && typingOk && !busy;

  useEffect(() => {
    dialogRef.current?.showModal();
    (firstField.current ?? dialogRef.current?.querySelector<HTMLButtonElement>('.kube-confirm-cancel'))?.focus();
  }, []);

  const confirm = async () => {
    if (!canConfirm) return;
    setBusy(true);
    setError(null);
    try {
      await run({ ref: pending.ref, action: pending.action, ...(isScale ? { replicas } : {}) });
      onClose();
    } catch (caught) {
      setError(errorText(caught, t('kubeActions:confirm.failed')));
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialogRef} className="confirm-dialog compact-confirm kube-confirm" aria-labelledby={`${id}-title`} aria-describedby={`${id}-body`}
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement && canConfirm) { event.preventDefault(); void confirm(); }
      }}>
      <h2 id={`${id}-title`}>{confirmation.title}</h2>
      <p id={`${id}-body`}>{confirmation.body}</p>
      {isScale && (
        <label className="kube-field">
          <span>{t('kubeActions:confirm.replicas', { max: MAX_REPLICAS })}</span>
          <input ref={firstField} type="number" inputMode="numeric" min={0} max={MAX_REPLICAS} step={1} value={replicasText}
            aria-invalid={!replicasValid} onChange={event => setReplicasText(event.target.value)} />
        </label>
      )}
      {confirmation.requireTyping !== null && (
        <label className="kube-field">
          <span>{t('kubeActions:confirm.typeToConfirm', { name: confirmation.requireTyping })}</span>
          <input ref={firstField} type="text" autoComplete="off" spellCheck={false} value={typed} onChange={event => setTyped(event.target.value)} />
        </label>
      )}
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="secondary-button kube-confirm-cancel" type="button" disabled={busy} onClick={onClose}>{t('common:actions.cancel')}</button>
        <button className="danger-button" type="button" disabled={!canConfirm} onClick={() => void confirm()}>
          {busy ? t('common:wait') : confirmation.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
