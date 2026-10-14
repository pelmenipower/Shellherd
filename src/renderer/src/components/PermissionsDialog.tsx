import { useEffect, useId, useRef, useState } from 'react';
import type { FileEntry } from '../../../shared/sftp';
import { isDirectory, modeText, parseMode } from '../file-browser';
import { useNativeSurfaceBlock } from '../native-surface';

interface PermissionsDialogProps {
  entries: FileEntry[];
  busy: boolean;
  onCancel: () => void;
  onApply: (mode: number, recursive: boolean) => void;
}

const who = [{ label: 'Besitzer', shift: 6 }, { label: 'Gruppe', shift: 3 }, { label: 'Andere', shift: 0 }];
const what = [{ label: 'Lesen', bit: 4 }, { label: 'Schreiben', bit: 2 }, { label: 'Ausführen', bit: 1 }];

/** chmod for server files: checkboxes and octal value stay in sync. */
export function PermissionsDialog({ entries, busy, onCancel, onApply }: PermissionsDialogProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState(() => (entries[0]?.mode ?? 0o644) & 0o7777);
  const [text, setText] = useState(() => modeText(mode));
  const [recursive, setRecursive] = useState(false);
  useNativeSurfaceBlock(true);
  useEffect(() => { dialogRef.current?.showModal(); }, []);
  const hasFolder = entries.some(isDirectory);
  const mixed = entries.some(entry => (entry.mode ?? 0) !== (entries[0].mode ?? 0));
  const valid = parseMode(text) !== null;

  const toggle = (bit: number): void => {
    const next = mode ^ bit;
    setMode(next); setText(modeText(next));
  };

  return (
    <dialog ref={dialogRef} className="confirm-dialog conflict-dialog permissions-dialog" aria-labelledby={`${id}-title`}
      onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
      <h2 id={`${id}-title`}>Rechte für {entries.length === 1 ? `„${entries[0].name}“` : `${entries.length} Einträge`}</h2>
      {mixed && <p className="editor-hint">Die Einträge haben unterschiedliche Rechte; angezeigt sind die des ersten.</p>}
      <table className="permissions-grid">
        <thead><tr><th scope="col"><span className="visually-hidden">Wer</span></th>{what.map(item => <th key={item.bit} scope="col">{item.label}</th>)}</tr></thead>
        <tbody>{who.map(row => <tr key={row.shift}><th scope="row">{row.label}</th>
          {what.map(column => {
            const bit = column.bit << row.shift;
            return <td key={column.bit}><input type="checkbox" aria-label={`${row.label}: ${column.label}`} checked={(mode & bit) !== 0}
              disabled={busy} onChange={() => toggle(bit)} /></td>;
          })}
        </tr>)}</tbody>
      </table>
      <label className="permissions-octal">Oktal
        <input value={text} inputMode="numeric" spellCheck={false} disabled={busy} aria-invalid={!valid || undefined}
          onChange={event => { setText(event.target.value); const parsed = parseMode(event.target.value); if (parsed !== null) setMode(parsed); }} />
      </label>
      {!valid && <p className="field-error" role="alert">Bitte drei oder vier Ziffern von 0 bis 7 eingeben, z. B. 644.</p>}
      {hasFolder && <label className="editor-checkbox"><input type="checkbox" checked={recursive} disabled={busy} onChange={event => setRecursive(event.target.checked)} />
        Auch für alle Dateien und Ordner darin setzen</label>}
      <div className="form-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Abbrechen</button>
        <button type="button" className="primary-button" disabled={busy || !valid} onClick={() => onApply(mode, recursive)}>{busy ? 'Bitte warten …' : 'Übernehmen'}</button>
      </div>
    </dialog>
  );
}
