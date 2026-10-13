import { describe, expect, it } from 'vitest';
import type { ConnectionNode } from '../../shared/vault/types';
import type { TerminalTab } from './terminal-tabs';
import { panes, splitPane } from './terminal-layout';
import { activeView, addView, closeView, fromWorkspaceViews, initialViews, insertView, moveTabToView, moveView, paneToView, remapLayout, removeView, renameView, restoreViews, savedViews, syncViews, toWorkspaceViews } from './terminal-views';

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

  it('inserts a received view, replacing an empty sole view, and removes sent views', () => {
    const empty = initialViews();
    const layout = { type: 'pane' as const, id: 'root', tabIds: ['x'], activeTabId: 'x' };
    const inserted = insertView(empty, 'in', 'Remote', layout);
    expect(inserted.views.map(view => view.id)).toEqual(['in']);
    const second = insertView(inserted, 'in2', 'Second', layout);
    expect(second.views.map(view => view.id)).toEqual(['in', 'in2']);
    expect(second.activeViewId).toBe('in2');
    expect(removeView(second, 'in2')).toEqual({ views: [second.views[0]], activeViewId: 'in' });
    expect(tabIds(removeView(inserted, 'in').views[0].layout)).toEqual([]);
    expect(moveView(second, 'in2', 'in').views.map(view => view.id)).toEqual(['in2', 'in']);
    expect(moveView(second, 'in2', 'missing')).toBe(second);
  });

  it('remaps tab keys of another window and keeps the split structure', () => {
    const layout = { type: 'split' as const, id: 's', direction: 'horizontal' as const, ratio: 0.3,
      first: { type: 'pane' as const, id: 'a', tabIds: ['k1', 'gone'], activeTabId: 'gone' },
      second: { type: 'pane' as const, id: 'b', tabIds: ['k2'], activeTabId: 'k2' } };
    const remapped = remapLayout(layout, new Map([['k1', 'n1'], ['k2', 'n2']]));
    expect(remapped).toEqual({ ...layout, first: { type: 'pane', id: 'a', tabIds: ['n1'], activeTabId: 'n1' }, second: { type: 'pane', id: 'b', tabIds: ['n2'], activeTabId: 'n2' } });
  });

  it('saves several views with all their tabs into a workspace and restores them', () => {
    const node: ConnectionNode = { id: 'server', type: 'connection', protocol: 'ssh', name: 'Server', host: 'h', port: 22, authentication: { method: 'agent' }, tags: [] };
    let state = syncViews(initialViews(), [tab('a'), tab('b')], 'b', 'root');
    const view = activeView(state);
    state = { ...state, views: [{ ...view, layout: splitPane(view.layout, 'root', 'vertical', 'split') }] };
    state = renameView(syncViews(addView(state, 'second'), [tab('a'), tab('b'), tab('c')], 'c', 'root'), 'second', 'Logs');
    const saved = toWorkspaceViews(state, [tab('a'), tab('b'), tab('c')]);
    expect(saved.views?.map(item => item.name)).toEqual(['Ansicht 1', 'Logs']);
    expect(saved.layout).toEqual(saved.views?.[0].layout);
    let next = 0;
    const restored = fromWorkspaceViews(saved, () => node, () => `id-${++next}`);
    expect(restored.tabs).toHaveLength(3);
    expect(restored.state.views.map(item => panes(item.layout).length)).toEqual([2, 1]);
    expect(toWorkspaceViews(restored.state, restored.tabs)).toEqual(saved);
  });
});
