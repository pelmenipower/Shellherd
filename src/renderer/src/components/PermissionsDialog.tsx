import { useEffect, useId, useRef, useState } from 'react';
import type { FileEntry } from '../../../shared/sftp';
import { isDirectory, modeText, parseMode } from '../file-browser';
import { useNativeSurfaceBlock } from '../native-surface';
import { useT } from '../i18n';

interface PermissionsDialogProps {
  entries: FileEntry[];
  busy: boolean;
  onCancel: () => void;
  onApply: (mode: number, recursive: boolean) => void;
}

const who = [
  { id: 'owner', key: 'files:permissions.owner', shift: 6 },
  { id: 'group', key: 'files:permissions.group', shift: 3 },
  { id: 'others', key: 'files:permissions.others', shift: 0 },
] as const;
const what = [
  { id: 'read', key: 'files:permissions.read', bit: 4 },
  { id: 'write', key: 'files:permissions.write', bit: 2 },
  { id: 'execute', key: 'files:permissions.execute', bit: 1 },
] as const;

/** chmod for server files: checkboxes and octal value stay in sync. */
export function PermissionsDialog({ entries, busy, onCancel, onApply }: PermissionsDialogProps) {
  const { t } = useT();
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
      <h2 id={`${id}-title`}>{t('files:permissions.title', {
        target: entries.length === 1 ? t('files:permissions.one', { name: entries[0].name }) : t('files:transfer.entries', { count: entries.length }),
      })}</h2>
      {mixed && <p className="editor-hint">{t('files:permissions.mixed')}</p>}
      <table className="permissions-grid">
        <thead><tr><th scope="col"><span className="visually-hidden">{t('files:permissions.who')}</span></th>{what.map(item => <th key={item.bit} scope="col">{t(item.key)}</th>)}</tr></thead>
        <tbody>{who.map(row => <tr key={row.shift}><th scope="row">{t(row.key)}</th>
          {what.map(column => {
            const bit = column.bit << row.shift;
            return <td key={column.bit}><input type="checkbox"
              aria-label={t('files:permissions.cell', { who: t(row.key), what: t(column.key) })}
              checked={(mode & bit) !== 0} disabled={busy} onChange={() => toggle(bit)} /></td>;
          })}
        </tr>)}</tbody>
      </table>
      <label className="permissions-octal">{t('files:permissions.octal')}
        <input value={text} inputMode="numeric" spellCheck={false} disabled={busy} aria-invalid={!valid || undefined}
          onChange={event => { setText(event.target.value); const parsed = parseMode(event.target.value); if (parsed !== null) setMode(parsed); }} />
      </label>
      {!valid && <p className="field-error" role="alert">{t('files:permissions.invalid')}</p>}
      {hasFolder && <label className="editor-checkbox"><input type="checkbox" checked={recursive} disabled={busy} onChange={event => setRecursive(event.target.checked)} />
        {t('files:permissions.recursive')}</label>}
      <div className="form-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>{t('common:actions.cancel')}</button>
        <button type="button" className="primary-button" disabled={busy || !valid} onClick={() => onApply(mode, recursive)}>{busy ? t('common:wait') : t('files:permissions.apply')}</button>
      </div>
    </dialog>
  );
}
