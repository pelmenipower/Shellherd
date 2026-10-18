import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ContainerRuntime, DiscoveredItem } from '../../../shared/containers';
import { itemKey, LOCAL_CONTAINER_HOST, RUNTIME_LABEL } from '../../../shared/containers';
import type { ContainerTreeProps, HostDiscovery } from '../container-tree';
import { groupItems, itemCommands, runtimeEntries } from '../container-tree';
import { ContextMenu } from './ContextMenu';
import type { ContextMenuEntry } from './ContextMenu';

interface ContainerChildrenProps extends Omit<ContainerTreeProps, 'state' | 'onExpand'> {
  hostId: string;
  /** Shown in the entry tooltips. */
  hostName: string;
  discovery: HostDiscovery | undefined;
  depth: number;
  disabled: boolean;
  onRefresh: () => void;
}

const STATE_LABEL = { running: 'läuft', paused: 'pausiert', stopped: 'gestoppt' } as const;

type MenuTarget = { x: number; y: number } & ({ item: DiscoveredItem } | { runtime: ContainerRuntime });

export function ContainerChildren({ hostId, hostName, discovery, depth, disabled, onOpen, onOpenView, onAction, onRefresh }: ContainerChildrenProps) {
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const indent = { paddingLeft: `${depth * 14 + 26}px` };
  // Right-clicks on headings and notes must not reach the tree's "Neu anlegen" menu; rows open their own.
  const wrap = (content: ReactNode) => <div className="container-children-wrap" onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>{content}</div>;
  if (!discovery || discovery.status === 'loading') return wrap(<p className="tree-empty container-note" style={indent} role="status">Suche Laufzeiten …</p>);
  if (discovery.status === 'error') return wrap(<p className="tree-error container-note" style={indent} role="alert">{discovery.message}{' '}
    <button type="button" className="link-button" disabled={disabled} onClick={onRefresh}>Erneut versuchen</button></p>);
  const runtimes = runtimeEntries(discovery.result);
  const groups = groupItems(discovery.result);
  if (!runtimes.length && !groups.length) return wrap(<p className="tree-empty container-note" style={indent}>
    {discovery.result.runtimes.includes('proxmox') ? 'Keine Proxmox-Gäste gefunden.' : 'Keine Container-Laufzeit gefunden.'}</p>);
  const guestEntries = (item: DiscoveredItem): ContextMenuEntry[] => [
    ...itemCommands(item).map((command): ContextMenuEntry => ({ kind: 'item', label: command.label,
      onSelect: () => command.run === 'shell' || command.run === 'logs' ? onOpen(hostId, item, command.run) : onAction(hostId, item, command.run, command.confirm) })),
    { kind: 'separator' },
    { kind: 'item', label: 'Aktualisieren', onSelect: onRefresh },
  ];
  const runtimeMenu = (runtime: ContainerRuntime): ContextMenuEntry[] => [
    { kind: 'item', label: `${RUNTIME_LABEL[runtime]}-Ansicht öffnen`, hint: 'neuer Tab', onSelect: () => onOpenView?.(hostId, runtime, true) },
    { kind: 'separator' },
    { kind: 'item', label: 'Aktualisieren', onSelect: onRefresh },
  ];
  const menuLabel = !menu ? '' : 'item' in menu ? `Aktionen für ${menu.item.name}` : `Aktionen für ${RUNTIME_LABEL[menu.runtime]}-Ansicht`;
  const menuEntries = !menu ? [] : 'item' in menu ? guestEntries(menu.item) : runtimeMenu(menu.runtime);
  const where = hostId === LOCAL_CONTAINER_HOST ? 'auf diesem Computer' : `von ${hostName}`;
  return wrap(<>
    {menu && <ContextMenu x={menu.x} y={menu.y} label={menuLabel} entries={menuEntries} onClose={() => setMenu(null)} />}
    <ul className="container-children" aria-busy={discovery.refreshing ?? false}>
    {discovery.refreshing && <li><p className="tree-empty container-note" style={indent} role="status">Aktualisiere …</p></li>}
    {runtimes.map(runtime => <li key={`runtime:${runtime}`}>
      <div className="vault-tree-row container-row" style={{ paddingLeft: `${depth * 14 + 14}px` }}
        onContextMenu={event => { event.preventDefault(); event.stopPropagation(); if (!disabled) setMenu({ x: event.clientX, y: event.clientY, runtime }); }}>
        <span className="tree-toggle-spacer" />
        <button className="tree-node-button" type="button" disabled={disabled || !onOpenView}
          title={`Container, Images, Volumes und Netzwerke ${where} (${RUNTIME_LABEL[runtime]})`}
          onClick={() => onOpenView?.(hostId, runtime)}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); onOpenView?.(hostId, runtime); }
            if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
              event.preventDefault();
              if (disabled) return;
              const rect = event.currentTarget.getBoundingClientRect();
              setMenu({ x: rect.left + 24, y: rect.bottom, runtime });
            }
          }}>
          <span className="container-entry-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Zm0 0 9 4.5 9-4.5M12 12v9" /></svg>
          </span>
          <span className="tree-node-text"><span>{RUNTIME_LABEL[runtime]}-Ansicht</span></span>
        </button>
      </div>
    </li>)}
    {groups.map(group => <li key={group.key}>
      <div className="container-group" style={indent}>{group.label}</div>
      {group.problem && <p className="tree-error container-note" style={{ paddingLeft: `${depth * 14 + 40}px` }}>{group.problem}</p>}
      <ul>{group.items.map(item => {
        const key = itemKey(item);
        const busy = discovery.busy.includes(key);
        const notice = discovery.notice?.key === key ? discovery.notice.message : undefined;
        // Double-click and Enter open a shell for running LXC only, never a VM console.
        const canOpen = !busy && item.state === 'running' && item.kind !== 'vm';
        const canMenu = !disabled && !busy;
        return <li key={key}>
          <div className="vault-tree-row container-row" style={{ paddingLeft: `${depth * 14 + 14}px` }}
            onContextMenu={event => { event.preventDefault(); event.stopPropagation(); if (canMenu) setMenu({ x: event.clientX, y: event.clientY, item }); }}>
            <span className="tree-toggle-spacer" />
            <button className="tree-node-button" type="button" disabled={disabled} aria-disabled={busy} aria-busy={busy}
              title={`${item.kind === 'lxc' ? 'CT' : 'VM'} ${item.vmid} — ${STATE_LABEL[item.state]}`}
              onDoubleClick={() => { if (canOpen) onOpen(hostId, item, 'shell'); }}
              onKeyDown={event => {
                if (event.key === 'Enter' && canOpen) { event.preventDefault(); onOpen(hostId, item, 'shell'); }
                if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
                  event.preventDefault();
                  if (!canMenu) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenu({ x: rect.left + 24, y: rect.bottom, item });
                }
              }}>
              <span className={`container-state is-${busy ? 'busy' : item.state}`} aria-label={busy ? 'wird ausgeführt' : STATE_LABEL[item.state]} />
              <span className="tree-node-text"><span>{`${item.vmid} ${item.name}`}</span></span>
            </button>
          </div>
          {notice && <p className="tree-error container-note" style={{ paddingLeft: `${depth * 14 + 40}px` }} role="alert">{notice}</p>}
        </li>;
      })}</ul>
    </li>)}
  </ul></>);
}
