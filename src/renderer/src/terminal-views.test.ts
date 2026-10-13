import { describe, expect, it } from 'vitest';
import type { ConnectionNode } from '../../shared/vault/types';
import type { TerminalTab } from './terminal-tabs';
import { panes, splitPane } from './terminal-layout';
import { activeView, addView, closeView, initialViews, moveTabToView, paneToView, renameView, restoreViews, savedViews, syncViews } from './terminal-views';

const connection = { id: 'server', name: 'Server', protocol: 'ssh' as const, address: 'h:22' };
const tab = (id: string): TerminalTab => ({ id, connection, ordinal: 1, status: 'connected' });
const tabIds = (layout: ReturnType<typeof activeView>['layout']) => panes(layout).flatMap(pane => pane.tabIds);

describe('terminal views', () => {
  it('puts new tabs into the active view only', () => {
    let state = syncViews(initialViews(), [tab('a')], 'a', 'root');
    state = addView(state, 'second');
    state = syncViews(state, [tab('a'), tab('b')], 'b', 'root');
    expect(tabIds(state.views[0].layout)).toEqual(['a']);
    expect(tabIds(state.views[1].layout)).toEqual(['b']);
    expect(state.activeViewId).toBe('second');
  });

  it('switches to the view of a selected tab and drops closed tabs everywhere', () => {
    let state = syncViews(initialViews(), [tab('a')], 'a', 'root');
    state = syncViews(addView(state, 'second'), [tab('a'), tab('b')], 'b', 'root');
    expect(syncViews(state, [tab('a'), tab('b')], 'a', 'root').activeViewId).toBe('view-1');
    expect(tabIds(syncViews(state, [tab('b')], 'b', 'root').views[0].layout)).toEqual([]);
  });

  it('moves a tab into another view and lifts a pane into a new view without losing tabs', () => {
    let state = syncViews(initialViews(), [tab('a'), tab('b')], 'b', 'root');
    const view = activeView(state);
    state = { ...state, views: [{ ...view, layout: splitPane(view.layout, 'root', 'horizontal', 'split') }] };
    const lifted = paneToView(state, 'split-pane', 'lifted');
    expect(lifted.views).toHaveLength(2);
    expect(tabIds(lifted.views[0].layout)).toEqual(['a']);
    expect(tabIds(lifted.views[1].layout)).toEqual(['b']);
    expect(lifted.activeViewId).toBe('lifted');
    const moved = moveTabToView(lifted, 'a', 'lifted');
    expect(tabIds(moved.views[1].layout).sort()).toEqual(['a', 'b']);
    expect(tabIds(moved.views[0].layout)).toEqual([]);
  });

  it('closing a view hands its tabs to the neighbour; the last view stays', () => {
    let state = syncViews(initialViews(), [tab('a')], 'a', 'root');
    state = syncViews(addView(state, 'second'), [tab('a'), tab('b')], 'b', 'root');
    const closed = closeView(state, 'second');
    expect(closed.views.map(view => view.id)).toEqual(['view-1']);
    expect(tabIds(closed.views[0].layout)).toEqual(['a', 'b']);
    expect(closeView(closed, 'view-1')).toBe(closed);
    expect(renameView(closed, 'view-1', '  Server  ').views[0].name).toBe('Server');
    expect(renameView(closed, 'view-1', ' ')).toBe(closed);
  });

  it('round-trips views through a workspace with fresh IDs and shared ordinals', () => {
    const node: ConnectionNode = { id: 'server', type: 'connection', protocol: 'ssh', name: 'Server', host: 'h', port: 22, authentication: { method: 'agent' }, tags: [] };
    let state = syncViews(initialViews(), [tab('a')], 'a', 'root');
    state = renameView(syncViews(addView(state, 'second'), [tab('a'), tab('b')], 'b', 'root'), 'second', 'Datenbanken');
    let next = 0;
    const restored = restoreViews(savedViews(state, [tab('a'), tab('b')]), () => node, () => `id-${++next}`);
    expect(restored.state.views.map(view => view.name)).toEqual(['Ansicht 1', 'Datenbanken']);
    expect(restored.tabs.map(item => item.ordinal)).toEqual([1, 2]);
    expect(() => restoreViews(Array(17).fill({ name: 'x', layout: { type: 'pane', connectionIds: ['server'] } }), () => node, () => `id-${++next}`)).toThrow('16 Sessions');
  });
});
