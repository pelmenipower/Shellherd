import type { ConnectionNode, WorkspaceLayout } from '../../shared/vault/types';
import type { TerminalTab } from './terminal-tabs';
import { toTerminalConnection } from './terminal-tabs';
import { MAX_SSH_SESSIONS } from '../../shared/ssh';

export interface LivePane { type: 'pane'; id: string; tabIds: string[]; activeTabId: string | null }
export interface LiveSplit { type: 'split'; id: string; direction: 'horizontal' | 'vertical'; ratio: number; first: LiveLayout; second: LiveLayout }
export type LiveLayout = LivePane | LiveSplit;
export type DockZone = 'center' | 'left' | 'right' | 'top' | 'bottom';
export function dockZone(x: number, y: number): DockZone {
  const edges = [{ zone: 'left' as const, distance: x }, { zone: 'right' as const, distance: 1 - x },
    { zone: 'top' as const, distance: y }, { zone: 'bottom' as const, distance: 1 - y }];
  const closest = edges.reduce((best, edge) => edge.distance < best.distance ? edge : best);
  return closest.distance < 0.25 ? closest.zone : 'center';
}
export function dockTab(layout: LiveLayout, tabId: string, paneId: string, zone: DockZone, splitId: string, beforeTabId?: string | null): LiveLayout {
  const target = panes(layout).find(pane => pane.id === paneId);
  if (!target || !panes(layout).some(pane => pane.tabIds.includes(tabId))) return layout;
  if (zone === 'center') return moveTab(layout, tabId, paneId, beforeTabId);
  if (target.tabIds.length === 1 && target.tabIds[0] === tabId) return layout;
  const moved = moveTab(layout, tabId, paneId);
  // Moving the last tab out of a source pane frees a slot before the new split.
  if (panes(moved).length >= 4) return layout;
  return mapPane(moved, paneId, pane => {
    const remaining = pane.tabIds.filter(id => id !== tabId);
    const original: LivePane = { ...pane, tabIds: remaining, activeTabId: target.activeTabId && remaining.includes(target.activeTabId) ? target.activeTabId : remaining[0] ?? null };
    const added: LivePane = { type: 'pane', id: `${splitId}-pane`, tabIds: [tabId], activeTabId: tabId };
    const before = zone === 'left' || zone === 'top';
    return { type: 'split', id: splitId, direction: zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical', ratio: 0.5,
      first: before ? added : original, second: before ? original : added };
  });
}
export const emptyLayout = (): LivePane => ({ type: 'pane', id: 'root', tabIds: [], activeTabId: null });
export function panes(layout: LiveLayout): LivePane[] { return layout.type === 'pane' ? [layout] : [...panes(layout.first), ...panes(layout.second)]; }
export function splits(layout: LiveLayout): LiveSplit[] { return layout.type === 'pane' ? [] : [layout, ...splits(layout.first), ...splits(layout.second)]; }
export function mapPane(layout: LiveLayout, id: string, change: (pane: LivePane) => LiveLayout): LiveLayout {
  return layout.type === 'pane' ? layout.id === id ? change(layout) : layout
    : { ...layout, first: mapPane(layout.first, id, change), second: mapPane(layout.second, id, change) };
}
export function syncLayout(layout: LiveLayout, tabs: TerminalTab[], selected: string | null, focused: string): LiveLayout {
  const valid = new Set(tabs.map(tab => tab.id));
  const clean = (node: LiveLayout): LiveLayout => node.type === 'split'
    ? { ...node, first: clean(node.first), second: clean(node.second) }
    : { ...node, tabIds: node.tabIds.filter(id => valid.has(id)), activeTabId: node.activeTabId && valid.has(node.activeTabId) ? node.activeTabId : node.tabIds.find(id => valid.has(id)) ?? null };
  let result = clean(layout);
  // Preserve intentionally empty panes, but collapse panes emptied by a close.
  for (const pane of panes(layout)) {
    if (pane.tabIds.length && !pane.tabIds.some(id => valid.has(id))) result = mergePane(result, pane.id);
  }
  const assigned = new Set(panes(result).flatMap(pane => pane.tabIds));
  const missing = tabs.filter(tab => !assigned.has(tab.id)).map(tab => tab.id);
  const target = panes(result).find(pane => pane.id === focused)?.id ?? panes(result)[0].id;
  if (missing.length) result = mapPane(result, target, pane => ({ ...pane, tabIds: [...pane.tabIds, ...missing], activeTabId: missing.at(-1)! }));
  if (selected) {
    const owner = panes(result).find(pane => pane.tabIds.includes(selected));
    if (owner) result = mapPane(result, owner.id, pane => ({ ...pane, activeTabId: selected }));
  }
  return result;
}
export function splitPane(layout: LiveLayout, paneId: string, direction: LiveSplit['direction'], id: string): LiveLayout {
  if (panes(layout).length >= 4) return layout;
  return mapPane(layout, paneId, pane => ({ type: 'split', id, direction, ratio: 0.5,
    first: { ...pane, tabIds: pane.tabIds.filter(tab => tab !== pane.activeTabId), activeTabId: pane.tabIds.find(tab => tab !== pane.activeTabId) ?? null },
    second: { type: 'pane', id: `${id}-pane`, tabIds: pane.activeTabId ? [pane.activeTabId] : [], activeTabId: pane.activeTabId } }));
}
export function moveTab(layout: LiveLayout, tabId: string, paneId: string, beforeTabId?: string | null): LiveLayout {
  if (!panes(layout).some(pane => pane.id === paneId) || !panes(layout).some(pane => pane.tabIds.includes(tabId))) return layout;
  const source = panes(layout).find(pane => pane.tabIds.includes(tabId))!;
  const insert = (pane: LivePane): LivePane => {
    const tabIds = pane.tabIds.filter(id => id !== tabId);
    const index = beforeTabId ? tabIds.indexOf(beforeTabId) : -1;
    tabIds.splice(index < 0 ? tabIds.length : index, 0, tabId);
    return { ...pane, tabIds, activeTabId: tabId };
  };
  if (source.id === paneId) {
    if (beforeTabId === tabId || beforeTabId === undefined) return source.activeTabId === tabId ? layout : mapPane(layout, paneId, pane => ({ ...pane, activeTabId: tabId }));
    const reordered = insert(source);
    return reordered.tabIds.every((id, index) => id === source.tabIds[index]) && source.activeTabId === tabId ? layout : mapPane(layout, paneId, () => reordered);
  }
  let result = layout;
  for (const pane of panes(layout)) result = mapPane(result, pane.id, current => {
    const tabIds = current.tabIds.filter(id => id !== tabId);
    return { ...current, tabIds, activeTabId: current.activeTabId === tabId ? tabIds[0] ?? null : current.activeTabId };
  });
  result = mapPane(result, paneId, insert);
  return source.tabIds.length === 1 ? mergePane(result, source.id) : result;
}
/** Removes a tab from its pane; a pane emptied this way disappears from a split. */
export function removeTab(layout: LiveLayout, tabId: string): LiveLayout {
  const source = panes(layout).find(pane => pane.tabIds.includes(tabId));
  if (!source) return layout;
  const result = mapPane(layout, source.id, pane => {
    const tabIds = pane.tabIds.filter(id => id !== tabId);
    return { ...pane, tabIds, activeTabId: pane.activeTabId === tabId ? tabIds[0] ?? null : pane.activeTabId };
  });
  return source.tabIds.length === 1 ? detachPane(result, source.id) : result;
}
/** Removes a pane together with its tabs; the sibling takes its space. A lone root pane stays. */
export function detachPane(layout: LiveLayout, paneId: string): LiveLayout {
  if (layout.type === 'pane') return layout;
  if (layout.first.type === 'pane' && layout.first.id === paneId) return layout.second;
  if (layout.second.type === 'pane' && layout.second.id === paneId) return layout.first;
  return { ...layout, first: detachPane(layout.first, paneId), second: detachPane(layout.second, paneId) };
}
export function mergePane(layout: LiveLayout, paneId: string): LiveLayout {
  if (layout.type === 'pane') return layout;
  const removed = layout.first.type === 'pane' && layout.first.id === paneId ? layout.first
    : layout.second.type === 'pane' && layout.second.id === paneId ? layout.second : undefined;
  if (removed) {
    const sibling = removed === layout.first ? layout.second : layout.first;
    const target = panes(sibling)[0];
    return mapPane(sibling, target.id, pane => ({ ...pane, tabIds: [...pane.tabIds, ...removed.tabIds], activeTabId: pane.activeTabId ?? removed.activeTabId }));
  }
  return { ...layout, first: mergePane(layout.first, paneId), second: mergePane(layout.second, paneId) };
}
export function setRatio(layout: LiveLayout, id: string, ratio: number): LiveLayout {
  if (layout.type === 'pane' || !Number.isFinite(ratio)) return layout;
  return { ...layout, ratio: layout.id === id ? Math.max(0.1, Math.min(0.9, ratio)) : layout.ratio,
    first: setRatio(layout.first, id, ratio), second: setRatio(layout.second, id, ratio) };
}
export interface PaneRect { pane: LivePane; left: number; top: number; width: number; height: number }
export function paneRects(layout: LiveLayout, left = 0, top = 0, width = 100, height = 100): PaneRect[] {
  if (layout.type === 'pane') return [{ pane: layout, left, top, width, height }];
  const r = layout.ratio;
  return layout.direction === 'horizontal'
    ? [...paneRects(layout.first, left, top, width * r, height), ...paneRects(layout.second, left + width * r, top, width * (1-r), height)]
    : [...paneRects(layout.first, left, top, width, height * r), ...paneRects(layout.second, left, top + height * r, width, height * (1-r))];
}
export interface SplitRect { split: LiveSplit; left: number; top: number; width: number; height: number }
export function splitRects(layout: LiveLayout, left = 0, top = 0, width = 100, height = 100): SplitRect[] {
  if (layout.type === 'pane') return [];
  const current = { split: layout, left, top, width, height };
  const r = layout.ratio;
  return layout.direction === 'horizontal'
    ? [current, ...splitRects(layout.first, left, top, width * r, height), ...splitRects(layout.second, left + width * r, top, width * (1-r), height)]
    : [current, ...splitRects(layout.first, left, top, width, height * r), ...splitRects(layout.second, left, top + height * r, width, height * (1-r))];
}
/** Nominal text space, recursively accounting for nested splits. Small windows can maximize a pane. */
export function minimumLayoutSize(layout: LiveLayout): { width: number; height: number } {
  if (layout.type === 'pane') return { width: 180, height: 100 };
  const a = minimumLayoutSize(layout.first), b = minimumLayoutSize(layout.second);
  return layout.direction === 'horizontal' ? { width: a.width + b.width, height: Math.max(a.height, b.height) }
    : { width: Math.max(a.width, b.width), height: a.height + b.height };
}
export function resizeBounds(split: LiveSplit, pixels: number): { min: number; max: number } {
  const dimension = split.direction === 'horizontal' ? 'width' : 'height';
  const a = minimumLayoutSize(split.first)[dimension], b = minimumLayoutSize(split.second)[dimension];
  const scale = Math.min(1, Math.max(1, pixels) / (a + b));
  const min = Math.max(0.1, Math.min(0.9, a * scale / Math.max(1, pixels)));
  const max = Math.max(min, Math.min(0.9, 1 - b * scale / Math.max(1, pixels)));
  return { min, max };
}
export function savedLayout(layout: LiveLayout, tabs: TerminalTab[]): WorkspaceLayout {
  if (layout.type === 'split') return { type: 'split', direction: layout.direction, ratio: layout.ratio, first: savedLayout(layout.first, tabs), second: savedLayout(layout.second, tabs) };
  const connectionId = (id: string) => tabs.find(tab => tab.id === id)?.connection.id;
  const active = layout.activeTabId ? connectionId(layout.activeTabId) : undefined;
  return { type: 'pane', connectionIds: layout.tabIds.flatMap(id => connectionId(id) ? [connectionId(id)!] : []), ...(active ? { activeConnectionId: active } : {}) };
}
export function restoreLayout(saved: WorkspaceLayout, lookup: (id: string) => ConnectionNode | undefined, uuid: () => string): { layout: LiveLayout; tabs: TerminalTab[]; activeTabId: string | null } {
  const tabs: TerminalTab[] = [];
  const restore = (node: WorkspaceLayout): LiveLayout => {
    if (node.type === 'split') return { ...node, id: uuid(), first: restore(node.first), second: restore(node.second) };
    const tabIds = node.connectionIds.map(id => {
      const connection = lookup(id);
      if (!connection) throw new Error('Der Workspace verweist auf eine fehlende Verbindung.');
      if (tabs.length >= MAX_SSH_SESSIONS) throw new Error(`Ein Workspace darf höchstens ${MAX_SSH_SESSIONS} Sessions starten.`);
      const tabId = uuid();
      tabs.push({ id: tabId, connection: toTerminalConnection(connection), ordinal: tabs.filter(tab => tab.connection.id === id).length + 1, status: 'connecting' });
      return tabId;
    });
    const activeTabId = tabIds.find(id => tabs.find(tab => tab.id === id)?.connection.id === node.activeConnectionId) ?? tabIds[0] ?? null;
    return { type: 'pane', id: uuid(), tabIds, activeTabId };
  };
  const layout = restore(saved);
  if (panes(layout).length > 4) throw new Error('Ein Workspace darf höchstens vier Terminalbereiche enthalten.');
  return { layout, tabs, activeTabId: panes(layout).find(pane => pane.activeTabId)?.activeTabId ?? null };
}
