import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react';
import type { EditorChoice, FileEntry } from '../../../shared/sftp';
import type { FileSide, SortKey, SortOrder } from '../file-browser';
import { useT } from '../i18n';
import { ContextMenu } from './ContextMenu';
import { formatDate, formatSize, isDirectory, joinPath, nameError, nextSelection, parentPath, pathSegments, sortEntries } from '../file-browser';

export const FILES_MIME = 'application/x-shellherd-files';
/** Drag payload between the two sides of one file tab. */
export interface FileDrag { tabId: string; side: FileSide; dir: string; names: string[] }

export interface FileListing { path: string | null; entries: FileEntry[]; loading: boolean; error: string | null }

interface FilePaneProps {
  tabId: string;
  side: FileSide;
  title: string;
  listing: FileListing;
  active: boolean;
  disabled: boolean;
  /** Shown instead of the list, e.g. while the server connects. */
  notice?: { text: string; action?: { label: string; run: () => void } };
  home: string | null;
  drives?: string[];
  onActivate: () => void;
  onNavigate: (path: string) => void;
  onRefresh: () => void;
  onMkdir: (path: string) => Promise<boolean>;
  onRename: (from: string, to: string) => Promise<boolean>;
  onDelete: (paths: string[], names: string[]) => void;
  /** Copy or move to the current folder of the other side. */
  onCopy: (paths: string[], move: boolean) => void;
  /** Server side: open a file in a local editor; saving uploads it. */
  onEdit: (path: string, editor: EditorChoice) => void;
  /** Creates an empty file and opens it for editing. */
  onCreateFile: (path: string) => Promise<boolean>;
  /** Server side: change permission bits. */
  onPermissions?: (paths: string[], entries: FileEntry[]) => void;
  /** Files dragged in: from the other side or, for the server side, from Explorer. */
  onDrop: (drag: FileDrag | { external: string[] }, targetDir: string, move: boolean) => void;
  /** Local side: set up auto-upload for a folder. */
  onAutoUpload?: (localDir: string) => void;
  /** Set: the menu entry is disabled and shows this text. */
  autoUploadHint?: string;
}

type Prompt = { kind: 'mkdir'; value: string; error?: string } | { kind: 'file'; value: string; error?: string } | { kind: 'rename'; original: string; value: string; error?: string };

const columns: SortKey[] = ['name', 'size', 'modified'];
const COLUMN_KEYS = {
  name: 'files:pane.name', size: 'files:pane.size', modified: 'files:pane.modified',
} as const satisfies Record<SortKey, string>;

export function FilePane({ tabId, side, title, listing, active, disabled, notice, home, drives, onActivate, onNavigate, onRefresh,
  onMkdir, onRename, onDelete, onCopy, onDrop, onEdit, onCreateFile, onPermissions, onAutoUpload, autoUploadHint }: FilePaneProps) {
  const { t, i18n } = useT();
  const [sort, setSort] = useState<SortOrder>({ key: 'name', ascending: true });
  const [selected, setSelected] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [toolsMenu, setToolsMenu] = useState<{ x: number; y: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const entries = useMemo(() => sortEntries(listing.entries, sort), [listing.entries, sort, i18n.language]);
  const names = useMemo(() => entries.map(entry => entry.name), [entries]);
  const path = listing.path;
  const parent = path ? parentPath(side, path) : null;

  // A new folder starts without selection; a refresh keeps what still exists.
  useEffect(() => { setSelected([]); setAnchor(null); setCursor(null); setPrompt(null); }, [path]);
  useEffect(() => {
    setSelected(current => current.filter(name => names.includes(name)));
    setCursor(current => current && names.includes(current) ? current : null);
  }, [names]);
  useEffect(() => {
    if (cursor) listRef.current?.querySelector(`[data-name="${CSS.escape(cursor)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const targets = (): string[] => {
    const chosen = selected.length ? selected : cursor ? [cursor] : [];
    return chosen.filter(name => names.includes(name));
  };
  const fullPaths = (list: string[]): string[] => path ? list.map(name => joinPath(side, path, name)) : [];
  const open = (entry: FileEntry): void => {
    if (!path) return;
    if (isDirectory(entry)) onNavigate(joinPath(side, path, entry.name));
    else if (entry.type === 'file' || entry.linkTarget === 'file') onEdit(joinPath(side, path, entry.name), 'default');
  };
  const permissions = (list: string[]): void => {
    const chosen = entries.filter(entry => list.includes(entry.name));
    if (chosen.length && onPermissions) onPermissions(fullPaths(list), chosen);
  };
  const select = (name: string, event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): void => {
    const next = nextSelection(names, selected, anchor, name, { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey });
    setSelected(next.selected); setAnchor(next.anchor); setCursor(name);
  };
  const beginRename = (): void => { const [first] = targets(); if (first) setPrompt({ kind: 'rename', original: first, value: first }); };
  const submitPrompt = async (): Promise<void> => {
    if (!prompt || !path) return;
    const error = nameError(side, prompt.value);
    if (error) { setPrompt({ ...prompt, error }); return; }
    const name = prompt.value.trim();
    if (prompt.kind === 'rename' && name === prompt.original) { setPrompt(null); return; }
    if (names.includes(name)) { setPrompt({ ...prompt, error: t('files:names.exists') }); return; }
    const done = prompt.kind === 'mkdir' ? await onMkdir(joinPath(side, path, name))
      : prompt.kind === 'file' ? await onCreateFile(joinPath(side, path, name))
      : await onRename(joinPath(side, path, prompt.original), joinPath(side, path, name));
    if (done) { setPrompt(null); setSelected([name]); setCursor(name); setAnchor(name); listRef.current?.focus(); }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled || prompt || !path) return;
    const index = cursor ? names.indexOf(cursor) : -1;
    const moveTo = (next: number): void => {
      const name = names[Math.max(0, Math.min(names.length - 1, next))];
      if (!name) return;
      if (event.shiftKey) { const result = nextSelection(names, selected, anchor ?? cursor, name, { ctrl: false, shift: true }); setSelected(result.selected); setAnchor(result.anchor); }
      else { setSelected([name]); setAnchor(name); }
      setCursor(name);
    };
    const handled = (): void => { event.preventDefault(); event.stopPropagation(); };
    if (event.key === 'ArrowDown') { handled(); moveTo(index + 1); }
    else if (event.key === 'ArrowUp') { handled(); moveTo(index < 0 ? 0 : index - 1); }
    else if (event.key === 'Home') { handled(); moveTo(0); }
    else if (event.key === 'End') { handled(); moveTo(names.length - 1); }
    else if (event.key === 'Enter') { handled(); const entry = entries[index]; if (entry) open(entry); }
    else if (event.key === 'Backspace') { handled(); if (parent) onNavigate(parent); }
    else if (event.key === 'F5' || event.key === 'F6') { handled(); const list = targets(); if (list.length) onCopy(fullPaths(list), event.key === 'F6'); }
    else if (event.key === 'F2') { handled(); beginRename(); }
    else if (event.key === 'F4' && event.shiftKey) { handled(); setPrompt({ kind: 'file', value: '' }); }
    else if (event.key === 'F4') { handled(); const entry = entries[index]; if (entry && !isDirectory(entry)) onEdit(joinPath(side, path, entry.name), 'default'); }
    else if (event.key === 'F9' && onPermissions) { handled(); permissions(targets()); }
    else if (event.key === 'F7') { handled(); setPrompt({ kind: 'mkdir', value: '' }); }
    else if (event.key === 'Delete') { handled(); const list = targets(); if (list.length) onDelete(fullPaths(list), list); }
    else if (event.key.toLowerCase() === 'a' && (event.ctrlKey || event.metaKey)) { handled(); setSelected(names); }
    else if (event.key.toLowerCase() === 'r' && event.ctrlKey) { handled(); onRefresh(); }
  };

  const dragPayload = (event: DragEvent): FileDrag | { external: string[] } | null => {
    const raw = event.dataTransfer.getData(FILES_MIME);
    if (raw) {
      try {
        const drag = JSON.parse(raw) as FileDrag;
        return drag.tabId === tabId && drag.side !== side ? drag : null;
      } catch { return null; }
    }
    if (side !== 'remote' || !event.dataTransfer.files.length) return null;
    const external = [...event.dataTransfer.files].map(file => window.desktopApi.pathForFile(file)).filter(Boolean);
    return external.length ? { external } : null;
  };
  const accepts = (event: DragEvent): boolean => {
    const types = [...event.dataTransfer.types];
    return !disabled && !!path && (types.includes(FILES_MIME) || (side === 'remote' && types.includes('Files')));
  };
  const onDragOver = (event: DragEvent, folder?: string): void => {
    if (!accepts(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = event.shiftKey ? 'move' : 'copy';
    setDropTarget(folder ?? '');
  };
  const handleDrop = (event: DragEvent, folder?: string): void => {
    setDropTarget(null);
    if (!accepts(event) || !path) return;
    event.preventDefault();
    event.stopPropagation();
    const payload = dragPayload(event);
    if (payload) onDrop(payload, folder ? joinPath(side, path, folder) : path, event.shiftKey);
  };
  const onDragStart = (event: DragEvent, name: string): void => {
    if (disabled || !path) { event.preventDefault(); return; }
    const list = selected.includes(name) ? selected : [name];
    if (!selected.includes(name)) { setSelected([name]); setAnchor(name); setCursor(name); }
    const drag: FileDrag = { tabId, side, dir: path, names: list };
    event.dataTransfer.setData(FILES_MIME, JSON.stringify(drag));
    event.dataTransfer.effectAllowed = 'copyMove';
  };

  const openMenu = (event: MouseEvent, name?: string): void => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled || !path) return;
    if (name && !selected.includes(name)) { setSelected([name]); setAnchor(name); }
    if (name) setCursor(name);
    if (!name) { setSelected([]); setCursor(null); }
    setMenu({ x: event.clientX, y: event.clientY });
  };
  const menuTargets = targets();
  const menuFolder = menuTargets.length === 1 ? entries.find(entry => entry.name === menuTargets[0] && isDirectory(entry)) : undefined;

  const selectedEntries = entries.filter(entry => selected.includes(entry.name));
  const selectedBytes = selectedEntries.reduce((total, entry) => total + (isDirectory(entry) ? 0 : entry.size), 0);

  return (
    <section className={`file-pane file-pane-${side}${active ? ' is-active' : ''}`} aria-label={title} onPointerDown={onActivate}>
      <header className="file-pane-header">
        <strong>{title}</strong>
        <div className="file-pane-tools">
          {drives && drives.length > 0 && <select aria-label={t('files:pane.drive')} value={drives.find(drive => path?.toUpperCase().startsWith(drive.toUpperCase())) ?? ''}
            disabled={disabled} onChange={event => onNavigate(event.target.value)}>
            {drives.map(drive => <option key={drive} value={drive}>{drive.replace(/\\$/, '')}</option>)}
          </select>}
          <button type="button" title={t('files:pane.upTitle')} aria-label={t('files:pane.up')} disabled={disabled || !parent} onClick={() => parent && onNavigate(parent)}>↑</button>
          <button type="button" title={t('files:pane.home')} aria-label={t('files:pane.home')} disabled={disabled || !home} onClick={() => home && onNavigate(home)}>⌂</button>
          <button type="button" title={t('files:pane.refreshTitle')} aria-label={t('files:pane.refresh')} disabled={disabled || !path} onClick={onRefresh}>⟳</button>
          <button type="button" title={t('files:pane.folderMenu')} aria-label={t('files:pane.folderMenu')} aria-haspopup="menu" disabled={disabled || !path}
            onClick={event => { const box = event.currentTarget.getBoundingClientRect(); setToolsMenu({ x: box.left, y: box.bottom }); }}>⚙</button>
        </div>
      </header>
      <div className="file-path">
        {editingPath !== null ? <form onSubmit={event => { event.preventDefault(); const value = editingPath.trim(); setEditingPath(null); if (value) onNavigate(value); }}>
          <input autoFocus aria-label={t('files:pane.path')} value={editingPath} spellCheck={false} onChange={event => setEditingPath(event.target.value)}
            onBlur={() => setEditingPath(null)} onKeyDown={event => { if (event.key === 'Escape') setEditingPath(null); }} />
        </form> : <nav aria-label={t('files:pane.path')} onDoubleClick={() => path && setEditingPath(path)} title={t('files:pane.pathHint')}>
          {path && pathSegments(side, path).map((segment, index, all) => <span key={segment.path}>
            <button type="button" disabled={disabled || index === all.length - 1} onClick={() => onNavigate(segment.path)}>{segment.label}</button>
            {index < all.length - 1 && segment.label !== '/' && <span aria-hidden="true">{side === 'remote' ? '/' : '\\'}</span>}
          </span>)}
        </nav>}
      </div>
      {prompt && <form className="file-prompt" onSubmit={event => { event.preventDefault(); void submitPrompt(); }}>
        <label>{prompt.kind === 'mkdir' ? t('files:pane.newFolder') : prompt.kind === 'file' ? (side === 'remote' ? t('files:pane.newFileRemote') : t('files:pane.newFile')) : t('files:pane.renamePrompt', { name: prompt.original })}
          <input autoFocus value={prompt.value} spellCheck={false} aria-invalid={!!prompt.error || undefined}
            onFocus={event => { if (prompt.kind === 'rename') { const dot = prompt.original.lastIndexOf('.'); event.target.setSelectionRange(0, dot > 0 ? dot : prompt.original.length); } }}
            onChange={event => setPrompt({ ...prompt, value: event.target.value, error: undefined })}
            onKeyDown={event => { if (event.key === 'Escape') { setPrompt(null); listRef.current?.focus(); } }} /></label>
        <button type="submit" className="primary-button" disabled={disabled}>{prompt.kind === 'rename' ? t('common:actions.rename') : t('files:pane.create')}</button>
        <button type="button" className="secondary-button" onClick={() => setPrompt(null)}>{t('common:actions.cancel')}</button>
        {prompt.error && <p className="field-error" role="alert">{prompt.error}</p>}
      </form>}
      {listing.error && <p className="file-error" role="alert">{listing.error}</p>}
      {notice ? <div className="file-notice"><p>{notice.text}</p>
        {notice.action && <button type="button" className="secondary-button" onClick={notice.action.run}>{notice.action.label}</button>}</div>
      : <div ref={listRef} className={`file-list${dropTarget === '' ? ' is-drop-target' : ''}`} tabIndex={0} role="grid" aria-multiselectable="true"
        aria-busy={listing.loading} aria-label={t('files:pane.list', { title })} onKeyDown={onKeyDown}
        onDragOver={event => onDragOver(event)} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(null); }}
        onDrop={event => handleDrop(event)}
        onClick={event => { if (event.target === event.currentTarget) { setSelected([]); setAnchor(null); } }}
        onContextMenu={event => openMenu(event)}>
        <div className="file-row file-row-head" role="row">
          {columns.map(column => <span key={column} role="columnheader" aria-sort={sort.key === column ? (sort.ascending ? 'ascending' : 'descending') : 'none'}>
            <button type="button" tabIndex={-1} onClick={() => setSort(current => ({ key: column, ascending: current.key === column ? !current.ascending : true }))}>
              {t(COLUMN_KEYS[column])}{sort.key === column ? (sort.ascending ? ' ▲' : ' ▼') : ''}
            </button>
          </span>)}
          {side === 'remote' && <span role="columnheader">{t('files:pane.permissions')}</span>}
        </div>
        {parent && <div className="file-row is-parent" role="row" onDoubleClick={() => onNavigate(parent)}><span role="gridcell">..</span><span /><span /></div>}
        {entries.map(entry => {
          const folder = isDirectory(entry);
          return <div key={entry.name} role="row" data-name={entry.name} aria-selected={selected.includes(entry.name)} draggable={!disabled}
            className={`file-row${cursor === entry.name ? ' is-cursor' : ''}${dropTarget === entry.name ? ' is-drop-target' : ''}`}
            onClick={(event: MouseEvent) => select(entry.name, event)} onDoubleClick={() => open(entry)} onContextMenu={event => openMenu(event, entry.name)}
            onDragStart={event => onDragStart(event, entry.name)}
            onDragOver={folder ? event => onDragOver(event, entry.name) : undefined}
            onDrop={folder ? event => handleDrop(event, entry.name) : undefined}>
            <span role="gridcell" className="file-name" title={entry.name}>
              <span className={`file-kind${folder ? ' is-folder' : ''}`} aria-hidden="true">{folder ? '▸' : ''}</span>
              {entry.name}{entry.type === 'link' && <small> {t('files:pane.link')}</small>}
            </span>
            <span role="gridcell" className="file-size">{folder ? '' : formatSize(entry.size)}</span>
            <span role="gridcell" className="file-date">{formatDate(entry.modified)}</span>
            {side === 'remote' && <span role="gridcell" className="file-mode">{entry.permissions ?? ''}</span>}
          </div>;
        })}
        {!listing.loading && !entries.length && !listing.error && <p className="file-empty">{t('files:pane.empty')}</p>}
      </div>}
      {menu && <ContextMenu x={menu.x} y={menu.y} label={t('files:pane.menu', { title })} onClose={() => setMenu(null)} entries={[
        ...(menuFolder ? [{ kind: 'item' as const, label: t('common:actions.open'), hint: t('files:pane.enterHint'), onSelect: () => open(menuFolder) }] : []),
        ...(menuTargets.length === 1 && !menuFolder ? [
          { kind: 'item' as const, label: t('common:actions.edit'), hint: 'F4', onSelect: () => onEdit(fullPaths(menuTargets)[0], 'default') },
          { kind: 'item' as const, label: t('files:pane.editNotepad'), onSelect: () => onEdit(fullPaths(menuTargets)[0], 'notepad') },
        ] : []),
        ...(menuTargets.length ? [
          { kind: 'item' as const, label: side === 'local' ? t('files:pane.upload') : t('files:pane.download'), hint: 'F5', onSelect: () => onCopy(fullPaths(menuTargets), false) },
          { kind: 'item' as const, label: side === 'local' ? t('files:pane.uploadMove') : t('files:pane.downloadMove'), hint: 'F6', onSelect: () => onCopy(fullPaths(menuTargets), true) },
          { kind: 'separator' as const },
          { kind: 'item' as const, label: t('common:actions.rename'), hint: 'F2', disabled: menuTargets.length !== 1, onSelect: beginRename },
          { kind: 'item' as const, label: t('common:actions.delete'), hint: t('common:keys.del'), onSelect: () => onDelete(fullPaths(menuTargets), menuTargets) },
          ...(onPermissions ? [{ kind: 'item' as const, label: t('files:pane.rights'), hint: 'F9', onSelect: () => permissions(menuTargets) }] : []),
          { kind: 'separator' as const },
        ] : []),
        { kind: 'item', label: t('files:pane.newFile'), hint: `${t('common:keys.shift')}+F4`, onSelect: () => setPrompt({ kind: 'file', value: '' }) },
        { kind: 'item', label: t('files:pane.newFolder'), hint: 'F7', onSelect: () => setPrompt({ kind: 'mkdir', value: '' }) },
        { kind: 'item', label: t('files:pane.refresh'), hint: `${t('common:keys.ctrl')}+R`, onSelect: onRefresh },
        { kind: 'item', label: t('files:pane.copyPath'), onSelect: () => { void window.desktopApi.writeClipboardText(menuTargets.length === 1 ? fullPaths(menuTargets)[0] : path ?? '').catch(() => {}); } },
        ...(side === 'local' && onAutoUpload && path ? [
          { kind: 'separator' as const },
          { kind: 'item' as const, label: t('files:pane.autoUpload'), disabled: !!autoUploadHint, hint: autoUploadHint,
            onSelect: () => onAutoUpload(menuFolder ? fullPaths([menuFolder.name])[0] : path) },
        ] : []),
      ]} />}
      {toolsMenu && <ContextMenu x={toolsMenu.x} y={toolsMenu.y} label={t('files:pane.folderMenu')} onClose={() => setToolsMenu(null)} entries={[
        { kind: 'item', label: t('files:pane.newFile'), hint: `${t('common:keys.shift')}+F4`, onSelect: () => setPrompt({ kind: 'file', value: '' }) },
        { kind: 'item', label: t('files:pane.newFolder'), hint: 'F7', onSelect: () => setPrompt({ kind: 'mkdir', value: '' }) },
        ...(side === 'local' && onAutoUpload && path ? [
          { kind: 'separator' as const },
          // Always the folder shown in this pane, regardless of the selection.
          { kind: 'item' as const, label: t('files:pane.autoUpload'), disabled: !!autoUploadHint, hint: autoUploadHint, onSelect: () => onAutoUpload(path) },
        ] : []),
      ]} />}
      <footer className="file-pane-footer">
        <span>{selected.length ? (selectedBytes ? t('files:pane.selectedSize', { selected: selected.length, total: entries.length, size: formatSize(selectedBytes) })
          : t('files:pane.selected', { selected: selected.length, total: entries.length })) : t('files:transfer.entries', { count: entries.length })}</span>
        <span className="file-pane-actions">
          <button type="button" disabled={disabled || !targets().length} title={side === 'local' ? t('files:pane.copyToServer') : t('files:pane.copyToComputer')} onClick={() => onCopy(fullPaths(targets()), false)}>
            {side === 'local' ? t('files:pane.uploadButton') : t('files:pane.downloadButton')}</button>
          <button type="button" disabled={disabled || !targets().length} title={t('files:pane.renameTitle')} onClick={beginRename}>{t('common:actions.rename')}</button>
          <button type="button" disabled={disabled || !targets().length} title={t('files:pane.deleteTitle')} onClick={() => { const list = targets(); onDelete(fullPaths(list), list); }}>{t('common:actions.delete')}</button>
        </span>
      </footer>
    </section>
  );
}
