import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react';
import type { FileEntry } from '../../../shared/sftp';
import type { FileSide, SortKey, SortOrder } from '../file-browser';
import { ContextMenu } from './ContextMenu';
import { formatDate, formatSize, isDirectory, joinPath, nameError, nextSelection, parentPath, pathSegments, sortEntries } from '../file-browser';

export const FILES_MIME = 'application/x-terminus-files';
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
  /** Files dragged in: from the other side or, for the server side, from Explorer. */
  onDrop: (drag: FileDrag | { external: string[] }, targetDir: string, move: boolean) => void;
}

type Prompt = { kind: 'mkdir'; value: string; error?: string } | { kind: 'rename'; original: string; value: string; error?: string };

const columns: { key: SortKey; label: string }[] = [{ key: 'name', label: 'Name' }, { key: 'size', label: 'Größe' }, { key: 'modified', label: 'Geändert' }];

export function FilePane({ tabId, side, title, listing, active, disabled, notice, home, drives, onActivate, onNavigate, onRefresh,
  onMkdir, onRename, onDelete, onCopy, onDrop }: FilePaneProps) {
  const [sort, setSort] = useState<SortOrder>({ key: 'name', ascending: true });
  const [selected, setSelected] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const entries = useMemo(() => sortEntries(listing.entries, sort), [listing.entries, sort]);
  const names = useMemo(() => entries.map(entry => entry.name), [entries]);
  const path = listing.path;
  const parent = path ? parentPath(side, path) : null;
  const other = side === 'local' ? 'Server' : 'Computer';

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
  const open = (entry: FileEntry): void => { if (path && isDirectory(entry)) onNavigate(joinPath(side, path, entry.name)); };
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
    if (names.includes(name)) { setPrompt({ ...prompt, error: 'Ein Eintrag mit diesem Namen existiert bereits.' }); return; }
    const done = prompt.kind === 'mkdir' ? await onMkdir(joinPath(side, path, name))
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
          {drives && drives.length > 0 && <select aria-label="Laufwerk" value={drives.find(drive => path?.toUpperCase().startsWith(drive.toUpperCase())) ?? ''}
            disabled={disabled} onChange={event => onNavigate(event.target.value)}>
            {drives.map(drive => <option key={drive} value={drive}>{drive.replace(/\\$/, '')}</option>)}
          </select>}
          <button type="button" title="Übergeordneter Ordner (Rücktaste)" aria-label="Übergeordneter Ordner" disabled={disabled || !parent} onClick={() => parent && onNavigate(parent)}>↑</button>
          <button type="button" title="Basisordner" aria-label="Basisordner" disabled={disabled || !home} onClick={() => home && onNavigate(home)}>⌂</button>
          <button type="button" title="Aktualisieren (Strg+R)" aria-label="Aktualisieren" disabled={disabled || !path} onClick={onRefresh}>⟳</button>
          <button type="button" title="Neuer Ordner (F7)" disabled={disabled || !path} onClick={() => setPrompt({ kind: 'mkdir', value: '' })}>Neuer Ordner</button>
        </div>
      </header>
      <div className="file-path">
        {editingPath !== null ? <form onSubmit={event => { event.preventDefault(); const value = editingPath.trim(); setEditingPath(null); if (value) onNavigate(value); }}>
          <input autoFocus aria-label="Pfad" value={editingPath} spellCheck={false} onChange={event => setEditingPath(event.target.value)}
            onBlur={() => setEditingPath(null)} onKeyDown={event => { if (event.key === 'Escape') setEditingPath(null); }} />
        </form> : <nav aria-label="Pfad" onDoubleClick={() => path && setEditingPath(path)} title="Doppelklick: Pfad eingeben">
          {path && pathSegments(side, path).map((segment, index, all) => <span key={segment.path}>
            <button type="button" disabled={disabled || index === all.length - 1} onClick={() => onNavigate(segment.path)}>{segment.label}</button>
            {index < all.length - 1 && segment.label !== '/' && <span aria-hidden="true">{side === 'remote' ? '/' : '\\'}</span>}
          </span>)}
        </nav>}
      </div>
      {prompt && <form className="file-prompt" onSubmit={event => { event.preventDefault(); void submitPrompt(); }}>
        <label>{prompt.kind === 'mkdir' ? 'Neuer Ordner' : `„${prompt.original}“ umbenennen`}
          <input autoFocus value={prompt.value} spellCheck={false} aria-invalid={!!prompt.error || undefined}
            onFocus={event => { if (prompt.kind === 'rename') { const dot = prompt.original.lastIndexOf('.'); event.target.setSelectionRange(0, dot > 0 ? dot : prompt.original.length); } }}
            onChange={event => setPrompt({ ...prompt, value: event.target.value, error: undefined })}
            onKeyDown={event => { if (event.key === 'Escape') { setPrompt(null); listRef.current?.focus(); } }} /></label>
        <button type="submit" className="primary-button" disabled={disabled}>{prompt.kind === 'mkdir' ? 'Anlegen' : 'Umbenennen'}</button>
        <button type="button" className="secondary-button" onClick={() => setPrompt(null)}>Abbrechen</button>
        {prompt.error && <p className="field-error" role="alert">{prompt.error}</p>}
      </form>}
      {listing.error && <p className="file-error" role="alert">{listing.error}</p>}
      {notice ? <div className="file-notice"><p>{notice.text}</p>
        {notice.action && <button type="button" className="secondary-button" onClick={notice.action.run}>{notice.action.label}</button>}</div>
      : <div ref={listRef} className={`file-list${dropTarget === '' ? ' is-drop-target' : ''}`} tabIndex={0} role="grid" aria-multiselectable="true"
        aria-busy={listing.loading} aria-label={`Dateien: ${title}`} onKeyDown={onKeyDown}
        onDragOver={event => onDragOver(event)} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(null); }}
        onDrop={event => handleDrop(event)}
        onClick={event => { if (event.target === event.currentTarget) { setSelected([]); setAnchor(null); } }}
        onContextMenu={event => openMenu(event)}>
        <div className="file-row file-row-head" role="row">
          {columns.map(column => <span key={column.key} role="columnheader" aria-sort={sort.key === column.key ? (sort.ascending ? 'ascending' : 'descending') : 'none'}>
            <button type="button" tabIndex={-1} onClick={() => setSort(current => ({ key: column.key, ascending: current.key === column.key ? !current.ascending : true }))}>
              {column.label}{sort.key === column.key ? (sort.ascending ? ' ▲' : ' ▼') : ''}
            </button>
          </span>)}
          {side === 'remote' && <span role="columnheader">Rechte</span>}
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
              {entry.name}{entry.type === 'link' && <small> → Link</small>}
            </span>
            <span role="gridcell" className="file-size">{folder ? '' : formatSize(entry.size)}</span>
            <span role="gridcell" className="file-date">{formatDate(entry.modified)}</span>
            {side === 'remote' && <span role="gridcell" className="file-mode">{entry.permissions ?? ''}</span>}
          </div>;
        })}
        {!listing.loading && !entries.length && !listing.error && <p className="file-empty">Dieser Ordner ist leer.</p>}
      </div>}
      {menu && <ContextMenu x={menu.x} y={menu.y} label={`Dateiaktionen: ${title}`} onClose={() => setMenu(null)} entries={[
        ...(menuFolder ? [{ kind: 'item' as const, label: 'Öffnen', hint: 'Eingabe', onSelect: () => open(menuFolder) }] : []),
        ...(menuTargets.length ? [
          { kind: 'item' as const, label: side === 'local' ? 'Hochladen' : 'Herunterladen', hint: 'F5', onSelect: () => onCopy(fullPaths(menuTargets), false) },
          { kind: 'item' as const, label: side === 'local' ? 'Hochladen und lokal löschen' : 'Herunterladen und vom Server löschen', hint: 'F6', onSelect: () => onCopy(fullPaths(menuTargets), true) },
          { kind: 'separator' as const },
          { kind: 'item' as const, label: 'Umbenennen', hint: 'F2', disabled: menuTargets.length !== 1, onSelect: beginRename },
          { kind: 'item' as const, label: 'Löschen', hint: 'Entf', onSelect: () => onDelete(fullPaths(menuTargets), menuTargets) },
          { kind: 'separator' as const },
        ] : []),
        { kind: 'item', label: 'Neuer Ordner', hint: 'F7', onSelect: () => setPrompt({ kind: 'mkdir', value: '' }) },
        { kind: 'item', label: 'Aktualisieren', hint: 'Strg+R', onSelect: onRefresh },
        { kind: 'item', label: 'Pfad kopieren', onSelect: () => { void window.desktopApi.writeClipboardText(menuTargets.length === 1 ? fullPaths(menuTargets)[0] : path ?? '').catch(() => {}); } },
      ]} />}
      <footer className="file-pane-footer">
        <span>{selected.length ? `${selected.length} von ${entries.length} ausgewählt${selectedBytes ? ` · ${formatSize(selectedBytes)}` : ''}` : `${entries.length} Einträge`}</span>
        <span className="file-pane-actions">
          <button type="button" disabled={disabled || !targets().length} title={`Zum ${other} kopieren (F5)`} onClick={() => onCopy(fullPaths(targets()), false)}>
            {side === 'local' ? 'Hochladen →' : '← Herunterladen'}</button>
          <button type="button" disabled={disabled || !targets().length} title="Umbenennen (F2)" onClick={beginRename}>Umbenennen</button>
          <button type="button" disabled={disabled || !targets().length} title="Löschen (Entf)" onClick={() => { const list = targets(); onDelete(fullPaths(list), list); }}>Löschen</button>
        </span>
      </footer>
    </section>
  );
}
