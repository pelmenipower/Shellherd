import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { buildImportNodes, importDuplicates, importFolder, type ImportCandidate, type ImportNoteCode, type ImportPreview, type ImportSkipCode, type ImportSource } from '../../../shared/import';
import type { VaultNode } from '../../../shared/vault/types';
import { folderOptions } from '../connection-form';
import { errorText } from '../error-text';
import { useNativeSurfaceBlock } from '../native-surface';
import { notify } from '../notice-store';
import { t, useT } from '../i18n';

export interface ImportDialogProps { source: ImportSource; nodes: VaultNode[]; busy: boolean; onClose: () => void;
  /** Adds the nodes under parentId (undefined = top level) and saves; false when saving failed. */
  onImport: (nodes: VaultNode[], parentId: string | undefined) => Promise<boolean> }

// Target select values; folder ids are UUIDs, so they never collide with these.
const NEW_FOLDER = '__new__';
const ROOT = '';

/** Full literals, so unused keys can be found by search. */
const titleText = (source: ImportSource): string => ({
  openssh: t('vault:import.title.openssh'),
  putty: t('vault:import.title.putty'),
  winscp: t('vault:import.title.winscp'),
  mremoteng: t('vault:import.title.mremoteng'),
})[source];

const folderName = (source: ImportSource): string => ({
  openssh: t('vault:import.folder.openssh'),
  putty: t('vault:import.folder.putty'),
  winscp: t('vault:import.folder.winscp'),
  mremoteng: t('vault:import.folder.mremoteng'),
})[source];

/** File sources name the file; the registry sources name their registry. */
const sourceLine = (source: ImportSource, file: string | undefined): string => {
  if (file) return t('vault:import.sourceFile', { file });
  return source === 'winscp' ? t('vault:import.sourceRegistryWinscp') : t('vault:import.sourceRegistry');
};

const kindText = (protocol: 'sftp' | 'rdp'): string => ({
  sftp: t('vault:import.kind.sftp'),
  rdp: t('vault:import.kind.rdp'),
})[protocol];

const noteText = (code: ImportNoteCode): string => {
  const texts: Record<ImportNoteCode, string> = {
    ppkKey: t('vault:import.notes.ppkKey'),
    jumpUnsupported: t('vault:import.notes.jumpUnsupported'),
    proxyDropped: t('vault:import.notes.proxyDropped'),
    forwardsDropped: t('vault:import.notes.forwardsDropped'),
    keyUnresolved: t('vault:import.notes.keyUnresolved'),
    scpAsSftp: t('vault:import.notes.scpAsSftp'),
  };
  return texts[code];
};

const skipText = (code: ImportSkipCode, count: number): string => {
  const texts: Record<ImportSkipCode, string> = {
    match: t('vault:import.skipped.match', { count }),
    include: t('vault:import.skipped.include', { count }),
    notSsh: t('vault:import.skipped.notSsh', { count }),
    unsupported: t('vault:import.skipped.unsupported', { count }),
    invalid: t('vault:import.skipped.invalid', { count }),
    tooMany: t('vault:import.skipped.tooMany', { count }),
  };
  return texts[code];
};

/** Preview with duplicates unticked; they stay visible and can be ticked again. */
const preselected = (candidates: ImportCandidate[], duplicates: Set<string>): Set<string> =>
  new Set(candidates.filter(candidate => !duplicates.has(candidate.key)).map(candidate => candidate.key));

/** Reads the source once on open, then lets the user pick connections and a target folder. */
export function ImportDialog({ source, nodes, busy, onClose, onImport }: ImportDialogProps) {
  const { t } = useT();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const allRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [target, setTarget] = useState(NEW_FOLDER);
  const [saving, setSaving] = useState(false);
  useNativeSurfaceBlock(true);

  useEffect(() => { dialogRef.current?.showModal(); }, []);
  // StrictMode mounts twice in development; only the surviving mount opens the file dialog.
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      window.desktopApi.importRead(source).then(result => {
        if (!current) return;
        if (result.canceled) { onClose(); return; }
        setPreview(result.preview);
        setSelected(preselected(result.preview.candidates, importDuplicates(result.preview.candidates, nodes)));
      }).catch(failure => { if (current) setError(errorText(failure)); });
    });
    return () => { current = false; clearTimeout(timer); };
  }, [source]);

  const candidates = preview?.candidates ?? [];
  const byKey = useMemo(() => new Map(candidates.map(candidate => [candidate.key, candidate])), [candidates]);
  const duplicates = useMemo(() => importDuplicates(candidates, nodes), [candidates, nodes]);
  const plan = useMemo(() => (preview ? buildImportNodes(preview.candidates, selected) : null), [preview, selected]);
  const imported = plan ? selected.size - plan.invalid : 0;
  const allChecked = candidates.length > 0 && selected.size === candidates.length;
  const someChecked = selected.size > 0 && !allChecked;
  useEffect(() => { if (allRef.current) allRef.current.indeterminate = someChecked; }, [someChecked]);
  const locked = busy || saving;

  function toggle(key: string): void {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function submit(): Promise<void> {
    if (!preview || !plan || imported === 0) return;
    const parentId = target === NEW_FOLDER || target === ROOT ? undefined : target;
    const list = target === NEW_FOLDER ? [importFolder(folderName(source), plan.nodes)] : plan.nodes;
    setSaving(true);
    let saved: boolean;
    try { saved = await onImport(list, parentId); } finally { setSaving(false); }
    if (!saved) return;
    const skipped = candidates.length - imported + preview.skipped.reduce((sum, entry) => sum + entry.count, 0);
    const body = [
      skipped > 0 ? t('vault:import.resultSkipped', { count: skipped }) : '',
      plan.jumpsDropped > 0 ? t('vault:import.resultJumps', { count: plan.jumpsDropped }) : '',
    ].filter(Boolean).join(' ');
    notify.ok(t('vault:import.done', { count: imported }), { body: body || undefined });
    onClose();
  }

  return (
    <dialog ref={dialogRef} className="confirm-dialog import-dialog" aria-labelledby={`${id}-title`}
      onCancel={event => { event.preventDefault(); if (!locked) onClose(); }}>
      <h2 id={`${id}-title`}>{titleText(source)}</h2>
      {!preview && !error && <p>{t('vault:import.reading')}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      {preview && <>
        <p className="field-hint">{sourceLine(source, preview.file)}</p>
        {candidates.length === 0 ? <p>{t('vault:import.empty')}</p> : <>
          <label className="import-all">
            <input ref={allRef} type="checkbox" checked={allChecked} disabled={locked}
              onChange={() => setSelected(allChecked ? new Set() : new Set(candidates.map(candidate => candidate.key)))} />
            {t('vault:import.selectAll')}
          </label>
          <ul className="import-list">
            {candidates.map(candidate => {
              const via = candidate.jumpKey ? byKey.get(candidate.jumpKey) : undefined;
              const address = `${candidate.username ? `${candidate.username}@` : ''}${candidate.host}:${candidate.port}`;
              return <li key={candidate.key} className="import-row">
                <label className="import-main">
                  <input type="checkbox" checked={selected.has(candidate.key)} disabled={locked} onChange={() => toggle(candidate.key)} />
                  <span className="import-text">
                    <span className="import-name">{candidate.name}</span>
                    <small className="import-address">{address}</small>
                  </span>
                </label>
                <div className="import-meta">
                  {candidate.protocol !== 'ssh' && <span>{kindText(candidate.protocol)}</span>}
                  {candidate.folder.length > 0 && <span>{t('vault:import.inFolder', { path: candidate.folder.join(' / ') })}</span>}
                  {via && <span>{t('vault:import.via', { name: via.name })}</span>}
                  {candidate.forwards.length > 0 && <span>{t('vault:import.forwards', { count: candidate.forwards.length })}</span>}
                  {candidate.keyPath && <span title={candidate.keyPath}>{t('vault:import.keyFile')}</span>}
                  {duplicates.has(candidate.key) && <span className="import-badge">{t('vault:import.duplicate')}</span>}
                </div>
                {candidate.notes.map(code => <small key={code} className="field-hint">{noteText(code)}</small>)}
              </li>;
            })}
          </ul>
        </>}
        {preview.skipped.map(entry => <p key={entry.code} className="field-hint import-skip">{skipText(entry.code, entry.count)}</p>)}
        <p className="field-hint">{t('vault:import.hint')}</p>
        <label className="import-target">
          <span>{t('vault:import.target')}</span>
          <select value={target} disabled={locked} onChange={event => setTarget(event.target.value)}>
            <option value={NEW_FOLDER}>{t('vault:import.targetNew', { name: folderName(source) })}</option>
            <option value={ROOT}>{t('vault:import.targetRoot')}</option>
            {folderOptions(nodes).map(folder => <option key={folder.id} value={folder.id}>{folder.label}</option>)}
          </select>
        </label>
      </>}
      <div className="form-actions">
        {error
          ? <button className="secondary-button" type="button" onClick={onClose}>{t('common:actions.close')}</button>
          : <>
            <button className="secondary-button" type="button" disabled={locked} onClick={onClose}>{t('common:actions.cancel')}</button>
            <button className="primary-button" type="button" disabled={!plan || imported === 0 || locked} onClick={() => void submit()}>
              {t('vault:import.submit', { count: imported })}
            </button>
          </>}
      </div>
    </dialog>
  );
}
