import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { TerminalTab } from '../terminal-tabs';
import type { SshStatus } from '../../../shared/ssh';
import type { LiveLayout, DockZone, SplitRect } from '../terminal-layout';
import { dockTab, dockZone, mergePane, moveTab, paneRects, panes, resizeBounds, setRatio, splitRects, splitPane } from '../terminal-layout';
import { TerminalPanel } from './TerminalPanel';
import { RdpPanel } from './RdpPanel';
import { FilesPanel } from './FilesPanel';
import { useNativeSurfaceBlock } from '../native-surface';
import { ContextMenu } from './ContextMenu';
import { RDP_ACTION_LABELS } from '../rdp-sessions';
import { liveSessions } from '../session-registry';
import type { ExternalDragHover } from '../../../shared/windows';
import { tabLabel } from '../terminal-tabs';
import type { ViewControls } from '../terminal-views';
import { RDP_ACTIONS } from '../../../shared/rdp';
import { TerminalTabs } from './TerminalTabs';
import { ConnectionPicker } from './ConnectionPicker';
import type { VaultNode } from '../../../shared/vault/types';
import { MAX_SSH_SESSIONS } from '../../../shared/ssh';
import { searchVaultNodes } from '../vault-search';
import '../terminal-ui.css';

interface Props {
  nodes: VaultNode[]; onConnect: (connectionId: string, paneId: string) => void;
  tabs: TerminalTab[]; selected: string | null; layout: LiveLayout; focused: string; busy: boolean;
  onLayout: (layout: LiveLayout) => void; onFocus: (id: string) => void; onSelect: (id: string | null) => void;
  onStatus: (id: string, status: SshStatus) => void; onClose: (id: string) => void;
  draggedTabId: string | null; onDrag: (id: string | null) => void;
  visible?: boolean;
  /** Tab dragged from another window, in viewport coordinates. */
  externalHover?: ExternalDragHover;
  /** A tab received from another window waits to be docked at this viewport point. */
  pendingDock?: { tabId: string; x: number; y: number } | null;
  onDockHandled?: () => void;
  /** Dropped outside this window: move the tab to the window there or to a new one (screen DIP). */
  onTearOff?: (tabId: string, x: number, y: number) => void;
  /** Top-level views of this window; omitted hides the view bar. */
  viewControls?: ViewControls;
}
/** Preview area of a dock zone inside a pane region (percent of the stage). */
function zoneRect(region: { left: number; top: number; width: number; height: number }, zone: DockZone) {
  if (zone === 'left' || zone === 'right') return { ...region, width: region.width / 2, left: zone === 'left' ? region.left : region.left + region.width / 2 };
  if (zone === 'top' || zone === 'bottom') return { ...region, height: region.height / 2, top: zone === 'top' ? region.top : region.top + region.height / 2 };
  return region;
}
const outsideWindow = (x: number, y: number): boolean => x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight;
const rectangle = (region: { left: number; top: number; width: number; height: number }): CSSProperties => ({
  left: `${region.left}%`, top: `${region.top}%`, width: `${region.width}%`, height: `${region.height}%`,
});
interface DockTarget {
  paneId: string; zone: DockZone; beforeTabId?: string | null;
  marker?: { left: number; top: number };
}
export function SplitTerminalArea({ nodes, onConnect, tabs, selected, layout, focused, busy, onLayout, onFocus, onSelect, onStatus, onClose, draggedTabId, onDrag, visible = true,
  externalHover = null, pendingDock = null, onDockHandled, onTearOff, viewControls }: Props) {
  const [viewDrop, setViewDrop] = useState<string | null>(null);
  const viewDropRef = useRef<string | null>(null);
  const [renamingView, setRenamingView] = useState<{ id: string; name: string } | null>(null);
  const markViewDrop = (id: string | null): void => { viewDropRef.current = id; setViewDrop(id); };
  /** View tab under the pointer while a tab is dragged (pointer capture still allows hit-testing). */
  const viewAt = (x: number, y: number): string | null => viewControls
    ? (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-view-id]')?.dataset.viewId ?? null : null;
  type ExternalPoint = { x: number; y: number; label: string; kind?: 'tab' | 'view' };
  const external = useRef<{ frame: number; point: ExternalPoint | null } | null>(null);
  /** Reports the pointer outside this window so the window below can preview the drop; null ends it. */
  const reportExternal = (point: ExternalPoint | null): void => {
    if (!point) {
      if (external.current) { cancelAnimationFrame(external.current.frame); external.current = null; window.desktopApi.tabDragMove(null); }
      return;
    }
    if (external.current) { external.current.point = point; return; }
    const state = { frame: 0, point: point as ExternalPoint | null };
    external.current = state;
    const flush = (): void => {
      if (external.current !== state) return;
      if (state.point) window.desktopApi.tabDragMove(state.point);
      state.point = null;
      state.frame = requestAnimationFrame(flush);
    };
    flush();
  };
  const appearance = useMemo(() => new Map(searchVaultNodes(nodes, '').flatMap(({ node }) =>
    node.type === 'connection' ? [[node.id, { icon: node.icon, color: node.color }] as const] : [])), [nodes]);
  const [hover, setHover] = useState<DockTarget | null>(null);
  const [maximized, setMaximized] = useState<string | null>(null);
  const [menuPane, setMenuPane] = useState<string | null>(null);
  const [keysMenu, setKeysMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  const closeKeysMenu = useCallback(() => setKeysMenu(null), []);
  // Drop previews and pane menus are HTML; native RDP surfaces would cover them.
  const [viewDragging, setViewDragging] = useState(false);
  const [viewMenu, setViewMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const closeViewMenu = useCallback(() => setViewMenu(null), []);
  useNativeSurfaceBlock(Boolean(draggedTabId) || menuPane !== null || externalHover !== null || viewDragging);
  /**
   * Dragging a view tab: drop on another view tab to reorder, outside the window to detach the whole
   * view, or over another Terminus window to dock it there as a view. A plain click still selects.
   */
  const beginViewDrag = (view: { id: string; name: string }, event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (busy || event.button !== 0 || !event.isPrimary || !viewControls) return;
    const bar = event.currentTarget.closest<HTMLElement>('.view-bar');
    const start = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    let active = false;
    const finish = (): void => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      if (bar?.hasPointerCapture(start.pointerId)) bar.releasePointerCapture(start.pointerId);
      markViewDrop(null);
      setViewDragging(false);
    };
    const move = (moved: PointerEvent): void => {
      if (moved.pointerId !== start.pointerId) return;
      if (!active) {
        if (Math.hypot(moved.clientX - start.x, moved.clientY - start.y) < 6) return;
        active = true;
        bar?.setPointerCapture(start.pointerId);
        setViewDragging(true);
      }
      if (outsideWindow(moved.clientX, moved.clientY)) {
        markViewDrop(null);
        reportExternal({ x: moved.screenX, y: moved.screenY, label: view.name, kind: 'view' });
        return;
      }
      reportExternal(null);
      const over = viewAt(moved.clientX, moved.clientY);
      markViewDrop(over && over !== view.id ? over : null);
    };
    const up = (released: PointerEvent): void => {
      if (released.pointerId !== start.pointerId) return;
      const before = viewDropRef.current;
      finish();
      reportExternal(null);
      if (!active) return;
      if (outsideWindow(released.clientX, released.clientY)) viewControls.transfer(view.id, { kind: 'drop', x: released.screenX, y: released.screenY });
      else if (before) viewControls.reorder(view.id, before);
    };
    const cancel = (): void => { finish(); reportExternal(null); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
  };
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ tabId: string; pointerId: number; x: number; y: number; active: boolean; maximized: string | null } | null>(null);
  const [stageSize, setStageSize] = useState({ width: 1000, height: 700 });
  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(([entry]) => setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  const currentLayout = useRef(layout);
  currentLayout.current = layout;
  const paneList = panes(layout);
  const regions = paneRects(layout);
  const zoomed = maximized && paneList.some(pane => pane.id === maximized) ? maximized : null;
  const focusedPane = paneList.find(pane => pane.id === focused) ?? paneList[0];
  const shownRegions = zoomed ? regions.filter(region => region.pane.id === zoomed).map(region => ({ ...region, left: 0, top: 0, width: 100, height: 100 })) : regions;
  const cancelDrag = useCallback(() => {
    const previous = drag.current;
    drag.current = null;
    if (previous && stage.current?.hasPointerCapture(previous.pointerId)) stage.current.releasePointerCapture(previous.pointerId);
    if (previous?.active) setMaximized(previous.maximized);
    if (external.current) { cancelAnimationFrame(external.current.frame); external.current = null; window.desktopApi.tabDragMove(null); }
    viewDropRef.current = null; setViewDrop(null);
    setHover(null); onDrag(null);
  }, [onDrag]);
  useEffect(() => { if (busy || !visible) cancelDrag(); }, [busy, visible, cancelDrag]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      cancelDrag(); setMenuPane(null);
    };
    document.addEventListener('keydown', escape);
    window.addEventListener('blur', cancelDrag);
    return () => { document.removeEventListener('keydown', escape); window.removeEventListener('blur', cancelDrag); };
  }, [cancelDrag]);
  const selectTab = (paneId: string, tabId: string | null) => { onFocus(paneId); onSelect(tabId); };
  const previewLayout = hover && draggedTabId ? dockTab(layout, draggedTabId, hover.paneId, hover.zone, 'dock-preview', hover.beforeTabId) : null;
  const previewRegion = previewLayout && previewLayout !== layout && draggedTabId
    ? paneRects(previewLayout).find(region => region.pane.tabIds.includes(draggedTabId)) : undefined;
  // Capture on the stable stage, not a tab that can move to another pane.
  const beginTabDrag = (tabId: string, event: ReactPointerEvent<HTMLElement>) => {
    if (busy || event.button !== 0 || !event.isPrimary || !stage.current) return;
    event.preventDefault(); event.stopPropagation();
    document.getElementById(`tab-${tabId}`)?.focus({ preventScroll: true });
    drag.current = { tabId, pointerId: event.pointerId, x: event.clientX, y: event.clientY, active: false, maximized: zoomed };
    stage.current.setPointerCapture(event.pointerId);
  };
  const targetAt = (x: number, y: number, tabId: string): DockTarget | null => {
    if (!stage.current) return null;
    const bounds = stage.current.getBoundingClientRect();
    if (x < bounds.left || x >= bounds.right || y < bounds.top || y >= bounds.bottom) return null;
    const region = paneRects(currentLayout.current).find(item => x >= bounds.left + bounds.width * item.left / 100
      && x < bounds.left + bounds.width * (item.left + item.width) / 100 && y >= bounds.top + bounds.height * item.top / 100
      && y < bounds.top + bounds.height * (item.top + item.height) / 100);
    if (!region) return null;
    const left = bounds.left + bounds.width * region.left / 100, top = bounds.top + bounds.height * region.top / 100;
    const width = bounds.width * region.width / 100, height = bounds.height * region.height / 100;
    if (y - top < 32) {
      const chrome = [...stage.current.querySelectorAll<HTMLElement>('[data-pane-id]')].find(el => el.dataset.paneId === region.pane.id);
      const bar = chrome?.querySelector<HTMLElement>('.terminal-tab-bar');
      if (bar) {
        const rect = bar.getBoundingClientRect();
        if (x < rect.left + 24) bar.scrollLeft -= 16;
        else if (x > rect.right - 24) bar.scrollLeft += 16;
      }
      const items = [...(chrome?.querySelectorAll<HTMLElement>('.terminal-tab-item') ?? [])]
        .map(el => ({ id: el.querySelector<HTMLElement>('[data-tab-id]')?.dataset.tabId, rect: el.getBoundingClientRect() }))
        .filter(item => item.id && item.id !== tabId);
      const before = items.find(item => x < item.rect.left + item.rect.width / 2);
      const strip = bar?.getBoundingClientRect();
      const markerX = before?.rect.left ?? items.at(-1)?.rect.right ?? left + 4;
      return { paneId: region.pane.id, zone: 'center', beforeTabId: before?.id ?? null,
        marker: { left: Math.max(left + 2, Math.min(strip ? strip.right - 2 : left + width - 2, markerX)) - bounds.left, top: top - bounds.top } };
    }
    return { paneId: region.pane.id, zone: dockZone((x - left) / width, (y - top - 32) / Math.max(1, height - 32)) };
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    if (!event.buttons) { cancelDrag(); return; }
    if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
    current.active = true; setMaximized(null); setMenuPane(null); onDrag(current.tabId);
    if (onTearOff && outsideWindow(event.clientX, event.clientY)) {
      setHover(null);
      const tab = tabs.find(item => item.id === current.tabId);
      reportExternal({ x: event.screenX, y: event.screenY, label: tab ? tabLabel(tab, tabs) : '' });
      return;
    }
    reportExternal(null);
    const view = viewAt(event.clientX, event.clientY);
    markViewDrop(view);
    setHover(view ? null : targetAt(event.clientX, event.clientY, current.tabId));
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const tearOff = current.active && !busy && onTearOff && outsideWindow(event.clientX, event.clientY);
    const viewTarget = current.active && !busy && !tearOff ? viewDropRef.current : null;
    markViewDrop(null);
    const target = current.active && !busy && !tearOff && !viewTarget ? targetAt(event.clientX, event.clientY, current.tabId) : null;
    drag.current = null;
    if (stage.current?.hasPointerCapture(event.pointerId)) stage.current.releasePointerCapture(event.pointerId);
    reportExternal(null);
    setHover(null); onDrag(null);
    if (tearOff) {
      setMaximized(current.maximized);
      onTearOff(current.tabId, event.screenX, event.screenY);
    } else if (viewTarget) {
      viewControls?.moveTab(current.tabId, viewTarget);
    } else if (target) {
      const next = dockTab(currentLayout.current, current.tabId, target.paneId, target.zone, crypto.randomUUID(), target.beforeTabId);
      if (next !== currentLayout.current) onLayout(next);
      const owner = panes(next).find(pane => pane.tabIds.includes(current.tabId));
      if (owner) selectTab(owner.id, current.tabId);
    } else if (!current.active) {
      const owner = panes(currentLayout.current).find(pane => pane.tabIds.includes(current.tabId));
      if (owner) selectTab(owner.id, current.tabId);
    } else setMaximized(current.maximized);
  };
  // Dock a tab received from another window where it was dropped.
  useEffect(() => {
    if (!pendingDock || !panes(layout).some(pane => pane.tabIds.includes(pendingDock.tabId))) return;
    const target = targetAt(pendingDock.x, pendingDock.y, pendingDock.tabId);
    if (target) {
      const next = dockTab(layout, pendingDock.tabId, target.paneId, target.zone, crypto.randomUUID(), target.beforeTabId);
      if (next !== layout) onLayout(next);
      const owner = panes(next).find(pane => pane.tabIds.includes(pendingDock.tabId));
      if (owner) selectTab(owner.id, pendingDock.tabId);
    }
    onDockHandled?.();
  }, [pendingDock, layout]);
  const externalTarget = externalHover && externalHover.kind !== 'view' ? targetAt(externalHover.x, externalHover.y, '') : null;
  const externalRegion = externalTarget ? regions.find(region => region.pane.id === externalTarget.paneId) : undefined;
  const beginResize = (event: React.PointerEvent<HTMLDivElement>, region: SplitRect) => {
    if (busy || event.button !== 0 || !stage.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = stage.current.getBoundingClientRect();
    const horizontal = region.split.direction === 'horizontal';
    const start = horizontal ? origin.left + origin.width * region.left / 100 : origin.top + origin.height * region.top / 100;
    const size = horizontal ? origin.width * region.width / 100 : origin.height * region.height / 100;
    const bounds = resizeBounds(region.split, size);
    const target = event.currentTarget;
    const update = (move: PointerEvent) => {
      const ratio = ((horizontal ? move.clientX : move.clientY) - start) / size;
      onLayout(setRatio(currentLayout.current, region.split.id, Math.max(bounds.min, Math.min(bounds.max, ratio))));
    };
    const stop = () => { target.removeEventListener('pointermove', update); target.removeEventListener('pointerup', stop); target.removeEventListener('pointercancel', stop); target.removeEventListener('lostpointercapture', stop); };
    target.addEventListener('pointermove', update);
    target.addEventListener('pointerup', stop); target.addEventListener('pointercancel', stop); target.addEventListener('lostpointercapture', stop);
  };
  return <section className="split-workspace" hidden={!visible} aria-label="Terminalbereiche">
    {viewControls && <div className="view-bar" role="tablist" aria-label="Ansichten">
      {viewControls.views.map(view => {
        const active = view.id === viewControls.activeViewId;
        return <div key={view.id} data-view-id={view.id} className={`view-tab${active ? ' is-active' : ''}${viewDrop === view.id ? ' is-drop-target' : ''}`}>
          {renamingView?.id === view.id ? <input className="view-rename" aria-label="Ansicht umbenennen" autoFocus value={renamingView.name}
            onFocus={event => event.target.select()} onChange={event => setRenamingView({ id: view.id, name: event.target.value })}
            onBlur={() => { viewControls.rename(view.id, renamingView.name); setRenamingView(null); }}
            onKeyDown={event => {
              if (event.key === 'Enter') { viewControls.rename(view.id, renamingView.name); setRenamingView(null); }
              if (event.key === 'Escape') setRenamingView(null);
            }} />
            : <button type="button" role="tab" aria-selected={active} disabled={busy} title="Doppelklick oder F2 benennt die Ansicht um"
              onClick={() => viewControls.select(view.id)} onDoubleClick={() => setRenamingView({ id: view.id, name: view.name })}
              onPointerDown={event => beginViewDrag(view, event)}
              onContextMenu={event => { event.preventDefault(); if (!busy) setViewMenu({ x: event.clientX, y: event.clientY, id: view.id }); }}
              onKeyDown={event => { if (event.key === 'F2') { event.preventDefault(); setRenamingView({ id: view.id, name: view.name }); } }}>
              <span>{view.name}</span><small>{view.tabCount}</small>
            </button>}
          {viewControls.views.length > 1 && <button type="button" className="view-close" disabled={busy} aria-label={`Ansicht ${view.name} schließen`}
            title="Ansicht schließen – ihre Tabs wandern in die Nachbaransicht" onClick={() => viewControls.close(view.id)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>}
        </div>;
      })}
      <button type="button" className="view-add" disabled={busy || viewControls.views.length >= 12} aria-label="Neue Ansicht" title="Neue Ansicht" onClick={viewControls.add}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </div>}
    <div className={`split-terminal-stage${draggedTabId ? ' is-dragging-tab' : ''}`} ref={stage}
      onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag}
      onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) cancelDrag(); }}>
      {shownRegions.map((region, index) => <div key={`chrome-${region.pane.id}`} data-pane-id={region.pane.id} className={`pane-chrome${region.pane.id === focusedPane.id ? ' pane-focused' : ''}`} style={rectangle(region)}>
        <div className="pane-header" onPointerDown={event => {
          onFocus(region.pane.id);
          if (region.pane.activeTabId && !(event.target as HTMLElement).closest('button, input, select')) beginTabDrag(region.pane.activeTabId, event);
        }}>
          {region.pane.tabIds.length ? <TerminalTabs appearance={appearance} tabs={region.pane.tabIds.flatMap(id => tabs.find(tab => tab.id === id) ?? [])} allTabs={tabs}
            activeTabId={region.pane.activeTabId} showEditor={false} label={`Sessions in Bereich ${index + 1}`} disabled={busy}
            onSelect={id => selectTab(region.pane.id, id)} onClose={onClose} onTabPointerDown={beginTabDrag} />
            : <span className="empty-pane-title">Leerer Bereich</span>}
          <ConnectionPicker nodes={nodes} disabled={busy} limitReached={tabs.length >= MAX_SSH_SESSIONS} paneNumber={index + 1}
            onConnect={id => onConnect(id, region.pane.id)} />
          <span className="pane-header-spacer" />
          {tabs.find(tab => tab.id === region.pane.activeTabId)?.connection.protocol === 'rdp' && <button type="button" className="pane-action" disabled={busy}
            aria-label={`Tastenkombination an Remotedesktop in Bereich ${index + 1} senden`} title="Tastenkombinationen senden" aria-haspopup="menu"
            onClick={event => {
              const rect = event.currentTarget.getBoundingClientRect();
              setKeysMenu({ x: rect.left, y: rect.bottom + 4, tabId: region.pane.activeTabId! });
            }}>
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>
          </button>}
          {paneList.length > 1 && <button type="button" className="pane-action" disabled={busy} aria-label={zoomed ? 'Alle Bereiche anzeigen' : `Bereich ${index + 1} maximieren`}
            title={zoomed ? 'Alle Bereiche anzeigen' : 'Bereich maximieren'} onClick={() => setMaximized(zoomed ? null : region.pane.id)}>
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><path d={zoomed ? 'M8 3v5H3m18 0h-5V3M3 16h5v5m8 0v-5h5' : 'M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6'} /></svg>
          </button>}
          <button type="button" className="pane-action" disabled={busy} aria-label={`Layout für Bereich ${index + 1}`} title="Layout und Tastaturaktionen"
            aria-expanded={menuPane === region.pane.id} onClick={() => setMenuPane(menuPane === region.pane.id ? null : region.pane.id)}>
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
          </button>
        </div>
        {menuPane === region.pane.id && <div className="pane-layout-menu" role="group" aria-label="Layout per Tastatur">
          <p>Tab oder freie Titelleiste ziehen. Am Rand teilen, in der Mitte zusammenführen oder zwischen Tabs einsortieren.</p>
          {(['horizontal', 'vertical'] as const).map(direction => <button key={direction} type="button" disabled={busy || paneList.length >= 4} onClick={() => {
            const id = crypto.randomUUID(); onLayout(splitPane(layout, region.pane.id, direction, id)); onFocus(`${id}-pane`); setMenuPane(null); setMaximized(null);
          }}>{direction === 'horizontal' ? 'Nebeneinander teilen' : 'Untereinander teilen'}</button>)}
          {paneList.length > 1 && <>
            <button type="button" disabled={busy} onClick={() => { const next = mergePane(layout, region.pane.id); onLayout(next); onFocus(panes(next)[0].id); setMenuPane(null); setMaximized(null); }}>Bereich zusammenführen</button>
            {region.pane.activeTabId && <label>Aktiven Tab verschieben<select aria-label="Aktiven Tab verschieben" value={region.pane.id} disabled={busy}
              onChange={event => { onLayout(moveTab(layout, region.pane.activeTabId!, event.target.value)); selectTab(event.target.value, region.pane.activeTabId); setMenuPane(null); setMaximized(null); }}>
              {paneList.map((pane, paneIndex) => <option value={pane.id} key={pane.id}>Bereich {paneIndex + 1}</option>)}
            </select></label>}
          </>}
          {viewControls && region.pane.tabIds.length > 0 && <button type="button" disabled={busy} onClick={() => {
            setMenuPane(null); setMaximized(null); viewControls.paneToView(region.pane.id);
          }}>Als eigene Ansicht öffnen</button>}
          <p>Trennlinien ziehen oder fokussieren und mit Pfeiltasten verschieben. Tabs auf eine Ansicht oben ziehen, um sie dorthin zu verschieben.</p>
          <button type="button" onClick={() => setMenuPane(null)}>Schließen</button>
        </div>}
        {!region.pane.activeTabId && <div className="empty-pane"><p>Verbindung aus der Liste öffnen oder einen Tab hier ablegen.</p>
          <button type="button" disabled={busy} onClick={() => onFocus(region.pane.id)}>Hier verbinden</button></div>}
      </div>)}
      {/* Stable siblings: docking and maximizing must never remount a session. */}
      {tabs.map(tab => {
        const region = shownRegions.find(region => region.pane.tabIds.includes(tab.id));
        const panel = { tabId: tab.id, connection: tab.connection,
          visible: visible && region?.pane.activeTabId === tab.id, focused: region?.pane.id === focusedPane.id,
          style: region ? { ...rectangle(region), top: `calc(${region.top}% + 32px)`, height: `calc(${region.height}% - 32px)` } : undefined,
          onFocus: () => { if (region) onFocus(region.pane.id); if (selected !== tab.id) onSelect(tab.id); }, onStatusChange: onStatus,
          adopt: tab.adopt, initialStatus: tab.status };
        if (tab.connection.protocol === 'sftp') return <FilesPanel key={tab.id} {...panel} />;
        return tab.connection.protocol === 'rdp' ? <RdpPanel key={tab.id} {...panel} />
          : <TerminalPanel key={tab.id} {...panel} onClose={() => onClose(tab.id)} />;
      })}
      {!zoomed && splitRects(layout).map((region, index) => {
        const horizontal = region.split.direction === 'horizontal';
        const size = (horizontal ? stageSize.width * region.width : stageSize.height * region.height) / 100;
        const bounds = resizeBounds(region.split, size);
        return <div key={region.split.id} className={`split-handle ${horizontal ? 'split-handle-vertical' : 'split-handle-horizontal'}`} role="separator"
          aria-label={`Aufteilung ${index + 1}`} aria-orientation={horizontal ? 'vertical' : 'horizontal'}
          aria-valuemin={Math.round(bounds.min * 100)} aria-valuemax={Math.round(bounds.max * 100)} aria-valuenow={Math.round(region.split.ratio * 100)}
          tabIndex={busy ? -1 : 0} aria-disabled={busy} style={horizontal
            ? { left: `${region.left + region.width * region.split.ratio}%`, top: `${region.top}%`, height: `${region.height}%` }
            : { top: `${region.top + region.height * region.split.ratio}%`, left: `${region.left}%`, width: `${region.width}%` }}
          onPointerDown={event => beginResize(event, region)} onDoubleClick={() => { if (!busy) onLayout(setRatio(layout, region.split.id, Math.max(bounds.min, Math.min(bounds.max, .5)))); }} onKeyDown={event => {
            const decrease = horizontal ? 'ArrowLeft' : 'ArrowUp', increase = horizontal ? 'ArrowRight' : 'ArrowDown';
            if (busy || ![decrease, increase, 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const ratio = event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max
              : region.split.ratio + (event.key === increase ? 1 : -1) * (event.shiftKey ? 0.1 : 0.025);
            onLayout(setRatio(layout, region.split.id, Math.max(bounds.min, Math.min(bounds.max, ratio))));
          }} />;
      })}
      {viewMenu && viewControls && (() => {
        const view = viewControls.views.find(item => item.id === viewMenu.id);
        if (!view) return null;
        return <ContextMenu x={viewMenu.x} y={viewMenu.y} label={`Aktionen für ${view.name}`} onClose={closeViewMenu} entries={[
          { kind: 'item', label: 'In neues Fenster verschieben', disabled: view.tabCount === 0,
            onSelect: () => viewControls.transfer(view.id, { kind: 'new', x: window.screenX + 80, y: window.screenY + 80 }) },
          { kind: 'item', label: 'Umbenennen', hint: 'F2', onSelect: () => setRenamingView({ id: view.id, name: view.name }) },
          { kind: 'separator' },
          { kind: 'item', label: 'Ansicht schließen', hint: 'Tabs bleiben erhalten', disabled: viewControls.views.length < 2, onSelect: () => viewControls.close(view.id) },
        ]} />;
      })()}
      {keysMenu && <ContextMenu x={keysMenu.x} y={keysMenu.y} label="Tastenkombination senden" onClose={closeKeysMenu}
        entries={[{ kind: 'heading', label: 'An Remotedesktop senden' }, ...RDP_ACTIONS.map(action => ({ kind: 'item' as const,
          label: RDP_ACTION_LABELS[action].label, hint: RDP_ACTION_LABELS[action].hint, disabled: !liveSessions.get(keysMenu.tabId),
          onSelect: () => {
            const sessionId = liveSessions.get(keysMenu.tabId)?.sessionId;
            if (sessionId) void window.desktopApi.rdpAction({ sessionId, action }).catch(() => {});
          } }))]} />}
      {externalHover && <div className="dock-preview" style={rectangle(externalRegion
        ? zoneRect(externalRegion, externalTarget!.marker ? 'center' : externalTarget!.zone) : { left: 0, top: 0, width: 100, height: 100 })}>
        <span>{externalHover.label ? `„${externalHover.label}“ ` : ''}{externalHover.kind === 'view' ? 'als Ansicht hinzufügen'
          : externalTarget?.marker ? 'als Tab einfügen' : externalTarget && externalTarget.zone !== 'center' ? 'hier andocken' : 'hierher verschieben'}
          <small>Aus anderem Fenster</small></span>
      </div>}
      {hover && draggedTabId && <div className={`dock-preview${previewRegion ? '' : ' dock-blocked'}`} style={rectangle(previewRegion ?? regions.find(region => region.pane.id === hover.paneId) ?? regions[0])}>
        <span>{previewRegion ? hover.marker ? 'Als Tab einfügen' : hover.zone === 'center' ? 'Hierher verschieben' : 'Hier teilen' : hover.zone === 'center' ? 'Bereits an dieser Position' : 'Hier nicht teilbar'}<small>Esc zum Abbrechen</small></span>
      </div>}
      {hover?.marker && previewRegion && draggedTabId && <div className="tab-drop-marker" style={hover.marker} />}
    </div>
  </section>;
}
