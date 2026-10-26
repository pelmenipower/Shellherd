import { useEffect, useId, useRef, useState } from 'react';
import { MAX_REPLICAS, type KubeActionRequest, type KubeAction, type KubeArgoState, type KubeRef } from '../../../../shared/kubernetes';
import { argoNoteFor, argoNoteText, confirmationFor } from '../../confirm-action';
import { errorText } from '../../error-text';
import { useNativeSurfaceBlock } from '../../native-surface';
import { useT } from '../../i18n';
import { BusyButton } from '../BusyButton';

export interface PendingAction {
  ref: KubeRef;
  action: KubeAction;
  /** Current replicas of the workload, for scale. */
  currentReplicas?: number;
  /** Replicas typed in the command line (`:scale 3`). */
  replicas?: number;
  /** Argo CD application of the target row, when tracked; the dialog then reads its Self-Heal state. */
  argoApp?: string;
}

interface ConfirmActionProps {
  pending: PendingAction;
  cluster: { name: string; production: boolean };
  run: (request: Omit<KubeActionRequest, 'viewId'>) => Promise<void>;
  /** get on the Argo CD application; null when unreadable. */
  readArgo: (app: string) => Promise<KubeArgoState | null>;
  onClose: () => void;
}

/** Confirmation for restart, scale and delete. Production and scale-to-zero need the name typed. */
export function ConfirmAction({ pending, cluster, run, readArgo, onClose }: ConfirmActionProps) {
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
  // The Argo line never gates the confirm button; it is read once per dialog and dropped when the dialog closes.
  const note = pending.argoApp ? argoNoteFor(pending.action, pending.ref.kind) : null;
  const [argo, setArgo] = useState<KubeArgoState | null | undefined>(undefined);
  useEffect(() => {
    if (!note || !pending.argoApp) return;
    let live = true;
    readArgo(pending.argoApp).then(state => { if (live) setArgo(state); }, () => { if (live) setArgo(null); });
    return () => { live = false; };
    // One read per dialog: it lives for exactly one pending action, and readArgo is a new closure on every render of the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const argoLine = note && pending.argoApp ? argoNoteText(note, pending.argoApp, argo) : null;

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
    <dialog ref={dialogRef} className="confirm-dialog compact-confirm kube-confirm" aria-labelledby={`${id}-title`} aria-describedby={argoLine ? `${id}-body ${id}-argo` : `${id}-body`}
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement && canConfirm) { event.preventDefault(); void confirm(); }
      }}>
      <h2 id={`${id}-title`}>{confirmation.title}</h2>
      <p id={`${id}-body`}>{confirmation.body}</p>
      {argoLine && <p id={`${id}-argo`} className={`kube-confirm-argo${argoLine.warn ? ' is-warn' : ''}`} aria-live="polite">{argoLine.text}</p>}
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
        <BusyButton className="danger-button" type="button" busy={busy} disabled={!canConfirm} idleLabel={confirmation.confirmLabel} onClick={() => void confirm()} />
      </div>
    </dialog>
  );
}
