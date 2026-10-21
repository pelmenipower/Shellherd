import { describe, expect, it } from 'vitest';
import { dockTab, dockZone, emptyLayout, mergePane, moveTab, paneRects, panes, restoreLayout, resizeBounds, savedLayout, setRatio, splitPane, syncLayout } from './terminal-layout';
import type { LiveLayout } from './terminal-layout';
import type { TerminalTab } from './terminal-tabs';
import type { ConnectionNode, WorkspaceLayout } from '../../shared/vault/types';
import { LOCAL_CONTAINER_HOST } from '../../shared/containers';
import { containerConnection, containerViewConnection } from './terminal-tabs';
import type { KubeViewSnapshot } from '../../shared/kubernetes';

const node: ConnectionNode = { id: 'server', type: 'connection', protocol: 'ssh', name: 'Server', host: 'example.test', port: 22,
  username: 'synthetic', authentication: { method: 'password', password: 'synthetic-secret' }, tags: [] };
const connection = { id: 'server', name: 'Server', protocol: 'ssh' as const, address: 'synthetic@example.test:22' };
const tabs: TerminalTab[] = ['a', 'b', 'c'].map((id, index) => ({ id, connection, ordinal: index + 1, status: 'connected' }));
const initial = () => syncLayout(emptyLayout(), tabs, 'c', 'root');
const ids = (layout: LiveLayout) => panes(layout).flatMap(pane => pane.tabIds).sort();
let sequence = 0;
const uuid = () => `restored-${++sequence}`;

describe('terminal layout and saved workspaces', () => {
  it('redocks two single-tab panes repeatedly and then inserts beside another tab', () => {
    const two = syncLayout(emptyLayout(), tabs.slice(0, 2), 'a', 'root');
    let layout = dockTab(two, 'b', 'root', 'right', 'side');
    layout = dockTab(layout, 'b', 'root', 'bottom', 'below');
    expect(layout).toMatchObject({ type: 'split', direction: 'vertical' });
    expect(panes(layout).map(pane => pane.tabIds)).toEqual([['a'], ['b']]);
    layout = dockTab(layout, 'b', 'root', 'left', 'left');
    expect(panes(layout).map(pane => pane.tabIds)).toEqual([['b'], ['a']]);
    layout = dockTab(layout, 'b', 'root', 'center', 'unused', 'a');
    expect(panes(layout)).toHaveLength(1);
    expect(panes(layout)[0].tabIds).toEqual(['b', 'a']);
  });
  it('reorders within a pane and moves tabs to exact positions across panes without duplicates', () => {
    const reordered = moveTab(initial(), 'c', 'root', 'a');
    expect(panes(reordered)[0].tabIds).toEqual(['c', 'a', 'b']);
    expect(moveTab(reordered, 'c', 'root', 'a')).toBe(reordered);
    const appended = moveTab(reordered, 'c', 'root', null);
    expect(panes(appended)[0].tabIds).toEqual(['a', 'b', 'c']);
    const split = dockTab(initial(), 'b', 'root', 'right', 'side');
    const merged = moveTab(split, 'b', 'root', 'c');
    expect(panes(merged)).toHaveLength(1);
    expect(panes(merged)[0]).toMatchObject({ tabIds: ['a', 'b', 'c'], activeTabId: 'b' });
    expect(ids(merged)).toEqual(['a', 'b', 'c']);
  });
  it('detects docking edges by nearest distance and keeps the center as a move target', () => {
    expect(dockZone(0.5, 0.5)).toBe('center');
    expect(dockZone(0.1, 0.5)).toBe('left');
    expect(dockZone(0.9, 0.5)).toBe('right');
    expect(dockZone(0.5, 0.1)).toBe('top');
    expect(dockZone(0.5, 0.9)).toBe('bottom');
    expect(dockZone(0.2, 0.05)).toBe('top');
  });
  it.each(['left', 'right', 'top', 'bottom'] as const)('docks a tab to the %s without changing session identities', zone => {
    const result = dockTab(initial(), 'b', 'root', zone, 'dock');
    expect(ids(result)).toEqual(['a', 'b', 'c']);
    expect(result.type).toBe('split');
    if (result.type !== 'split') return;
    expect(result.direction).toBe(zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical');
    expect(panes(result)[zone === 'left' || zone === 'top' ? 0 : 1].tabIds).toEqual(['b']);
    expect(panes(result).find(pane => pane.id === 'root')?.activeTabId).toBe('c');
  });
  it('moves between panes in the center, rejects redundant splits, and still allows moves at the pane limit', () => {
    let layout = dockTab(initial(), 'c', 'root', 'right', 'dock');
    expect(dockTab(layout, 'c', 'dock-pane', 'top', 'redundant')).toBe(layout);
    layout = dockTab(layout, 'b', 'root', 'bottom', 'second');
    layout = splitPane(layout, 'root', 'horizontal', 'third');
    const redocked = dockTab(layout, 'a', 'dock-pane', 'left', 'reused');
    expect(panes(redocked)).toHaveLength(4);
    expect(ids(redocked)).toEqual(['a', 'b', 'c']);
    const moved = dockTab(layout, 'a', 'dock-pane', 'center', 'unused');
    expect(panes(moved)).toHaveLength(3);
    expect(panes(moved).find(pane => pane.id === 'dock-pane')?.tabIds).toEqual(['c', 'a']);
    expect(ids(moved)).toEqual(['a', 'b', 'c']);
  });
  it('keeps every existing session identity when splitting, moving and merging nested panes', () => {
    let layout = splitPane(initial(), 'root', 'horizontal', 'split');
    expect(panes(layout).map(pane => pane.tabIds)).toEqual([['a', 'b'], ['c']]);
    layout = splitPane(layout, 'root', 'vertical', 'nested');
    layout = moveTab(layout, 'c', 'root');
    expect(ids(layout)).toEqual(['a', 'b', 'c']);
    expect(panes(layout).find(pane => pane.id === 'root')?.activeTabId).toBe('c');
    layout = mergePane(layout, 'root');
    expect(ids(layout)).toEqual(['a', 'b', 'c']);
    expect(panes(layout)).toHaveLength(1);
    expect(tabs.map(tab => tab.status)).toEqual(['connected', 'connected', 'connected']);
  });
  it('assigns new sessions to the focused empty pane and cleans up deleted connections', () => {
    const split = splitPane(initial(), 'root', 'horizontal', 'split');
    const empty = { ...split, type: 'split' as const, id: 'intentional', direction: 'horizontal' as const, ratio: .5,
      first: initial(), second: { ...emptyLayout(), id: 'split-pane' } };
    const newTab = { ...tabs[0], id: 'new' };
    const added = syncLayout(empty, [...tabs, newTab], 'new', 'split-pane');
    expect(panes(added)[1].tabIds).toEqual(['new']);
    const removed = syncLayout(added, [tabs[0], newTab], 'new', 'split-pane');
    expect(ids(removed)).toEqual(['a', 'new']);
    expect(panes(removed)[0].activeTabId).toBe('a');
  });
  it('caps new splits at four panes and preserves state for invalid moves', () => {
    let layout = initial();
    for (let index = 0; index < 3; index++) layout = splitPane(layout, 'root', 'horizontal', `split-${index}`);
    expect(panes(layout)).toHaveLength(4);
    expect(splitPane(layout, 'root', 'vertical', 'overflow')).toBe(layout);
    const withExtra = syncLayout(layout, [...tabs, { ...tabs[0], id: 'extra' }, { ...tabs[0], id: 'extra-2' }], 'extra', 'root');
    expect(dockTab(withExtra, 'extra', 'split-0-pane', 'left', 'overflow')).toBe(withExtra);
    expect(moveTab(layout, 'missing', 'root')).toBe(layout);
    expect(moveTab(layout, 'a', 'missing')).toBe(layout);
  });
  it('collapses a pane after closing its last tab and clamps resize bounds to available pixels', () => {
    const split = splitPane(initial(), 'root', 'horizontal', 'split');
    expect(panes(syncLayout(split, tabs.slice(0, 2), 'a', 'root'))).toHaveLength(1);
    if (split.type !== 'split') throw new Error('Expected split');
    expect(resizeBounds(split, 1000).min).toBeCloseTo(.18);
    expect(resizeBounds(split, 1000).max).toBeCloseTo(.82);
    expect(resizeBounds(split, 200)).toEqual({ min: .5, max: .5 });
  });
  it('computes nested pane geometry and clamps resize ratios', () => {
    const layout = splitPane(splitPane(initial(), 'root', 'horizontal', 'outer'), 'root', 'vertical', 'inner');
    const resized = setRatio(layout, 'outer', 0.6);
    expect(paneRects(resized).map(({ left, top, width, height }) => ({ left, top, width, height }))).toEqual([
      { left: 0, top: 0, width: 60, height: 50 }, { left: 0, top: 50, width: 60, height: 50 }, { left: 60, top: 0, width: 40, height: 100 },
    ]);
    expect(savedLayout(setRatio(layout, 'outer', 10), tabs)).toMatchObject({ ratio: 0.9 });
    expect(setRatio(layout, 'outer', NaN)).toBe(layout);
  });
  it('round trips references, duplicate sessions and proportions while generating fresh session IDs', () => {
    const original = splitPane(initial(), 'root', 'horizontal', 'split');
    const saved = savedLayout(original, tabs);
    const restored = restoreLayout(saved, () => node, uuid);
    expect(savedLayout(restored.layout, restored.tabs)).toEqual(saved);
    expect(restored.tabs).toHaveLength(3);
    expect(restored.tabs.map(tab => tab.ordinal)).toEqual([1, 2, 3]);
    expect(restored.tabs.every(tab => !['a', 'b', 'c'].includes(tab.id) && tab.status === 'connecting')).toBe(true);
    expect(JSON.stringify(restored)).not.toContain('synthetic-secret');
    expect(JSON.stringify(saved)).not.toContain('tabIds');
  });
  it('skips disabled connections and counts them instead of opening a session', () => {
    const disabled: ConnectionNode = { ...node, id: 'off', disabled: true };
    const lookup = (id: string) => id === 'off' ? disabled : node;
    const restored = restoreLayout({ type: 'pane', connectionIds: ['off', 'server', 'off'], activeConnectionId: 'off' }, lookup, uuid);
    expect(restored.tabs.map(tab => tab.connection.id)).toEqual(['server']);
    expect(restored.skipped).toBe(2);
    expect(restored.activeTabId).toBe(restored.tabs[0].id);
  });
  it('rejects missing references or layouts exceeding runtime limits before opening any session', () => {
    expect(() => restoreLayout({ type: 'pane', connectionIds: ['missing'] }, () => undefined, uuid)).toThrow('fehlende Verbindung');
    expect(() => restoreLayout({ type: 'pane', connectionIds: Array(17).fill('server') }, () => node, uuid)).toThrow('16 Sessions');
    let saved: WorkspaceLayout = { type: 'pane', connectionIds: [] };
    for (let index = 0; index < 4; index++) saved = { type: 'split', direction: 'horizontal', ratio: 0.5, first: saved, second: { type: 'pane', connectionIds: [] } };
    expect(() => restoreLayout(saved, () => node, uuid)).toThrow('vier Terminalbereiche');
  });
});

describe('workspaces with container tabs', () => {
  const host = { id: 'h1', type: 'connection', protocol: 'ssh', name: 'server01', host: 'server01', port: 22, username: 'admin', authentication: { method: 'agent' }, tags: [] } as const;
  const shell = { item: { kind: 'container' as const, runtime: 'docker' as const, ref: 'web-1', name: 'web-1' }, mode: 'shell' as const };
  it('saves remote container tabs and restores them as container tabs; drops local ones', () => {
    const tabs = [
      { id: 'a', connection: { id: 'h1', name: 'server01', protocol: 'ssh' as const, address: 'admin@server01' }, ordinal: 1, status: 'connected' as const },
      { id: 'b', connection: containerConnection('h1', 'server01', 'admin@server01', shell), ordinal: 1, status: 'connected' as const },
      { id: 'c', connection: containerConnection(LOCAL_CONTAINER_HOST, 'Dieser Computer', 'lokal', shell), ordinal: 1, status: 'connected' as const },
    ];
    const saved = savedLayout({ type: 'pane', id: 'p', tabIds: ['a', 'b', 'c'], activeTabId: 'b' }, tabs);
    expect(saved).toEqual({ type: 'pane', connectionIds: ['h1', 'h1'], activeConnectionId: 'h1', containerTabs: [{ index: 1, target: shell.item, mode: 'shell' }] });
    let n = 0;
    const restored = restoreLayout(saved, id => id === 'h1' ? host as never : undefined, () => `u${++n}`);
    expect(restored.tabs.map(tab => tab.connection.target)).toEqual([undefined, shell]);
    expect(restored.tabs[1].connection.name).toBe('web-1 @ server01');
  });
});

describe('workspaces with cluster tabs', () => {
  const cluster = { id: 'k1', type: 'connection', protocol: 'kubernetes', name: 'k8s', tags: [], accessHosts: ['h1'], kubeconfig: { source: 'auto' },
    production: true, readOnly: false, icon: 'kubernetes' } as const;
  const view: KubeViewSnapshot = { query: { kind: 'pods', namespace: 'shop' }, crumbs: ['shop'], selected: 'pods//api-1', dock: 'logs' };
  it('saves the view of cluster tabs, drops pod tabs and restores the view as initial view', () => {
    const clusterConnection = { id: 'k1', name: 'k8s', protocol: 'kubernetes' as const, address: 'k8s' };
    const podConnection = { ...clusterConnection, name: 'Logs: api-1 @ k8s', kube: { namespace: 'shop', pod: 'api-1', container: 'api', mode: 'logs' as const } };
    const tabs: TerminalTab[] = [
      { id: 'a', connection: clusterConnection, ordinal: 1, status: 'connected', kubeView: view },
      { id: 'b', connection: podConnection, ordinal: 1, status: 'connected' },
    ];
    const saved = savedLayout({ type: 'pane', id: 'p', tabIds: ['a', 'b'], activeTabId: 'b' }, tabs);
    expect(saved).toEqual({ type: 'pane', connectionIds: ['k1'], kubeTabs: [{ index: 0, view }] });
    const restored = restoreLayout(saved, id => id === 'k1' ? cluster as never : undefined, () => 'u');
    expect(restored.tabs).toHaveLength(1);
    expect(restored.tabs[0].connection).toMatchObject({ id: 'k1', name: 'k8s', protocol: 'kubernetes' });
    expect(restored.tabs[0].connection.kube).toBeUndefined();
    expect(restored.tabs[0].kubeView).toEqual(view);
  });
});

describe('workspaces with container views', () => {
  const host = { id: 'h1', type: 'connection', protocol: 'ssh', name: 'server01', host: 'server01', port: 22, username: 'admin', authentication: { method: 'agent' }, tags: [] } as const;
  const rdp = { id: 'r1', type: 'connection', protocol: 'rdp', name: 'win', host: 'win', port: 3389, username: 'a', tags: [] } as const;
  const shell = { item: { kind: 'container' as const, runtime: 'docker' as const, ref: 'web-1', name: 'web-1' }, mode: 'shell' as const };
  const tab = (id: string, connection: TerminalTab['connection']): TerminalTab => ({ id, connection, ordinal: 1, status: 'connected' });
  it('saves container views by index, drops the local one and restores them', () => {
    const tabs = [tab('a', { id: 'h1', name: 'server01', protocol: 'ssh', address: 'admin@server01' }),
      tab('b', containerViewConnection('h1', 'server01', 'admin@server01')),
      tab('c', containerViewConnection(LOCAL_CONTAINER_HOST, 'Dieser Computer', 'lokal')),
      tab('d', containerConnection('h1', 'server01', 'admin@server01', shell))];
    const saved = savedLayout({ type: 'pane', id: 'p', tabIds: ['a', 'b', 'c', 'd'], activeTabId: 'b' }, tabs);
    expect(saved).toEqual({ type: 'pane', connectionIds: ['h1', 'h1', 'h1'], activeConnectionId: 'h1', containerViews: [1],
      containerTabs: [{ index: 2, target: shell.item, mode: 'shell' }] });
    let n = 0;
    const restored = restoreLayout(saved, id => id === 'h1' ? host as never : undefined, () => `u${++n}`);
    expect(restored.tabs.map(t => t.connection.view)).toEqual([undefined, 'containers', undefined]);
    expect(restored.tabs[1].connection.name).toBe('server01 · Container');
    expect(restored.tabs[2].connection.target).toEqual(shell);
  });
  it('saves a fixed runtime as object and round-trips it', () => {
    const tabs = [tab('a', containerViewConnection('h1', 'server01', 'admin@server01', 'docker')), tab('b', containerViewConnection('h1', 'server01', 'admin@server01'))];
    const saved = savedLayout({ type: 'pane', id: 'p', tabIds: ['a', 'b'], activeTabId: 'a' }, tabs);
    expect(saved).toMatchObject({ containerViews: [{ index: 0, runtime: 'docker' }, 1] });
    const restored = restoreLayout(saved, () => host as never, () => 'u');
    expect(restored.tabs[0].connection.runtime).toBe('docker');
    expect(restored.tabs[0].connection.name).toBe('server01 · Docker');
    expect('runtime' in restored.tabs[1].connection).toBe(false);
  });
  it('restores object entries with and without runtime', () => {
    const podman = restoreLayout({ type: 'pane', connectionIds: ['h1'], containerViews: [{ index: 0, runtime: 'podman' }] }, () => host as never, () => 'u');
    expect(podman.tabs[0].connection.name).toBe('server01 · Podman');
    expect(podman.tabs[0].connection.runtime).toBe('podman');
    const bare = restoreLayout({ type: 'pane', connectionIds: ['h1'], containerViews: [0] }, () => host as never, () => 'u');
    expect(bare.tabs[0].connection.runtime).toBeUndefined();
    const obj = restoreLayout({ type: 'pane', connectionIds: ['h1'], containerViews: [{ index: 0 }] }, () => host as never, () => 'u');
    expect(obj.tabs[0].connection.name).toBe('server01 · Container');
  });
  it('falls back to a normal tab for a non-SSH connection and lets containerTabs win over containerViews', () => {
    const fallback = restoreLayout({ type: 'pane', connectionIds: ['r1'], containerViews: [0] }, id => id === 'r1' ? rdp as never : undefined, () => 'u');
    expect(fallback.tabs[0].connection.view).toBeUndefined();
    const both = restoreLayout({ type: 'pane', connectionIds: ['h1'], containerViews: [0], containerTabs: [{ index: 0, target: shell.item, mode: 'shell' }] },
      () => host as never, () => 'u');
    expect(both.tabs[0].connection.target).toEqual(shell);
    expect(both.tabs[0].connection.view).toBeUndefined();
  });
});

describe('welcome tab in workspaces', () => {
  it('is never saved', () => {
    const tabs = [
      { id: 'a', connection: { id: 'h1', name: 'server01', protocol: 'ssh' as const, address: 'admin@server01' }, ordinal: 1, status: 'connected' as const },
      { id: 'w', connection: { id: 'welcome', name: 'x', protocol: 'cmd' as const, address: '', view: 'welcome' as const }, ordinal: 1, status: 'closed' as const },
    ];
    expect(savedLayout({ type: 'pane', id: 'p', tabIds: ['a', 'w'], activeTabId: 'w' }, tabs)).toEqual({ type: 'pane', connectionIds: ['h1'] });
  });
});
