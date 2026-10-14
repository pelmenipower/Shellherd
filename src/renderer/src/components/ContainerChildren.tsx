import { useState } from 'react';
import type { DiscoveredItem } from '../../../shared/containers';
import { itemKey } from '../../../shared/containers';
import type { ContainerTreeProps, HostDiscovery } from '../container-tree';
import { groupItems, itemCommands } from '../container-tree';
import { ContextMenu } from './ContextMenu';
import type { ContextMenuEntry } from './ContextMenu';

interface ContainerChildrenProps extends Omit<ContainerTreeProps, 'state' | 'onExpand'> {
  hostId: string;
  discovery: HostDiscovery | undefined;
  depth: number;
  disabled: boolean;
  onRefresh: () => void;
}

const STATE_LABEL = { running: 'läuft', paused: 'pausiert', stopped: 'gestoppt' } as const;

export function ContainerChildren({ hostId, discovery, depth, disabled, onOpen, onAction, onRefresh }: ContainerChildrenProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; item: DiscoveredItem } | null>(null);
  const indent = { paddingLeft: `${depth * 14 + 26}px` };
  if (!discovery || discovery.status === 'loading') return <p className="tree-empty container-note" style={indent} role="status">Suche Container …</p>;
  if (discovery.status === 'error') return <p className="tree-error container-note" style={indent} role="alert">{discovery.message}{' '}
    <button type="button" className="link-button" disabled={disabled} onClick={onRefresh}>Erneut versuchen</button></p>;
  const groups = groupItems(discovery.result);
  if (!groups.length) return <p className="tree-empty container-note" style={indent}>Keine Container gefunden.</p>;
  const entries = (item: DiscoveredItem): ContextMenuEntry[] => [
    ...itemCommands(item).map((command): ContextMenuEntry => ({ kind: 'item', label: command.label,
      onSelect: () => command.run === 'shell' || command.run === 'logs' ? onOpen(hostId, item, command.run) : onAction(hostId, item, command.run, command.confirm) })),
    { kind: 'separator' },
    { kind: 'item', label: 'Aktualisieren', onSelect: onRefresh },
  ];
  return <ul className="container-children" aria-busy={discovery.refreshing ?? false}>
    {menu && <ContextMenu x={menu.x} y={menu.y} label={`Aktionen für ${menu.item.name}`} entries={entries(menu.item)} onClose={() => setMenu(null)} />}
    {discovery.refreshing && <li><p className="tree-empty container-note" style={indent} role="status">Aktualisiere …</p></li>}
    {groups.map(group => <li key={group.key}>
      <div className="container-group" style={indent}>{group.label}</div>
      {group.problem && <p className="tree-error container-note" style={{ paddingLeft: `${depth * 14 + 40}px` }}>{group.problem}</p>}
      <ul>{group.items.map(item => {
        const key = itemKey(item);
        const busy = discovery.busy.includes(key);
        const notice = discovery.notice?.key === key ? discovery.notice.message : undefined;
        const canOpen = item.state === 'running';
        return <li key={key}>
          <div className="vault-tree-row container-row" style={{ paddingLeft: `${depth * 14 + 14}px` }}
            onContextMenu={event => { event.preventDefault(); event.stopPropagation(); if (!disabled) setMenu({ x: event.clientX, y: event.clientY, item }); }}>
            <span className="tree-toggle-spacer" />
            <button className="tree-node-button" type="button" disabled={disabled || busy} aria-busy={busy}
              title={item.kind === 'container' ? `${item.name} — ${item.image} (${STATE_LABEL[item.state]})` : `${item.kind === 'lxc' ? 'CT' : 'VM'} ${item.vmid} — ${STATE_LABEL[item.state]}`}
              onDoubleClick={() => { if (canOpen) onOpen(hostId, item, 'shell'); }}
              onKeyDown={event => {
                if (event.key === 'Enter' && canOpen) { event.preventDefault(); onOpen(hostId, item, 'shell'); }
                if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenu({ x: rect.left + 24, y: rect.bottom, item });
                }
              }}>
              <span className={`container-state is-${busy ? 'busy' : item.state}`} aria-label={busy ? 'wird ausgeführt' : STATE_LABEL[item.state]} />
              <span className="tree-node-text"><span>{item.kind === 'container' ? item.name : `${item.vmid} ${item.name}`}</span></span>
            </button>
          </div>
          {notice && <p className="tree-error container-note" style={{ paddingLeft: `${depth * 14 + 40}px` }} role="alert">{notice}</p>}
        </li>;
      })}</ul>
    </li>)}
  </ul>;
}
