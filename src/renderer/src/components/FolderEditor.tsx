import { useEffect, useId, useRef, useState } from 'react';
import type { FolderNode } from '../../../shared/vault/types';
import { BusyButton } from './BusyButton';
import { ConfirmDialog } from './ConfirmDialog';
import { useT } from '../i18n';
import './editor-ui.css';

interface FolderEditorProps {
  folder: FolderNode;
  busy: boolean;
  onSave: (name: string, comment: string) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onDirtyChange?: (dirty: boolean) => void;
  onCancel?: () => void;
}

export function FolderEditor({ folder, busy, onSave, onDelete, onDirtyChange, onCancel }: FolderEditorProps) {
  const { t } = useT();
  const [name, setName] = useState(folder.name);
  const [comment, setComment] = useState(folder.comment ?? '');
  const [saved, setSaved] = useState({ name: folder.name, comment: folder.comment ?? '' });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const dirty = name.trim() !== saved.name || comment.trim() !== saved.comment;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  async function save(): Promise<void> {
    if (busy) return;
    if (!name.trim()) { setError(t('vault:folderEditor.nameRequired')); nameRef.current?.focus(); return; }
    if (!dirty) return;
    if (await onSave(name, comment)) {
      setSaved({ name: name.trim(), comment: comment.trim() });
      setSavedCount(count => count + 1);
      onDirtyChange?.(false);
    }
  }

  return (
    <section className="node-editor compact-editor" aria-label={t('vault:folderEditor.title')}>
      <h2>{t('vault:folderEditor.title')}</h2>
      <form noValidate data-editor-form onSubmit={event => { event.preventDefault(); void save(); }}>
        <label>{t('vault:folderEditor.nameLabel')}
          <input ref={nameRef} value={name} onChange={event => { setName(event.target.value); setError(null); }} disabled={busy}
            aria-invalid={!!error || undefined} aria-describedby={error ? errorId : undefined} />
        </label>
        {error && <p className="field-error" id={errorId} role="alert">{error}</p>}
        <label>{t('vault:folderEditor.commentLabel')}
          <textarea value={comment} onChange={event => setComment(event.target.value)} disabled={busy} rows={3} />
        </label>
        <div className="form-actions editor-action-bar">
          {onCancel && <button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>{t('common:actions.cancel')}</button>}
          <button className="secondary-button" type="button" disabled={busy || !dirty} onClick={() => {
            setName(saved.name); setComment(saved.comment); setError(null);
          }}>{t('vault:folderEditor.discard')}</button>
          <BusyButton className="primary-button" type="submit" busy={busy} disabled={!dirty} idleLabel={t('vault:folderEditor.saveChanges')} busyLabel={t('common:status.saving')} doneKey={savedCount} />
        </div>
      </form>
      <details className="editor-details editor-management">
        <summary>{t('vault:folderEditor.manage')}</summary>
        <p>{t('vault:folderEditor.manageHint')}</p>
        <button className="danger-button" type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>{t('vault:folderEditor.deleteFolder')}</button>
      </details>
      {confirmDelete && <ConfirmDialog title={t('vault:folderEditor.confirmTitle', { name: folder.name })}
        description={t('vault:folderEditor.confirmDescription')}
        busy={busy} onCancel={() => setConfirmDelete(false)} onConfirm={() => {
          void onDelete().then(success => { if (success) setConfirmDelete(false); });
        }} />}
    </section>
  );
}
