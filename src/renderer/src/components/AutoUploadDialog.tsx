import { useEffect, useId, useRef, useState } from 'react';
import type { AutoUploadBinding } from '../../../shared/vault/types';
import { autoUploadErrors, bindingFromDraft, draftOf, type AutoUploadField } from '../auto-upload-form';
import { useNativeSurfaceBlock } from '../native-surface';
import { useT } from '../i18n';
import { BusyButton } from './BusyButton';

export interface AutoUploadDialogProps {
  binding: AutoUploadBinding; others: AutoUploadBinding[]; isNew: boolean; busy: boolean;
  onCancel: () => void; onSave: (binding: AutoUploadBinding) => void;
}

/** Set up or edit one auto-upload binding; errors show after the first save attempt. */
export function AutoUploadDialog({ binding, others, isNew, busy, onCancel, onSave }: AutoUploadDialogProps) {
  const { t } = useT();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(() => draftOf(binding));
  const [attempted, setAttempted] = useState(false);
  useNativeSurfaceBlock(true);
  useEffect(() => { dialogRef.current?.showModal(); }, []);
  const candidate = bindingFromDraft(binding, draft);
  const errors = attempted ? autoUploadErrors(candidate, others) : {};

  const submit = (): void => {
    setAttempted(true);
    if (Object.keys(autoUploadErrors(candidate, others)).length === 0) onSave(candidate);
  };
  const set = (field: AutoUploadField, value: string): void => setDraft(current => ({ ...current, [field]: value }));
  const fieldProps = (field: AutoUploadField, extra?: string) => ({
    value: draft[field], disabled: busy, spellCheck: false, 'aria-invalid': errors[field] ? true as const : undefined,
    'aria-describedby': [errors[field] ? `${id}-${field}-error` : '', extra ?? ''].filter(Boolean).join(' ') || undefined,
    onChange: (event: { target: { value: string } }) => set(field, event.target.value),
  });
  const error = (field: AutoUploadField) => errors[field]
    ? <p className="field-error" id={`${id}-${field}-error`} role="alert">{errors[field]}</p> : null;

  return (
    <dialog ref={dialogRef} className="confirm-dialog conflict-dialog file-sync-dialog" aria-labelledby={`${id}-title`}
      onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
      <form onSubmit={event => { event.preventDefault(); if (!busy) submit(); }} noValidate>
        <h2 id={`${id}-title`}>{t(isNew ? 'files:sync.dialog.titleNew' : 'files:sync.dialog.titleEdit')}</h2>
        <p className="editor-hint">{t('files:sync.hint')}</p>
        <label>{t('files:sync.dialog.local')}<input {...fieldProps('localPath')} /></label>
        {error('localPath')}
        <label>{t('files:sync.dialog.remote')}<input {...fieldProps('remotePath')} /></label>
        {error('remotePath')}
        <label>{t('files:sync.dialog.excludes')}<textarea {...fieldProps('excludes', `${id}-excludes-hint`)} /></label>
        <p className="editor-hint" id={`${id}-excludes-hint`}>{t('files:sync.dialog.excludesHint')}</p>
        {error('excludes')}
        <div className="form-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>{t('common:actions.cancel')}</button>
          <BusyButton type="submit" className="primary-button" busy={busy}
            idleLabel={t(isNew ? 'files:sync.dialog.start' : 'files:sync.dialog.apply')} busyLabel={t('common:wait')} />
        </div>
      </form>
    </dialog>
  );
}
