import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KnownHostView } from '../../../shared/known-hosts';
import { formatNumber } from '../../../shared/format';
import { errorText } from '../error-text';
import { useNativeSurfaceBlock } from '../native-surface';
import { useT } from '../i18n';
import { knownHostName, matchesKnownHost, originLabel, sortKnownHosts } from '../known-hosts-view';
import '../settings-ui.css';

export interface KnownHostsDialogProps { busy: boolean; onClose: () => void }

/** Confirmed, imported and revoked server keys: search, remove, import a known_hosts file. */
export function KnownHostsDialog({ busy, onClose }: KnownHostsDialogProps) {
  const { t } = useT();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLButtonElement>(null);
  const [hosts, setHosts] = useState<KnownHostView[] | null>(null);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean; conflicts?: string } | null>(null);
  useNativeSurfaceBlock(true);
  useEffect(() => {
    dialogRef.current?.showModal();
    searchRef.current?.focus();
    void window.desktopApi.knownHostsList().then(setHosts, error => {
      setHosts([]);
      setMessage({ text: errorText(error, t('app:hostKeys.loadFailed')), error: true });
    });
  }, []);
  const sorted = useMemo(() => sortKnownHosts(hosts ?? []), [hosts]);
  const shown = useMemo(() => sorted.filter(view => matchesKnownHost(view, query)), [sorted, query]);
  const locked = busy || pending;

  async function importFile(): Promise<void> {
    setPending(true);
    setMessage(null);
    try {
      const reply = await window.desktopApi.knownHostsImport();
      if (reply.canceled) return;
      const { added, known, revoked, skipped, conflicts } = reply.result;
      setHosts(reply.hosts);
      setMessage({
        text: t('app:hostKeys.importDone', { added: formatNumber(added), known: formatNumber(known), revoked: formatNumber(revoked), skipped: formatNumber(skipped) }),
        error: false,
        conflicts: conflicts.length ? t('app:hostKeys.conflicts', { hosts: conflicts.join(', ') }) : undefined,
      });
    } catch (error) {
      setMessage({ text: errorText(error, t('app:hostKeys.importFailed')), error: true });
    } finally {
      setPending(false);
      // The button is disabled while pending, so focus only after the re-render; a null ref means the dialog closed meanwhile.
      requestAnimationFrame(() => importRef.current?.focus());
    }
  }

  async function remove(view: KnownHostView): Promise<void> {
    setPending(true);
    setMessage(null);
    try {
      setHosts(await window.desktopApi.knownHostsRemove(view.id));
    } catch (error) {
      setMessage({ text: errorText(error, t('app:hostKeys.removeFailed')), error: true });
    } finally {
      setPending(false);
      searchRef.current?.focus();
    }
  }

  return (
    <dialog ref={dialogRef} className="confirm-dialog known-hosts-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-intro`}
      onCancel={event => { event.preventDefault(); if (!locked) onClose(); }}>
      <h2 id={`${id}-title`}>{t('app:hostKeys.title')}</h2>
      <p className="settings-hint" id={`${id}-intro`}>{t('app:hostKeys.intro')}</p>
      <div className="known-hosts-tools">
        <input ref={searchRef} type="text" spellCheck={false} maxLength={256} value={query}
          aria-label={t('app:hostKeys.search')} placeholder={t('app:hostKeys.searchPlaceholder')}
          onChange={event => setQuery(event.target.value)} />
        <button ref={importRef} type="button" className="secondary-button" disabled={locked} onClick={() => void importFile()}>{t('app:hostKeys.import')}</button>
      </div>
      {message && <div className={message.error ? 'field-error known-hosts-message' : 'settings-hint known-hosts-message'} role={message.error ? 'alert' : 'status'}>
        <p>{message.text}</p>
        {message.conflicts && <p>{message.conflicts}</p>}
      </div>}
      {hosts && (shown.length > 0
        ? <ul className="known-hosts-list">
          {shown.map(view => <li key={view.id}>
            <div>
              <strong>{knownHostName(view)}</strong>
              <small>{view.type ? `${view.type} · ${originLabel(view.origin)}` : originLabel(view.origin)}</small>
            </div>
            <code>{view.fingerprint}</code>
            <button type="button" className="danger-button" disabled={locked}
              aria-label={t('app:hostKeys.removeLabel', { host: knownHostName(view) })} onClick={() => void remove(view)}>{t('app:hostKeys.remove')}</button>
          </li>)}
        </ul>
        : <p className="settings-hint">{hosts.length ? t('app:hostKeys.noMatch') : t('app:hostKeys.empty')}</p>)}
      <div className="form-actions">
        <span className="settings-hint">{t('app:hostKeys.shown', { shown: formatNumber(shown.length), total: formatNumber(hosts?.length ?? 0) })}</span>
        <button type="button" className="primary-button" disabled={locked} onClick={onClose}>{t('common:actions.close')}</button>
      </div>
    </dialog>
  );
}
