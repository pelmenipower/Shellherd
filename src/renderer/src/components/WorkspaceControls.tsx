import { useEffect, useRef, useState } from 'react';
import type { Workspace } from '../../../shared/vault/types';
import { ConfirmDialog } from './ConfirmDialog';
import './navigation-ui.css';
interface Props {
  workspaces: Workspace[]; busy: boolean; hasTabs: boolean;
  activeId?: string | null; dirty?: boolean;
  onSave: (name: string, id?: string) => Promise<string | null>;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onClose: () => void;
}
export function WorkspaceControls({ workspaces, busy, hasTabs, activeId = null, dirty = false, onSave, onOpen, onRename, onDelete, onClose }: Props) {
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'saveAs' | 'rename' | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const menuRef = useRef<HTMLDetailsElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const active = workspaces.find(workspace => workspace.id === activeId);
  const selected = workspaces.find(workspace => workspace.id === selectedId);
  const unavailable = busy || pending;
  const closeMenu = () => {
    if (menuRef.current) menuRef.current.open = false;
    setMode(null); setError('');
    menuRef.current?.querySelector('summary')?.focus();
  };
  useEffect(() => {
    if (selectedId && !workspaces.some(workspace => workspace.id === selectedId)) setSelectedId('');
  }, [selectedId, workspaces]);
  useEffect(() => { if (mode) { nameRef.current?.focus(); nameRef.current?.select(); } }, [mode]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (menuRef.current?.open && !menuRef.current.contains(event.target as Node) && !deletingId && !unavailable) {
        menuRef.current.open = false; setMode(null); setError('');
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [deletingId, unavailable]);
  const beginName = (nextMode: 'saveAs' | 'rename') => {
    setName(nextMode === 'rename' ? selected?.name ?? '' : active ? `${active.name} Kopie` : '');
    setMode(nextMode); setError('');
    if (menuRef.current) menuRef.current.open = true;
  };
  const saveActive = async () => {
    if (unavailable) return;
    if (!active) { beginName('saveAs'); return; }
    setPending(true); setError('');
    try {
      if (await onSave(active.name, active.id)) closeMenu();
      else { setError('Speichern fehlgeschlagen. Bitte erneut versuchen.'); if (menuRef.current) menuRef.current.open = true; }
    } catch { setError('Speichern fehlgeschlagen. Bitte erneut versuchen.'); if (menuRef.current) menuRef.current.open = true; }
    finally { setPending(false); }
  };
  const submitName = async () => {
    if (unavailable || !mode) return;
    if (!name.trim()) { setError('Bitte einen Workspace-Namen eingeben.'); nameRef.current?.focus(); return; }
    setPending(true); setError('');
    try {
      const result = mode === 'rename' && selected ? await onRename(selected.id, name.trim()) : await onSave(name.trim());
      if (result) closeMenu(); else setError('Speichern fehlgeschlagen. Bitte erneut versuchen.');
    } catch { setError('Speichern fehlgeschlagen. Bitte erneut versuchen.'); }
    finally { setPending(false); }
  };
  return <div className="workspace-switcher" aria-label="Workspace-Verwaltung">
    <details ref={menuRef} className="workspace-menu" onKeyDown={event => {
      if (event.key === 'Escape' && !unavailable && !deletingId) { event.preventDefault(); event.stopPropagation(); closeMenu(); }
    }}>
      <summary aria-label="Workspace-Menü" title={active?.name ?? 'Ungespeicherter Workspace'} onClick={event => {
        if (unavailable) { event.preventDefault(); return; }
        if (!menuRef.current?.open) { setSelectedId(activeId ?? workspaces[0]?.id ?? ''); setMode(null); setError(''); }
      }}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M12 4v16M12 12h9" /></svg>
        <span className="workspace-current-name">{active?.name ?? 'Ungespeicherter Workspace'}</span>
        {dirty && <span className="workspace-dirty" title="Layout geändert" aria-label="Layout geändert">geändert</span>}
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m5 9 7 7 7-7" /></svg>
      </summary>
      <div className="workspace-menu-content">
        {mode ? <form className="workspace-name-form" onSubmit={event => { event.preventDefault(); void submitName(); }}>
          <label>{mode === 'rename' ? 'Workspace umbenennen' : 'Workspace speichern unter'}
            <input ref={nameRef} aria-label="Workspace-Name" value={name} disabled={unavailable} aria-invalid={Boolean(error)}
              onChange={event => { setName(event.target.value); setError(''); }} /></label>
          <div className="workspace-menu-actions"><button type="button" disabled={unavailable} onClick={() => { setMode(null); setError(''); }}>Abbrechen</button>
            <button type="submit" disabled={unavailable}>{pending ? 'Speichert …' : 'Speichern'}</button></div>
        </form> : <>
          <label className="workspace-definition-label">Gespeicherte Workspaces
            <select aria-label="Gespeicherter Workspace" value={selectedId} disabled={unavailable || workspaces.length === 0} onChange={event => setSelectedId(event.target.value)}>
              <option value="">Workspace auswählen</option>{workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
            </select>
          </label>
          <div className="workspace-definition-actions">
            <button type="button" disabled={unavailable || !selected} onClick={() => { if (selected) { closeMenu(); onOpen(selected.id); } }}>Workspace öffnen</button>
            <button type="button" disabled={unavailable || !selected} onClick={() => beginName('rename')}>Umbenennen</button>
            <button type="button" disabled={unavailable || !selected} onClick={() => setDeletingId(selectedId)}>Workspace löschen</button>
          </div>
          {workspaces.length === 0 && <p className="workspace-menu-hint">Speichere deine Terminalanordnung als Workspace.</p>}
          <div className="workspace-current-actions">
            <button type="button" disabled={unavailable} onClick={() => { void saveActive(); }}>Layout speichern{active ? `: ${active.name}` : ''}</button>
            <button type="button" disabled={unavailable} onClick={() => beginName('saveAs')}>Speichern unter …</button>
            <button type="button" disabled={unavailable || !hasTabs} onClick={() => { closeMenu(); onClose(); }}>Workspace schließen</button>
          </div>
        </>}
        {error && <p className="workspace-menu-error" role="alert">{error}</p>}
      </div>
    </details>
    <button className="workspace-save" type="button" disabled={unavailable || (Boolean(active) && !dirty)} onClick={() => { void saveActive(); }}>
      {unavailable ? 'Speichert …' : 'Speichern'}
    </button>
    {deletingId && <ConfirmDialog title="Gespeicherten Workspace löschen?" description={`„${workspaces.find(workspace => workspace.id === deletingId)?.name ?? 'Workspace'}“ wird entfernt. Aktive SSH-Sessions bleiben geöffnet.`}
      busy={unavailable} onCancel={() => setDeletingId(null)} onConfirm={() => {
        setPending(true);
        void onDelete(deletingId).then(saved => { if (saved) setDeletingId(null); }).catch(() => { setError('Löschen fehlgeschlagen. Bitte erneut versuchen.'); setDeletingId(null); }).finally(() => setPending(false));
      }} />}
  </div>;
}
