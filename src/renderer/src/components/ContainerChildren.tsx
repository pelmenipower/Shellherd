import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ContainerRuntime, DiscoveredItem } from '../../../shared/containers';
import { itemKey, LOCAL_CONTAINER_HOST, RUNTIME_LABEL } from '../../../shared/containers';
import type { ContainerTreeProps, HostDiscovery } from '../container-tree';
import { groupItems, itemCommands, runtimeEntries } from '../container-tree';
import { ContextMenu } from './ContextMenu';
import { useT } from '../i18n';
import type { ContextMenuEntry } from './ContextMenu';

interface ContainerChildrenProps extends Omit<ContainerTreeProps, 'state' | 'onExpand'> {
  hostId: string;
  /** Shown in the entry tooltips. */
  hostName: string;
  discovery: HostDiscovery | undefined;
  depth: number;
  disabled: boolean;
  onRefresh: () => void;
  /** File view entry of an SSH host, always the first child; omitted for "Dieser Computer". reuse=true focuses an open file tab. */
  files?: { onOpen: (reuse: boolean) => void };
}

const STATE_LABEL_KEYS = {
  running: 'containers:tree.state.running', paused: 'containers:tree.state.paused', stopped: 'containers:tree.state.stopped',
} as const;

type MenuTarget = { x: number; y: number } & ({ item: DiscoveredItem } | { runtime: ContainerRuntime } | { files: true });

export function ContainerChildren({ hostId, hostName, discovery, depth, disabled, onOpen, onOpenView, onAction, onRefresh, files }: ContainerChildrenProps) {
  const { t } = useT();
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const indent = { paddingLeft: `${depth * 14 + 26}px` };
  // Right-clicks on headings and notes must not reach the tree's "Neu anlegen" menu; rows open their own.
  const wrap = (content: ReactNode) => <div className="container-children-wrap" onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>{content}</div>;
  const ready = discovery?.status === 'ready' ? discovery : undefined;
  const runtimes = ready ? runtimeEntries(ready.result) : [];
  const groups = ready ? groupItems(ready.result) : [];
  const guestEntries = (item: DiscoveredItem): ContextMenuEntry[] => [
    ...itemCommands(item).map((command): ContextMenuEntry => ({ kind: 'item', label: command.label,
      onSelect: () => command.run === 'shell' || command.run === 'logs' ? onOpen(hostId, item, command.run) : onAction(hostId, item, command.run, command.confirm) })),
    { kind: 'separator' },
    { kind: 'item', label: t('containers:refresh'), onSelect: onRefresh },
  ];
  const runtimeMenu = (runtime: ContainerRuntime): ContextMenuEntry[] => [
    { kind: 'item', label: t('containers:tree.openView', { runtime: RUNTIME_LABEL[runtime] }), hint: t('containers:tree.newTab'), onSelect: () => onOpenView?.(hostId, runtime, true) },
    { kind: 'separator' },
    { kind: 'item', label: t('containers:refresh'), onSelect: onRefresh },
  ];
  const filesMenu = (): ContextMenuEntry[] => [
    { kind: 'item', label: t('vault:tree.filesOpenNew'), hint: t('containers:tree.newTab'), onSelect: () => files?.onOpen(false) },
  ];
  const menuLabel = !menu ? '' : 'item' in menu ? t('containers:tree.actionsFor', { name: menu.item.name })
    : 'runtime' in menu ? t('containers:tree.actionsForView', { runtime: RUNTIME_LABEL[menu.runtime] }) : t('vault:tree.filesMenuLabel');
  const menuEntries = !menu ? [] : 'item' in menu ? guestEntries(menu.item) : 'runtime' in menu ? runtimeMenu(menu.runtime) : filesMenu();
  const filesEntry = files;
  const where = hostId === LOCAL_CONTAINER_HOST ? t('containers:tree.whereLocal') : t('containers:tree.whereHost', { host: hostName });
  return wrap(<>
    {menu && <ContextMenu x={menu.x} y={menu.y} label={menuLabel} entries={menuEntries} onClose={() => setMenu(null)} />}
    <ul className="container-children" aria-busy={!discovery || discovery.status === 'loading' || (discovery.status === 'ready' && discovery.refreshing === true)}>
    {filesEntry && <li key="files">
      <div className="vault-tree-row container-row" style={{ paddingLeft: `${depth * 14 + 14}px` }}
        onContextMenu={event => { event.preventDefault(); event.stopPropagation(); if (!disabled) setMenu({ x: event.clientX, y: event.clientY, files: true }); }}>
        <span className="tree-toggle-spacer" />
        <button className="tree-node-button" type="button" disabled={disabled}
          title={t('vault:tree.filesEntryTitle', { host: hostName })}
          onClick={() => filesEntry.onOpen(true)}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); filesEntry.onOpen(true); }
            if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
              event.preventDefault();
              if (disabled) return;
              const rect = event.currentTarget.getBoundingClientRect();
              setMenu({ x: rect.left + 24, y: rect.bottom, files: true });
            }
          }}>
          <span className="container-entry-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM12 10v6m-3-3 3 3 3-3" /></svg>
          </span>
          <span className="tree-node-text"><span>{t('vault:tree.filesEntry')}</span></span>
        </button>
      </div>
    </li>}
    {ready?.refreshing && <li><p className="tree-empty container-note" style={indent} role="status">{t('containers:tree.refreshing')}</p></li>}
    {(!discovery || discovery.status === 'loading') && <li><p className="tree-empty container-note" style={indent} role="status">{t('containers:tree.searching')}</p></li>}
    {discovery?.status === 'error' && <li><p className="tree-error container-note" style={indent} role="alert">{discovery.message}{' '}
      <button type="button" className="link-button" disabled={disabled} onClick={onRefresh}>{t('common:actions.retry')}</button></p></li>}
    {ready && !runtimes.length && !groups.length && <li><p className="tree-empty container-note" style={indent}>
      {ready.result.runtimes.includes('proxmox') ? t('containers:tree.noGuests') : t('containers:tree.noRuntime')}</p></li>}
    {runtimes.map(runtime => <li key={`runtime:${runtime}`}>
      <div className="vault-tree-row container-row" style={{ paddingLeft: `${depth * 14 + 14}px` }}
        onContextMenu={event => { event.preventDefault(); event.stopPropagation(); if (!disabled) setMenu({ x: event.clientX, y: event.clientY, runtime }); }}>
        <span className="tree-toggle-spacer" />
        <button className="tree-node-button" type="button" disabled={disabled || !onOpenView}
          title={t('containers:tree.viewTitle', { where, runtime: RUNTIME_LABEL[runtime] })}
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
          <span className="tree-node-text"><span>{t('containers:tree.viewName', { runtime: RUNTIME_LABEL[runtime] })}</span></span>
        </button>
      </div>
    </li>)}
    {groups.map(group => <li key={group.key}>
      <div className="container-group" style={indent}>{group.label}</div>
      {group.problem && <p className="tree-error container-note" style={{ paddingLeft: `${depth * 14 + 40}px` }}>{group.problem}</p>}
      <ul>{group.items.map(item => {
        const key = itemKey(item);
        const busy = (ready?.busy ?? []).includes(key);
        const notice = ready?.notice?.key === key ? ready.notice.message : undefined;
        // Double-click and Enter open a shell for running LXC only, never a VM console.
        const canOpen = !busy && item.state === 'running' && item.kind !== 'vm';
        const canMenu = !disabled && !busy;
        return <li key={key}>
          <div className="vault-tree-row container-row" style={{ paddingLeft: `${depth * 14 + 14}px` }}
            onContextMenu={event => { event.preventDefault(); event.stopPropagation(); if (canMenu) setMenu({ x: event.clientX, y: event.clientY, item }); }}>
            <span className="tree-toggle-spacer" />
            <button className="tree-node-button" type="button" disabled={disabled} aria-disabled={busy} aria-busy={busy}
              title={t('containers:tree.itemTitle', { kind: item.kind === 'lxc' ? 'CT' : 'VM', vmid: item.vmid, state: t(STATE_LABEL_KEYS[item.state]) })}
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
              <span className={`container-state is-${busy ? 'busy' : item.state}`} aria-label={busy ? t('containers:tree.busy') : t(STATE_LABEL_KEYS[item.state])} />
              <span className="tree-node-text"><span>{`${item.vmid} ${item.name}`}</span></span>
            </button>
          </div>
          {notice && <p className="tree-error container-note" style={{ paddingLeft: `${depth * 14 + 40}px` }} role="alert">{notice}</p>}
        </li>;
      })}</ul>
    </li>)}
  </ul></>);
}
