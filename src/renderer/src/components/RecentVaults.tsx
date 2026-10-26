import { useEffect, useId, useState } from 'react';
import type { ReactElement } from 'react';
import type { RecentVault } from '../../../shared/ipc';
import { formatDateTime } from '../../../shared/format';
import { errorText } from '../error-text';
import { useT } from '../i18n';

interface RecentVaultsProps {
  selectedPath: string;
  disabled: boolean;
  onSelect: (filePath: string) => void;
  /** After a successful removal, with the removed entry's path. */
  onRemoved: (filePath: string) => void;
}

/** Open screen: vault files used last. Selecting only fills the file; unlocking stays an explicit action. */
export function RecentVaults({ selectedPath, disabled, onSelect, onRemoved }: RecentVaultsProps): ReactElement | null {
  const { t } = useT();
  const id = useId();
  const [entries, setEntries] = useState<RecentVault[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    // A failed load leaves the list empty, so nothing is shown.
    void window.desktopApi.recentVaults().then(list => { if (current) setEntries(list); }).catch(() => {});
    return () => { current = false; };
  }, []);

  if (entries.length === 0) return null;

  function remove(entry: RecentVault): void {
    setFailure(null);
    void window.desktopApi.removeRecentVault(entry.id)
      .then(next => { setEntries(next); onRemoved(entry.filePath); })
      .catch(caught => setFailure(errorText(caught)));
  }

  return (
    <section className="recent-vaults" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{t('app:recent.title')}</h3>
      <ul>
        {entries.map(entry => <li key={entry.id}>
          <button type="button" className="recent-vault-open" aria-pressed={entry.filePath === selectedPath}
            disabled={disabled || entry.missing} title={entry.filePath} onClick={() => onSelect(entry.filePath)}>
            <strong>{entry.name}</strong>
            <small>{entry.missing ? t('app:recent.missing') : formatDateTime(entry.openedAt, 'short')}</small>
            <small>{entry.folder}</small>
          </button>
          <button type="button" className="icon-button" disabled={disabled}
            aria-label={t('app:recent.removeAria', { name: entry.name })} title={t('app:recent.removeAria', { name: entry.name })}
            onClick={() => remove(entry)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>
        </li>)}
      </ul>
      {failure && <p className="field-error" role="alert">{failure}</p>}
    </section>
  );
}
