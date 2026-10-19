import { panes } from '../terminal-layout';
import { activeTabOf, activeView } from '../terminal-views';
import type { LiveView, ViewControls } from '../terminal-views';
import type { TransferTarget } from '../../../shared/windows';
import type { useTerminalLayout } from './useTerminalLayout';

/** Connects view actions with the tab selection so the selected tab always lives in the active view. */
export function useViewControls(layout: ReturnType<typeof useTerminalLayout>, select: (id: string | null) => void,
  transferView: (view: LiveView, target: TransferTarget) => Promise<boolean>): ViewControls {
  const state = layout.viewsState;
  return {
    views: state.views.map(view => ({ id: view.id, name: view.name, tabCount: panes(view.layout).reduce((count, pane) => count + pane.tabIds.length, 0) })),
    activeViewId: activeView(state).id,
    select: id => {
      const view = state.views.find(item => item.id === id);
      if (!view) return;
      layout.selectView(id);
      select(activeTabOf(view));
    },
    add: () => { layout.addView(); select(null); },
    rename: layout.renameView,
    close: id => {
      layout.closeView(id);
      if (id === state.activeViewId) select(null);
    },
    moveTab: (tabId, viewId) => { layout.moveTabToView(tabId, viewId); select(tabId); },
    transfer: (id, target) => {
      const view = state.views.find(item => item.id === id);
      if (view) void transferView(view, target);
    },
    reorder: layout.moveView,
    paneToView: paneId => {
      const pane = panes(activeView(state).layout).find(item => item.id === paneId);
      layout.paneToView(paneId);
      select(pane?.activeTabId ?? null);
    },
  };
}
