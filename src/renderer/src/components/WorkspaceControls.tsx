import { useEffect, useRef, useState } from 'react';
import type { Workspace } from '../../../shared/vault/types';
import { ConfirmDialog } from './ConfirmDialog';
import { workspaceSummary } from '../terminal-views';
import { useT } from '../i18n';
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
  const { t } = useT();
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
    setName(nextMode === 'rename' ? selected?.name ?? '' : active ? t('vault:workspaces.copyName', { name: active.name }) : '');
    setMode(nextMode); setError('');
    if (menuRef.current) menuRef.current.open = true;
  };
  const saveActive = async () => {
    if (unavailable) return;
    if (!active) { beginName('saveAs'); return; }
    setPending(true); setError('');
    try {
      if (await onSave(active.name, active.id)) closeMenu();
      else { setError(t('vault:workspaces.saveFailed')); if (menuRef.current) menuRef.current.open = true; }
    } catch { setError(t('vault:workspaces.saveFailed')); if (menuRef.current) menuRef.current.open = true; }
    finally { setPending(false); }
  };
  const submitName = async () => {
    if (unavailable || !mode) return;
    if (!name.trim()) { setError(t('vault:workspaces.nameRequired')); nameRef.current?.focus(); return; }
    setPending(true); setError('');
    try {
      const result = mode === 'rename' && selected ? await onRename(selected.id, name.trim()) : await onSave(name.trim());
      if (result) closeMenu(); else setError(t('vault:workspaces.saveFailed'));
    } catch { setError(t('vault:workspaces.saveFailed')); }
    finally { setPending(false); }
  };
  return <div className="workspace-switcher" aria-label={t('vault:workspaces.aria')}>
    <details ref={menuRef} className="workspace-menu" onKeyDown={event => {
      if (event.key === 'Escape' && !unavailable && !deletingId) { event.preventDefault(); event.stopPropagation(); closeMenu(); }
    }}>
      <summary aria-label={t('vault:workspaces.menu')} title={active?.name ?? t('vault:workspaces.unsaved')} onClick={event => {
        if (unavailable) { event.preventDefault(); return; }
        if (!menuRef.current?.open) { setSelectedId(activeId ?? workspaces[0]?.id ?? ''); setMode(null); setError(''); }
      }}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M12 4v16M12 12h9" /></svg>
        <span className="workspace-current-name">{active?.name ?? t('vault:workspaces.unsaved')}</span>
        {dirty && <span className="workspace-dirty" title={t('vault:workspaces.dirty')} aria-label={t('vault:workspaces.dirty')}>{t('vault:workspaces.dirtyBadge')}</span>}
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m5 9 7 7 7-7" /></svg>
      </summary>
      <div className="workspace-menu-content">
        {mode ? <form className="workspace-name-form" onSubmit={event => { event.preventDefault(); void submitName(); }}>
          <label>{mode === 'rename' ? t('vault:workspaces.renameLabel') : t('vault:workspaces.saveAsLabel')}
            <input ref={nameRef} aria-label={t('vault:workspaces.nameLabel')} value={name} disabled={unavailable} aria-invalid={Boolean(error)}
              onChange={event => { setName(event.target.value); setError(''); }} /></label>
          <div className="workspace-menu-actions"><button type="button" disabled={unavailable} onClick={() => { setMode(null); setError(''); }}>{t('common:actions.cancel')}</button>
            <button type="submit" disabled={unavailable}>{pending ? t('common:status.saving') : t('common:actions.save')}</button></div>
        </form> : <>
          <label className="workspace-definition-label">{t('vault:workspaces.savedLabel')}
            <select aria-label={t('vault:workspaces.selectAria')} value={selectedId} disabled={unavailable || workspaces.length === 0} onChange={event => setSelectedId(event.target.value)}>
              <option value="">{t('vault:workspaces.choose')}</option>{workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
            </select>
          </label>
          {selected && <p className="workspace-menu-hint">{t('vault:workspaces.contains', { summary: workspaceSummary(selected) })}</p>}
          <div className="workspace-definition-actions">
            <button type="button" disabled={unavailable || !selected} onClick={() => { if (selected) { closeMenu(); onOpen(selected.id); } }}>{t('vault:workspaces.open')}</button>
            <button type="button" disabled={unavailable || !selected} onClick={() => beginName('rename')}>{t('common:actions.rename')}</button>
            <button type="button" disabled={unavailable || !selected} onClick={() => setDeletingId(selectedId)}>{t('vault:workspaces.deleteWorkspace')}</button>
          </div>
          {workspaces.length === 0 && <p className="workspace-menu-hint">{t('vault:workspaces.emptyHint')}</p>}
          <div className="workspace-current-actions">
            <button type="button" disabled={unavailable} onClick={() => { void saveActive(); }}>{active ? t('vault:workspaces.saveLayoutNamed', { name: active.name }) : t('vault:workspaces.saveLayout')}</button>
            <button type="button" disabled={unavailable} onClick={() => beginName('saveAs')}>{t('vault:workspaces.saveAs')}</button>
            <button type="button" disabled={unavailable || !hasTabs} onClick={() => { closeMenu(); onClose(); }}>{t('vault:workspaces.closeWorkspace')}</button>
          </div>
        </>}
        {error && <p className="workspace-menu-error" role="alert">{error}</p>}
      </div>
    </details>
    <button className="workspace-save" type="button" disabled={unavailable || (Boolean(active) && !dirty)} onClick={() => { void saveActive(); }}>
      {unavailable ? t('common:status.saving') : t('common:actions.save')}
    </button>
    {deletingId && <ConfirmDialog title={t('vault:workspaces.confirmTitle')} description={t('vault:workspaces.confirmDescription', { name: workspaces.find(workspace => workspace.id === deletingId)?.name ?? t('vault:workspaces.fallbackName') })}
      busy={unavailable} onCancel={() => setDeletingId(null)} onConfirm={() => {
        setPending(true);
        void onDelete(deletingId).then(saved => { if (saved) setDeletingId(null); }).catch(() => { setError(t('vault:workspaces.deleteFailed')); setDeletingId(null); }).finally(() => setPending(false));
      }} />}
  </div>;
}
