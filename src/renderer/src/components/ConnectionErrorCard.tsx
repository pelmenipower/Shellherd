import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { CodedError } from '../../../shared/errors';
import { useT } from '../i18n';
import { actionLabel, connectionError } from '../connection-error-text';
import type { ConnectionAction, ConnectionErrorCode } from '../../../shared/connection-errors';
import { LOCAL_CONTAINER_HOST } from '../../../shared/containers';
import { canEditConnections, requestEdit } from '../edit-request';
import { notify } from '../notice-store';
import { focusIfAllowed } from '../focus-guard';
import './connection-ui.css';

export interface ConnectionErrorCardProps {
  /** For requestEdit; LOCAL_CONTAINER_HOST hides "Verbindung bearbeiten". */
  connectionId: string;
  code: ConnectionErrorCode;
  name: string; address: string; remote: boolean;
  /** Translated here; `error.detail` is the raw text under "Details" and the clipboard payload of 'copy'. */
  error?: CodedError;
  /** Primary button takes focus. */
  active: boolean;
  onRetry: () => void;
}

/** Replaces the connecting card on failure: cause, next step, actions, raw text under "Details". */
export function ConnectionErrorCard({ connectionId, code, address, remote, error, active, onRetry }: ConnectionErrorCardProps) {
  const { t } = useT();
  const detail = error?.detail;
  const [open, setOpen] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const text = connectionError(code, { address, error, remote });
  const available = (action: ConnectionAction): boolean =>
    action === 'edit' ? canEditConnections() && connectionId !== LOCAL_CONTAINER_HOST
      : action === 'copy' ? Boolean(detail) : true;
  const actions = [text.primary, text.secondary].filter((action): action is ConnectionAction => action !== undefined && available(action));
  useEffect(() => { if (active) focusIfAllowed(root.current, primary.current); }, [active]);
  const run = (action: ConnectionAction): void => {
    if (action === 'retry') onRetry();
    else if (action === 'edit') requestEdit(connectionId);
    else if (detail) {
      window.desktopApi.writeClipboardText(detail).then(() => { notify.ok(t('terminal:connectionCard.copied')); })
        .catch(() => { notify.error(t('terminal:connectionCard.notCopied'), { body: t('terminal:connectionCard.clipboardUnavailable') }); });
    }
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' || event.key === 'Enter') event.stopPropagation();
  };
  return (
    <div ref={root} className="connect-overlay" onKeyDown={onKeyDown}>
      <div className="connect-error" role="alert">
        <div className="connect-error-head">
          <span className="connect-error-dot" aria-hidden="true" />
          <strong className="connect-error-title">{text.title}</strong>
        </div>
        <p>{text.body}</p>
        {text.next && <p className="connect-error-next">{text.next}</p>}
        <div className="connect-actions">
          {actions.map((action, index) => (
            <button key={action} ref={index === 0 ? primary : undefined} type="button"
              className={index === 0 ? 'primary-button' : 'secondary-button'} onClick={() => run(action)}>{actionLabel(action)}</button>
          ))}
          {detail && <button type="button" className="connect-details-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
            {/* One label in both states keeps the width; aria-expanded and the chevron carry the state. */}
            {t('terminal:connectionCard.details')} <svg className={`chevron${open ? ' is-up' : ''}`} viewBox="0 0 24 24" aria-hidden="true"><path d="m5 9 7 7 7-7" /></svg>
          </button>}
        </div>
        {detail && open && <pre className="connect-details">{detail}</pre>}
      </div>
    </div>
  );
}
