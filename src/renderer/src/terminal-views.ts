import type { ConnectionNode, Workspace, WorkspaceLayout } from '../../shared/vault/types';
import { MAX_SSH_SESSIONS } from '../../shared/ssh';
import type { TerminalTab } from './terminal-tabs';
import { sameTarget } from './terminal-tabs';
import { detachPane, emptyLayout, mapPane, panes, removeTab, restoreLayout, savedLayout, syncLayout } from './terminal-layout';
import type { LiveLayout } from './terminal-layout';
import { t } from './i18n';
import { sessionLimitNotice } from './vault-notices';

/** A top-level view: its own split layout of up to four panes. Tabs belong to exactly one view. */
export interface LiveView { id: string; name: string; layout: LiveLayout }
export interface ViewsState { views: LiveView[]; activeViewId: string }
export interface SavedView { name: string; layout: WorkspaceLayout }

/** Default view names become data; they stay in the language they were created in. */
export const defaultViewName = (index: number): string => t('terminal:views.defaultName', { index });

export const initialViews = (): ViewsState => ({ views: [{ id: 'view-1', name: defaultViewName(1), layout: emptyLayout() }], activeViewId: 'view-1' });

export function activeView(state: ViewsState): LiveView {
  return state.views.find(view => view.id === state.activeViewId) ?? state.views[0];
}

const holds = (view: LiveView, tabId: string): boolean => panes(view.layout).some(pane => pane.tabIds.includes(tabId));

export function nextViewName(state: ViewsState): string {
  for (let index = state.views.length + 1; ; index++) {
    const name = defaultViewName(index);
    if (!state.views.some(view => view.name === name)) return name;
  }
}

/**
 * Keeps every view consistent with the open tabs: closed tabs disappear, new tabs join the active
 * view, and newly selecting a tab of another view (follow) switches to that view.
 */
export function syncViews(state: ViewsState, tabs: TerminalTab[], selected: string | null, focused: string, follow = true): ViewsState {
  const assigned = new Set(state.views.flatMap(view => panes(view.layout).flatMap(pane => pane.tabIds)));
  // Only a new selection switches views; status updates must not undo a manual view switch.
  const owner = follow && selected ? state.views.find(view => holds(view, selected)) : undefined;
  const activeViewId = owner?.id ?? activeView(state).id;
  const views = state.views.map(view => {
    const own = tabs.filter(tab => holds(view, tab.id));
    const extra = view.id === activeViewId ? tabs.filter(tab => !assigned.has(tab.id)) : [];
    return { ...view, layout: syncLayout(view.layout, [...own, ...extra], selected, focused) };
  });
  return { views, activeViewId };
}

export function addView(state: ViewsState, id: string): ViewsState {
  return { views: [...state.views, { id, name: nextViewName(state), layout: emptyLayout() }], activeViewId: id };
}

export function renameView(state: ViewsState, id: string, name: string): ViewsState {
  const trimmed = name.trim();
  return trimmed ? { ...state, views: state.views.map(view => view.id === id ? { ...view, name: trimmed.slice(0, 60) } : view) } : state;
}

/** Closing a view keeps its sessions: its tabs move into the neighbouring view. */
export function closeView(state: ViewsState, id: string): ViewsState {
  const index = state.views.findIndex(view => view.id === id);
  if (index < 0 || state.views.length < 2) return state;
  const closing = state.views[index];
  const neighbour = state.views[index > 0 ? index - 1 : 1];
  const moved = panes(closing.layout).flatMap(pane => pane.tabIds);
  const target = panes(neighbour.layout)[0];
  const layout = moved.length ? mapPane(neighbour.layout, target.id, pane => ({ ...pane, tabIds: [...pane.tabIds, ...moved], activeTabId: pane.activeTabId ?? moved[0] })) : neighbour.layout;
  return {
    views: state.views.filter(view => view.id !== id).map(view => view.id === neighbour.id ? { ...view, layout } : view),
    activeViewId: state.activeViewId === id ? neighbour.id : state.activeViewId,
  };
}

export function moveTabToView(state: ViewsState, tabId: string, viewId: string): ViewsState {
  const source = state.views.find(view => holds(view, tabId));
  const target = state.views.find(view => view.id === viewId);
  if (!source || !target || source === target) return target ? { ...state, activeViewId: target.id } : state;
  const first = panes(target.layout)[0];
  return {
    views: state.views.map(view => view.id === source.id ? { ...view, layout: removeTab(view.layout, tabId) }
      : view.id === target.id ? { ...view, layout: mapPane(view.layout, first.id, pane => ({ ...pane, tabIds: [...pane.tabIds, tabId], activeTabId: tabId })) }
      : view),
    activeViewId: target.id,
  };
}

/** Lifts a pane of the active view into a new view of its own. */
export function paneToView(state: ViewsState, paneId: string, id: string): ViewsState {
  const current = activeView(state);
  const pane = panes(current.layout).find(item => item.id === paneId);
  if (!pane) return state;
  const remaining = current.layout.type === 'pane' ? emptyLayout() : detachPane(current.layout, paneId);
  return {
    views: [...state.views.map(view => view.id === current.id ? { ...view, layout: remaining } : view),
      { id, name: nextViewName(state), layout: { ...pane, id: 'root' } }],
    activeViewId: id,
  };
}

export function savedViews(state: ViewsState, tabs: TerminalTab[]): SavedView[] {
  return state.views.map(view => ({ name: view.name, layout: savedLayout(view.layout, tabs) }));
}

/** Restores several views; ordinals and the session limit apply across all of them. */
export function restoreViews(saved: SavedView[], lookup: (id: string) => ConnectionNode | undefined, uuid: () => string):
  { state: ViewsState; tabs: TerminalTab[]; activeTabId: string | null; skipped: number } {
  const tabs: TerminalTab[] = [];
  let skipped = 0;
  const views: LiveView[] = saved.map(item => {
    const restored = restoreLayout(item.layout, lookup, uuid);
    tabs.push(...restored.tabs);
    skipped += restored.skipped;
    return { id: uuid(), name: item.name, layout: restored.layout };
  });
  if (tabs.length > MAX_SSH_SESSIONS) throw new Error(sessionLimitNotice());
  for (const tab of tabs) tab.ordinal = tabs.filter(other => sameTarget(other.connection, tab.connection) && tabs.indexOf(other) <= tabs.indexOf(tab)).length;
  const state = views.length ? { views, activeViewId: views[0].id } : initialViews();
  return { state, tabs, activeTabId: panes(activeView(state).layout).find(pane => pane.activeTabId)?.activeTabId ?? null, skipped };
}

/** Workspace form: `layout` is the first view; `views` when there are several or the only one was renamed. */
export function toWorkspaceViews(state: ViewsState, tabs: TerminalTab[]): { layout: WorkspaceLayout; views?: SavedView[] } {
  const saved = savedViews(state, tabs);
  return { layout: saved[0].layout, ...(saved.length > 1 || saved[0].name !== defaultViewName(1) ? { views: saved } : {}) };
}

const countTabs = (layout: WorkspaceLayout): number => layout.type === 'split' ? countTabs(layout.first) + countTabs(layout.second) : layout.connectionIds.length;

/** Short description of what a workspace restores, e.g. `3 Ansichten · 7 Tabs · 1 Fenster`. */
export function workspaceSummary(workspace: Workspace): string {
  const windows = workspace.windows ?? [];
  const layouts = [workspace, ...windows].flatMap(item => item.views?.map(view => view.layout) ?? [item.layout]);
  const views = layouts.length;
  const tabs = layouts.reduce((total, layout) => total + countTabs(layout), 0);
  return [t('common:count.views', { count: views }), t('common:count.tabs', { count: tabs }),
    ...(windows.length ? [t('terminal:summary.moreWindows', { count: windows.length })] : [])].join(' · ');
}

export function fromWorkspaceViews(saved: { layout: WorkspaceLayout; views?: SavedView[] }, lookup: (id: string) => ConnectionNode | undefined, uuid: () => string) {
  return restoreViews(saved.views ?? [{ name: defaultViewName(1), layout: saved.layout }], lookup, uuid);
}

export const activeTabOf = (view: LiveView): string | null => panes(view.layout).find(pane => pane.activeTabId)?.activeTabId ?? null;

/** What the view bar needs; built by the window from its layout hook and tab selection. */
export interface ViewControls {
  views: { id: string; name: string; tabCount: number }[];
  activeViewId: string;
  select: (id: string) => void;
  add: () => void;
  rename: (id: string, name: string) => void;
  close: (id: string) => void;
  moveTab: (tabId: string, viewId: string) => void;
  paneToView: (paneId: string) => void;
  /** Moves a whole view with its sessions to another window. */
  transfer: (id: string, target: import('../../shared/windows').TransferTarget) => void;
  reorder: (id: string, beforeId: string) => void;
}

/** Adds a view received from another window; an empty sole view is replaced instead of kept. */
export function insertView(state: ViewsState, id: string, name: string, layout: LiveLayout): ViewsState {
  const [only] = state.views;
  const replaceEmpty = state.views.length === 1 && panes(only.layout).every(pane => pane.tabIds.length === 0);
  const view = { id, name, layout };
  return { views: replaceEmpty ? [view] : [...state.views, view], activeViewId: id };
}

/** Drops a view whose tabs left the window; the last view becomes empty instead. */
export function removeView(state: ViewsState, id: string): ViewsState {
  if (!state.views.some(view => view.id === id)) return state;
  if (state.views.length === 1) return { views: [{ ...state.views[0], layout: emptyLayout() }], activeViewId: state.views[0].id };
  const index = state.views.findIndex(view => view.id === id);
  const views = state.views.filter(view => view.id !== id);
  return { views, activeViewId: state.activeViewId === id ? views[Math.max(0, index - 1)].id : state.activeViewId };
}

/** Moves a view before another one in the view bar. */
export function moveView(state: ViewsState, id: string, beforeId: string): ViewsState {
  const moving = state.views.find(view => view.id === id);
  if (!moving || id === beforeId) return state;
  const rest = state.views.filter(view => view.id !== id);
  const index = rest.findIndex(view => view.id === beforeId);
  if (index < 0) return state;
  return { ...state, views: [...rest.slice(0, index), moving, ...rest.slice(index)] };
}

/** Replaces tab keys of another window with local tab IDs; unknown keys are dropped. */
export function remapLayout(layout: LiveLayout, ids: Map<string, string>): LiveLayout {
  if (layout.type === 'split') return { ...layout, first: remapLayout(layout.first, ids), second: remapLayout(layout.second, ids) };
  const tabIds = layout.tabIds.flatMap(key => ids.get(key) ?? []);
  const active = layout.activeTabId ? ids.get(layout.activeTabId) : undefined;
  return { ...layout, tabIds, activeTabId: active ?? tabIds[0] ?? null };
}
