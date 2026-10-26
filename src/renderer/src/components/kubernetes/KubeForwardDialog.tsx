import { useEffect, useId, useRef, useState } from 'react';
import type { KubeForwardStatus, KubeForwardTarget, KubeRow } from '../../../../shared/kubernetes';
import { errorText } from '../../error-text';
import { useNativeSurfaceBlock } from '../../native-surface';
import { useT } from '../../i18n';
import { forwardTargetOf, parsePort, portLabel, targetText } from '../../kube-forward';
import { BusyButton } from '../BusyButton';

interface KubeForwardDialogProps {
  row: KubeRow;
  production: boolean;
  start: (target: KubeForwardTarget, localPort: number) => Promise<KubeForwardStatus>;
  onStarted: (status: KubeForwardStatus) => void;
  onClose: () => void;
}

const OTHER = 'other';

/** Picks the pod or service port and the local port; the forward runs in main and shows up in the bar. */
export function KubeForwardDialog({ row, production, start, onStarted, onClose }: KubeForwardDialogProps) {
  const { t } = useT();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ports = row.ports ?? [];
  const isService = row.ref.kind === 'services';
  const first = ports[0] ? String(ports[0].port) : '';
  const [choice, setChoice] = useState(first || OTHER);
  const [otherText, setOtherText] = useState('');
  const [localText, setLocalText] = useState(first);
  const [localEdited, setLocalEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useNativeSurfaceBlock(true);

  const remote = choice === OTHER ? parsePort(otherText, false) : Number(choice);
  const local = parsePort(localText, true);
  const target = Number.isNaN(remote) ? null : forwardTargetOf(row, remote);
  const canStart = target !== null && !Number.isNaN(local) && !busy;

  useEffect(() => {
    dialogRef.current?.showModal();
    dialogRef.current?.querySelector<HTMLElement>('select, input')?.focus();
  }, []);

  // The local port follows the chosen remote port until the user types one.
  const follow = (text: string) => { if (!localEdited) setLocalText(text); };

  const submit = async () => {
    if (!canStart || !target) return;
    setBusy(true);
    setError(null);
    try {
      onStarted(await start(target, local));
      onClose();
    } catch (caught) {
      setError(errorText(caught));
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialogRef} className="confirm-dialog compact-confirm kube-confirm kube-forward" aria-labelledby={`${id}-title`} aria-describedby={`${id}-body`}
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement && canStart) { event.preventDefault(); void submit(); }
      }}>
      <h2 id={`${id}-title`}>{t('kubernetes:forward.title')}</h2>
      <p id={`${id}-body`}>{t(isService ? 'kubernetes:forward.service' : 'kubernetes:forward.pod', { name: row.ref.name, namespace: row.ref.namespace ?? '' })}</p>
      {ports.length > 0 && (
        <label className="kube-field">
          <span>{t(isService ? 'kubernetes:forward.servicePort' : 'kubernetes:forward.podPort')}</span>
          <select name="port" value={choice} disabled={busy}
            onChange={event => { setChoice(event.target.value); follow(event.target.value === OTHER ? otherText : event.target.value); }}>
            {ports.map(port => <option key={port.port} value={String(port.port)}>{portLabel(port)}</option>)}
            {!isService && <option value={OTHER}>{t('kubernetes:forward.otherPort')}</option>}
          </select>
        </label>
      )}
      {choice === OTHER && (
        <label className="kube-field">
          <span>{ports.length > 0 ? t('kubernetes:forward.portNumber') : t(isService ? 'kubernetes:forward.servicePort' : 'kubernetes:forward.podPort')}</span>
          <input name="remote" type="number" inputMode="numeric" min={1} max={65535} step={1} value={otherText} disabled={busy}
            aria-invalid={otherText !== '' && Number.isNaN(remote)}
            onChange={event => { setOtherText(event.target.value); follow(event.target.value); }} />
        </label>
      )}
      <label className="kube-field">
        <span>{t('kubernetes:forward.localPort')}</span>
        <input name="local" type="number" inputMode="numeric" min={0} max={65535} step={1} value={localText} disabled={busy}
          aria-invalid={Number.isNaN(local)} aria-describedby={`${id}-local`}
          onChange={event => { setLocalEdited(true); setLocalText(event.target.value); }} />
      </label>
      <p id={`${id}-local`} className="field-hint">{t('kubernetes:forward.localHint')}</p>
      {isService && <p className="field-hint">{t('kubernetes:forward.serviceHint')}</p>}
      {production && target && <p className="field-hint">{t('kubernetes:forward.production', { target: targetText(target) })}</p>}
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>{t('common:actions.cancel')}</button>
        <BusyButton className="primary-button" type="button" busy={busy} disabled={!canStart} idleLabel={t('kubernetes:forward.start')} onClick={() => void submit()} />
      </div>
    </dialog>
  );
}
