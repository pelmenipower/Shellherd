import { useEffect, useId, useRef, useState } from 'react';
import type { VaultNode } from '../../../shared/vault/types';
import { searchVaultNodes } from '../vault-search';
import { ConnectionIcon } from './ConnectionIcon';
import { useNativeSurfaceBlock } from '../native-surface';

interface Props {
  nodes: VaultNode[];
  disabled: boolean;
  limitReached: boolean;
  paneNumber: number;
  onConnect: (id: string) => void;
}

export function ConnectionPicker({ nodes, disabled, limitReached, paneNumber, onConnect }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  useNativeSurfaceBlock(open);
  const results = searchVaultNodes(nodes, query).filter(item => item.node.type === 'connection');

  const close = () => { popover.current?.hidePopover(); };
  useEffect(() => {
    const dismiss = () => { popover.current?.hidePopover(); };
    window.addEventListener('resize', dismiss);
    return () => window.removeEventListener('resize', dismiss);
  }, []);
  useEffect(() => { if (disabled) popover.current?.hidePopover(); }, [disabled]);
  const toggle = () => {
    if (!trigger.current || !popover.current) return;
    if (popover.current.matches(':popover-open')) { close(); return; }
    const rect = trigger.current.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 16);
    const below = window.innerHeight - rect.bottom - 14;
    const above = rect.top - 14;
    const downward = below >= Math.min(320, above);
    const height = Math.min(360, downward ? below : above);
    Object.assign(popover.current.style, {
      width: `${width}px`, maxHeight: `${height}px`,
      left: `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`,
      top: downward ? `${rect.bottom + 6}px` : 'auto',
      bottom: downward ? 'auto' : `${window.innerHeight - rect.top + 6}px`,
    });
    setQuery('');
    popover.current.showPopover();
  };

  return <>
    <button ref={trigger} className="terminal-tab-add" type="button" disabled={disabled}
      aria-label={`Verbindung als Tab in Bereich ${paneNumber} hinzufügen`} title="Verbindung als Tab hinzufügen"
      aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={toggle}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
    </button>
    <div id={id} ref={popover} popover="auto" className="connection-picker" role="dialog" aria-label="Verbindung als Tab hinzufügen"
      onPointerDown={event => event.stopPropagation()}
      onToggle={event => { const shown = event.newState === 'open'; setOpen(shown); if (shown) search.current?.focus(); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); trigger.current?.focus(); return; }
        if (event.key === 'Enter' && event.target === search.current && !limitReached && results[0]) {
          event.preventDefault(); close(); onConnect(results[0].node.id); return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || (event.target === search.current && ['Home', 'End'].includes(event.key))) return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.connection-picker-option:not(:disabled)')];
        if (!buttons.length) return;
        event.preventDefault();
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : index < 0 ? event.key === 'ArrowUp' ? buttons.length - 1 : 0 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus();
      }}>
      <label className="connection-picker-search">Verbindung hinzufügen
        <input ref={search} type="search" aria-label="Verbindung für neuen Tab suchen" placeholder="Name, Host oder Ordner …"
          value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      {limitReached && <p className="connection-picker-hint" role="status">Alle 16 Sessions sind belegt. Schließe zuerst einen Tab.</p>}
      <div className="connection-picker-results">
        {results.map(({ node, path }) => node.type === 'connection' && <button className="connection-picker-option" key={node.id} type="button"
          disabled={disabled || limitReached} onClick={() => { close(); onConnect(node.id); }}
          title={`${path ? `${path} / ` : ''}${node.name} · ${node.host}:${node.port}`}>
          <span className="connection-picker-name"><ConnectionIcon icon={node.icon} color={node.color} /><span>{node.name}</span></span><small>{path ? `${path} · ` : ''}{node.username ? `${node.username}@` : ''}{node.host}:{node.port}</small>
        </button>)}
        {!results.length && <p className="connection-picker-hint" role="status">{query.trim() ? 'Keine passende Verbindung.' : 'Noch keine Verbindung gespeichert. Lege über „Neu“ eine Verbindung an.'}</p>}
      </div>
    </div>
  </>;
}
