import type { AutoUploadBinding } from '../../../shared/vault/types';
import type { AutoUploadState, AutoUploadStatus, SftpStatus } from '../../../shared/sftp';
import { formatDateTime } from '../../../shared/format';
import { bindingName } from '../auto-upload-form';
import { errorText } from '../error-text';
import { useT } from '../i18n';

export interface AutoUploadListProps {
  bindings: AutoUploadBinding[]; syncs: AutoUploadStatus[]; status: SftpStatus;
  /** False in secondary windows: edit, pause/resume and remove are disabled. */
  canEdit: boolean;
  onEdit: (binding: AutoUploadBinding) => void; onToggle: (binding: AutoUploadBinding) => void;
  onRemove: (binding: AutoUploadBinding) => void; onForce: (bindingId: string) => void;
}

const SYNC_STATE_KEYS = {
  syncing: 'files:sync.state.syncing', watching: 'files:sync.state.watching', error: 'files:sync.state.error',
} as const satisfies Record<AutoUploadState, string>;

export function AutoUploadList({ bindings, syncs, status, canEdit, onEdit, onToggle, onRemove, onForce }: AutoUploadListProps) {
  const { t } = useT();
  if (bindings.length === 0) return null;
  const offlineHint = canEdit ? undefined : t('files:sync.mainWindowOnly');
  return (
    <section className="transfer-queue file-sync-list" aria-label={t('files:sync.title')}>
      <header><strong>{t('files:sync.title')}</strong><span>{t('files:sync.hint')}</span></header>
      <ul>
        {bindings.map(binding => {
          const sync = syncs.find(s => s.bindingId === binding.id);
          const skipped = sync ? sync.skipped.length + sync.skippedMore : 0;
          const failed = sync?.failed.length ?? 0;
          const stateClass = !binding.enabled || status === 'closed' || status === 'error' || !sync ? 'paused' : sync.state;
          let line: string;
          if (!binding.enabled) line = t('files:sync.state.disabled');
          else if (status === 'closed' || status === 'error') line = t('files:sync.state.offline');
          else if (!sync) line = t('files:sync.state.idle');
          else if (sync.state === 'error') line = `${t(SYNC_STATE_KEYS.error)}${sync.error ? ` · ${errorText(sync.error)}` : ''}`;
          else if (sync.state === 'syncing') line = t(SYNC_STATE_KEYS.syncing, { count: sync.synced });
          else line = t(SYNC_STATE_KEYS.watching) + (sync.last ? ` · ${t('files:sync.last', { name: sync.last.name, time: formatDateTime(sync.last.at, 'time') })}` : '');
          const failedTitle = sync && failed > 0 ? [sync.error ? errorText(sync.error) : '', ...sync.failed].filter(Boolean).join('\n') : undefined;
          return <li key={binding.id} className={`transfer-job is-sync-${stateClass}`}>
            <span className="transfer-direction" aria-hidden="true">⇡</span>
            <div className="transfer-main">
              <div className="transfer-title">
                <strong>{bindingName(binding)}</strong>
                <span className="transfer-target" title={t('files:sync.target', { local: binding.localPath, remote: binding.remotePath })}>{t('files:sync.target', { local: binding.localPath, remote: binding.remotePath })}</span>
              </div>
              <small role="status">{line}
                {skipped > 0 && ` · ${t('files:sync.skipped', { count: skipped })}`}
                {failed > 0 && <span title={failedTitle}>{` · ${t('files:sync.failed', { count: failed })}`}</span>}</small>
            </div>
            {skipped > 0 && <button type="button" className="secondary-button" title={t('files:sync.forceTitle')} onClick={() => onForce(binding.id)}>{t('files:sync.force')}</button>}
            <button type="button" className="secondary-button" disabled={!canEdit} title={offlineHint} onClick={() => onEdit(binding)}>{t('files:sync.edit')}</button>
            <button type="button" className="secondary-button" disabled={!canEdit} title={offlineHint} onClick={() => onToggle(binding)}>{binding.enabled ? t('files:sync.pause') : t('files:sync.resume')}</button>
            <button type="button" className="secondary-button" disabled={!canEdit} title={offlineHint ?? t('files:sync.removeTitle')} onClick={() => onRemove(binding)}>{t('files:sync.remove')}</button>
          </li>;
        })}
      </ul>
    </section>
  );
}
