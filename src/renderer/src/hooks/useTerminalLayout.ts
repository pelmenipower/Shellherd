import { useCallback, useEffect, useRef, useState } from 'react';
import type { TerminalTab } from '../terminal-tabs';
import { emptyLayout, panes } from '../terminal-layout';
import type { LiveLayout } from '../terminal-layout';
import * as views from '../terminal-views';
import type { ViewsState } from '../terminal-views';

/** Layout of all views of a window; `layout` is the active view's split layout. */
export function useTerminalLayout(tabs: TerminalTab[], selected: string | null) {
  const [state, setState] = useState<ViewsState>(views.initialViews);
  const [focused, setFocused] = useState('root');
  const previousSelected = useRef<string | null>(null);
  useEffect(() => {
    const follow = selected !== previousSelected.current;
    previousSelected.current = selected;
    setState(current => views.syncViews(current, tabs, selected, focused, follow));
    // Focus changes alone must not reactivate a tab in another pane.
  }, [tabs, selected]);
  const layout = views.activeView(state).layout;
  useEffect(() => {
    if (selected) {
      const owner = panes(layout).find(pane => pane.tabIds.includes(selected));
      if (owner) setFocused(owner.id);
    }
  }, [selected]);
  // The focused pane always belongs to the active view.
  useEffect(() => { if (!panes(layout).some(pane => pane.id === focused)) setFocused(panes(layout)[0].id); }, [layout, focused]);

  const setLayout = useCallback((next: LiveLayout) => setState(current => ({ ...current,
    views: current.views.map(view => view.id === current.activeViewId ? { ...view, layout: next } : view) })), []);
  const replaceViews = useCallback((next: ViewsState) => { setState(next); setFocused(panes(views.activeView(next).layout)[0].id); }, []);
  const replace = useCallback((next: LiveLayout) => {
    const id = crypto.randomUUID();
    replaceViews({ views: [{ id, name: 'Ansicht 1', layout: next }], activeViewId: id });
  }, [replaceViews]);
  return {
    layout, setLayout, focused, setFocused, replace, replaceViews,
    reset: () => replace(emptyLayout()),
    viewsState: state,
    selectView: (id: string) => setState(current => current.views.some(view => view.id === id) ? { ...current, activeViewId: id } : current),
    addView: () => setState(current => views.addView(current, crypto.randomUUID())),
    renameView: (id: string, name: string) => setState(current => views.renameView(current, id, name)),
    closeView: (id: string) => setState(current => views.closeView(current, id)),
    moveTabToView: (tabId: string, viewId: string) => setState(current => views.moveTabToView(current, tabId, viewId)),
    paneToView: (paneId: string) => setState(current => views.paneToView(current, paneId, crypto.randomUUID())),
  };
}
