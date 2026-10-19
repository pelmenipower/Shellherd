import { useEffect, useId, useRef, useState } from 'react';
import type { FolderNode } from '../../../shared/vault/types';
import { BusyButton } from './BusyButton';
import { ConfirmDialog } from './ConfirmDialog';
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
    if (!name.trim()) { setError('Gib einen Ordnernamen ein.'); nameRef.current?.focus(); return; }
    if (!dirty) return;
    if (await onSave(name, comment)) {
      setSaved({ name: name.trim(), comment: comment.trim() });
      setSavedCount(count => count + 1);
      onDirtyChange?.(false);
    }
  }

  return (
    <section className="node-editor compact-editor" aria-label="Ordner bearbeiten">
      <h2>Ordner bearbeiten</h2>
      <form noValidate data-editor-form onSubmit={event => { event.preventDefault(); void save(); }}>
        <label>Ordnername
          <input ref={nameRef} value={name} onChange={event => { setName(event.target.value); setError(null); }} disabled={busy}
            aria-invalid={!!error || undefined} aria-describedby={error ? errorId : undefined} />
        </label>
        {error && <p className="field-error" id={errorId} role="alert">{error}</p>}
        <label>Kommentar
          <textarea value={comment} onChange={event => setComment(event.target.value)} disabled={busy} rows={3} />
        </label>
        <div className="form-actions editor-action-bar">
          {onCancel && <button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>Abbrechen</button>}
          <button className="secondary-button" type="button" disabled={busy || !dirty} onClick={() => {
            setName(saved.name); setComment(saved.comment); setError(null);
          }}>Verwerfen</button>
          <BusyButton className="primary-button" type="submit" busy={busy} disabled={!dirty} idleLabel="Änderungen speichern" busyLabel="Speichert …" doneKey={savedCount} />
        </div>
      </form>
      <details className="editor-details editor-management">
        <summary>Ordner verwalten</summary>
        <p>Beim Löschen werden auch alle Unterordner und Verbindungen entfernt.</p>
        <button className="danger-button" type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>Ordner löschen</button>
      </details>
      {confirmDelete && <ConfirmDialog title={`Ordner „${folder.name}“ löschen?`}
        description="Der gesamte Inhalt dieses Ordners wird unwiderruflich entfernt. Verbindungen werden auch aus gespeicherten Workspaces entfernt. Aktive SSH-Sessions in diesem Ordner werden beendet."
        busy={busy} onCancel={() => setConfirmDelete(false)} onConfirm={() => {
          void onDelete().then(success => { if (success) setConfirmDelete(false); });
        }} />}
    </section>
  );
}
