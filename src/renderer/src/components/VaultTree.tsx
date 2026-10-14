import { useCallback, useState } from 'react';
import type { ConnectionProtocol, VaultNode } from '../../../shared/vault/types';
import { searchVaultNodes } from '../vault-search';
import './navigation-ui.css';
import { ConnectionIcon } from './ConnectionIcon';
import { connectionAddress, NEW_CONNECTION_KINDS } from '../../../shared/vault/connections';
import { ContextMenu } from './ContextMenu';
import type { ContextMenuEntry } from './ContextMenu';
import { parentFolderId } from '../connection-form';

interface VaultTreeProps {
  nodes: VaultNode[];
  selectedNodeId: string | null;
  disabled: boolean;
  onSelect: (nodeId: string) => void;
  onConnect?: (nodeId: string) => void;
  onEdit?: (nodeId: string) => void;
  onRename?: (nodeId: string, name: string) => Promise<boolean>;
  /** parentId '' means the vault root. */
  onNewConnection?: (protocol: ConnectionProtocol, parentId: string) => void;
  /** Opens an SSH connection as file browser. */
  onOpenFiles?: (id: string) => void;
  onNewFolder?: (parentId: string) => void;
}
function Icon({ kind }: { kind: 'folder' | 'terminal' | 'connect' | 'edit' | 'chevron' | 'rename' }) {
  const paths = { folder: 'M3 7V5h7l2 2h9v13H3V7Z', terminal: 'm4 6 6 6-6 6m9 0h7', connect: 'm9 5 10 7-10 7V5Z', edit: 'm14 5 5 5M4 20l5-1L21 7l-5-5L4 14v6Z', chevron: 'm9 5 7 7-7 7', rename: 'M4 6h16M12 6v14M8 20h8' };
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind]} /></svg>;
}
export function VaultTree({ nodes, selectedNodeId, disabled, onSelect, onConnect, onEdit, onRename, onNewConnection, onNewFolder, onOpenFiles }: VaultTreeProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; node: VaultNode | null } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const searching = query.trim().length > 0;
  const toggle = (id: string) => setCollapsed(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const beginRename = (node: VaultNode) => {
    if (!onRename || disabled) return;
    setRenaming(node.id); setName(node.name); setError('');
  };
  const submitRename = async () => {
    if (!renaming || !onRename || saving || disabled) return;
    if (!name.trim()) { setError('Bitte einen Namen eingeben.'); return; }
    setSaving(true); setError('');
    try {
      if (await onRename(renaming, name.trim())) setRenaming(null);
      else setError('Umbenennen fehlgeschlagen. Bitte erneut versuchen.');
    } catch { setError('Umbenennen fehlgeschlagen. Bitte erneut versuchen.'); }
    finally { setSaving(false); }
  };
  const createEntries = (parentId: string, heading: string): ContextMenuEntry[] => [
    { kind: 'heading', label: heading },
    ...NEW_CONNECTION_KINDS.map((item): ContextMenuEntry => item.planned
      ? { kind: 'item', label: item.label, hint: 'geplant', disabled: true, onSelect: () => {} }
      : { kind: 'item', label: item.label, disabled: !onNewConnection, onSelect: () => onNewConnection?.(item.protocol as ConnectionProtocol, parentId) }),
    { kind: 'separator' },
    { kind: 'item', label: 'Neuer Ordner', disabled: !onNewFolder, onSelect: () => onNewFolder?.(parentId) },
  ];
  const menuEntries = (node: VaultNode | null): ContextMenuEntry[] => {
    if (!node) return createEntries('', 'Neue Verbindung');
    const edit: ContextMenuEntry[] = [
      { kind: 'item', label: 'Bearbeiten', disabled: !onEdit, onSelect: () => onEdit?.(node.id) },
      { kind: 'item', label: 'Umbenennen', hint: 'F2', disabled: !onRename, onSelect: () => beginRename(node) },
    ];
    if (node.type === 'folder') return [...createEntries(node.id, `Neue Verbindung in „${node.name}“`), { kind: 'separator' }, ...edit];
    return [{ kind: 'item', label: 'Verbinden', hint: 'Enter', disabled: !onConnect, onSelect: () => onConnect?.(node.id) },
      ...(node.protocol === 'ssh' && onOpenFiles ? [{ kind: 'item' as const, label: 'Dateien öffnen (SFTP)', onSelect: () => onOpenFiles(node.id) }] : []), ...edit,
      { kind: 'separator' }, ...createEntries(parentFolderId(nodes, node.id) ?? '', 'Neue Verbindung daneben')];
  };
  const openMenu = (x: number, y: number, node: VaultNode | null) => { if (!disabled) setMenu({ x, y, node }); };
  const renderNode = (node: VaultNode, depth: number, path?: string): React.ReactNode => <li key={node.id}>
    <div className={`vault-tree-row${selectedNodeId === node.id ? ' is-selected' : ''}`} style={{ paddingLeft: `${depth * 14}px` }}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); openMenu(event.clientX, event.clientY, node); }}>
      {node.type === 'folder' && !searching ? <button className={`tree-toggle${collapsed.has(node.id) ? '' : ' is-expanded'}`} type="button"
        aria-label={`${node.name} ${collapsed.has(node.id) ? 'aufklappen' : 'zuklappen'}`} aria-expanded={!collapsed.has(node.id)} disabled={disabled}
        onClick={() => toggle(node.id)}><Icon kind="chevron" /></button> : <span className="tree-toggle-spacer" />}
      {renaming === node.id ? <form className="tree-rename" onSubmit={event => { event.preventDefault(); void submitRename(); }}>
        <input aria-label={`${node.type === 'folder' ? 'Ordner' : 'Verbindung'} umbenennen`} autoFocus value={name} disabled={disabled || saving} aria-invalid={Boolean(error)}
          onFocus={event => event.target.select()} onChange={event => setName(event.target.value)}
          onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setRenaming(null); setError(''); } }} />
        <button type="submit" disabled={disabled || saving}>OK</button>
        <button type="button" disabled={disabled || saving} onClick={() => { setRenaming(null); setError(''); }}>Abbrechen</button>
      </form> : <>
        <button className="tree-node-button" type="button" aria-pressed={selectedNodeId === node.id} disabled={disabled}
          title={node.type === 'connection' ? `${node.name} — ${connectionAddress(node)}` : node.name}
          onClick={() => onSelect(node.id)} onDoubleClick={() => { if (node.type === 'connection') onConnect?.(node.id); else if (!searching) toggle(node.id); }}
          onKeyDown={event => {
            if (event.key === 'Enter' && node.type === 'connection' && onConnect) { event.preventDefault(); onConnect(node.id); }
            if (event.key === 'F2' && onRename) { event.preventDefault(); beginRename(node); }
            if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              openMenu(rect.left + 24, rect.bottom, node);
            }
            if (node.type === 'folder' && !searching && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
              event.preventDefault();
              if ((event.key === 'ArrowLeft') !== collapsed.has(node.id)) toggle(node.id);
            }
          }}>
          <span className="tree-node-icon">{node.type === 'folder' ? <Icon kind="folder" /> : <ConnectionIcon icon={node.icon} color={node.color} />}</span>
          <span className="tree-node-text"><span>{node.name}</span>{path && <small>{path}</small>}</span>
        </button>
        <span className="tree-row-actions">
          {node.type === 'connection' && onConnect && <button type="button" disabled={disabled} aria-label={`${node.name} verbinden`} title="Verbinden (Enter)" onClick={() => onConnect(node.id)}><Icon kind="connect" /></button>}
          {onEdit && <button type="button" disabled={disabled} aria-label={`${node.name} bearbeiten`} title="Bearbeiten" onClick={() => onEdit(node.id)}><Icon kind="edit" /></button>}
          {node.type === 'folder' && onRename && <button type="button" disabled={disabled} aria-label={`${node.name} umbenennen`} title="Umbenennen (F2)" onClick={() => beginRename(node)}><Icon kind="rename" /></button>}
        </span>
      </>}
    </div>
    {node.type === 'folder' && !searching && !collapsed.has(node.id) && node.children.length > 0 && <ul>{node.children.map(child => renderNode(child, depth + 1))}</ul>}
  </li>;
  const results = searching ? searchVaultNodes(nodes, query) : [];
  return <nav className="vault-tree" aria-label="Verbindungen und Ordner"
    onContextMenu={event => { if ((event.target as HTMLElement).closest('input')) return; event.preventDefault(); openMenu(event.clientX, event.clientY, null); }}>
    {menu && <ContextMenu x={menu.x} y={menu.y} label={menu.node ? `Aktionen für ${menu.node.name}` : 'Neu anlegen'}
      entries={menuEntries(menu.node)} onClose={closeMenu} />}
    <input className="tree-search" type="search" aria-label="Verbindungen suchen" placeholder="Verbindungen suchen …" value={query}
      onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setQuery(''); }} />
    {error && <p className="tree-error" role="alert">{error}</p>}
    {searching && results.length === 0 ? <p className="tree-empty" role="status">Keine passenden Verbindungen oder Ordner.</p>
      : <ul className="vault-tree-list">{searching ? results.map(({ node, path }) => renderNode(node, 0, path)) : nodes.map(node => renderNode(node, 0))}</ul>}
  </nav>;
}
