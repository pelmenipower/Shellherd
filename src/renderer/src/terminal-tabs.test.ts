import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from './i18n';
import { MAX_SSH_SESSIONS } from '../../shared/ssh';
import { LOCAL_CONTAINER_HOST } from '../../shared/containers';
import { containerConnection, containerTabName, containerViewConnection, emptyTerminalTabs, isRunning, kubeTabName, planContainerView, reusableTab, sameTarget, shellOf, tabLabel, isWelcomeTab, welcomeConnection, WELCOME_HOST, terminalTabsReducer as reduce, toTerminalConnection } from './terminal-tabs';
import type { TerminalTab, TerminalTabsState } from './terminal-tabs';
const connection = { id: 'ssh', name: 'Server', protocol: 'ssh' as const, address: 'synthetic@example.test:22' };
function opened(): TerminalTabsState {
  return reduce(reduce(emptyTerminalTabs, { type: 'open', id: 'first', connection }), { type: 'open', id: 'second', connection });
}

describe('terminal tab lifecycle', () => {
  it('opens distinct sessions for the same connection and retains their identity when switching to the editor', () => {
    const state = opened();
    expect(state.tabs.map(tab => tab.id)).toEqual(['first', 'second']);
    expect(state.tabs.map(tab => tabLabel(tab, state.tabs))).toEqual(['Server (1)', 'Server (2)']);
    const editor = reduce(state, { type: 'select', id: null });
    expect(editor.tabs).toBe(state.tabs);
    expect(editor.activeTabId).toBeNull();
    expect(reduce(editor, { type: 'select', id: 'first' }).tabs[0]).toBe(state.tabs[0]);
  });
  it('keeps status updates isolated and ignores late updates for removed tabs', () => {
    const state = opened();
    const updated = reduce(state, { type: 'status', id: 'first', status: 'error' });
    expect(isRunning(updated.tabs[0])).toBe(false);
    expect(isRunning(updated.tabs[1])).toBe(true);
    expect(updated.tabs[1]).toBe(state.tabs[1]);
    const closed = reduce(updated, { type: 'close', id: 'first' });
    expect(reduce(closed, { type: 'status', id: 'first', status: 'connected' })).toBe(closed);
  });
  it('selects the adjacent tab when closing the active tab and preserves an active editor', () => {
    const state = opened();
    const first = reduce(state, { type: 'close', id: 'second' });
    expect(first.activeTabId).toBe('first');
    expect(reduce(first, { type: 'close', id: 'first' })).toEqual(emptyTerminalTabs);
    expect(reduce(reduce(state, { type: 'select', id: null }), { type: 'close', id: 'second' }).activeTabId).toBeNull();
  });
  it('removes sessions whose connections were deleted while preserving unrelated sessions', () => {
    const state = reduce(opened(), { type: 'open', id: 'other', connection: { ...connection, id: 'other-connection' } });
    const selected = reduce(state, { type: 'select', id: 'first' });
    const retained = reduce(selected, { type: 'retainConnections', connectionIds: ['other-connection'] });
    expect(retained.tabs.map(tab => tab.id)).toEqual(['other']);
    expect(retained.activeTabId).toBe('other');
  });
  it('caps tab count, rejects duplicate IDs and never stores credentials in tab metadata', () => {
    const withSecrets = { ...connection, authentication: { method: 'password' as const, password: 'synthetic-secret' } } as typeof connection;
    let state = reduce(emptyTerminalTabs, { type: 'open', id: 'first', connection: withSecrets });
    expect(JSON.stringify(state)).not.toContain('synthetic-secret');
    expect(reduce(state, { type: 'open', id: 'first', connection })).toBe(state);
    for (let index = 1; index < MAX_SSH_SESSIONS; index++) state = reduce(state, { type: 'open', id: String(index), connection });
    expect(reduce(state, { type: 'open', id: 'overflow', connection })).toBe(state);
    expect(reduce(state, { type: 'select', id: 'unknown' })).toBe(state);
    expect(reduce(state, { type: 'reset' })).toEqual(emptyTerminalTabs);
  });
  it('builds tab metadata per protocol without credentials', () => {
    expect(toTerminalConnection({ id: 'r', type: 'connection', protocol: 'rdp', name: 'Desk', host: 'h', port: 3389, username: 'D\\u',
      password: 'synthetic-secret', rdp: { clipboard: true }, tags: [] })).toEqual({ id: 'r', name: 'Desk', protocol: 'rdp', address: 'D\\u@h:3389' });
    expect(toTerminalConnection({ id: 'p', type: 'connection', protocol: 'powershell', name: 'PS', tags: [] }))
      .toEqual({ id: 'p', name: 'PS', protocol: 'powershell', address: 'Lokal · PowerShell' });
  });
  it('renames a tab without touching its ordinal; an empty name restores the default label', () => {
    const before = opened();
    const state = reduce(before, { type: 'rename', id: 'second', title: ' Logs ' });
    expect(state.tabs.map(tab => tabLabel(tab, state.tabs))).toEqual(['Server (1)', 'Logs']);
    expect(state.tabs[1].ordinal).toBe(2);
    expect(state.tabs[0]).toBe(before.tabs[0]);
    const cleared = reduce(state, { type: 'rename', id: 'second', title: '  ' });
    expect(tabLabel(cleared.tabs[1], cleared.tabs)).toBe('Server (2)');
    expect(reduce(state, { type: 'rename', id: 'missing', title: 'x' })).toBe(state);
    const adopted = reduce(state, { type: 'adopt', id: 'moved', connection: { ...connection, title: 'Deploy' }, status: 'connected', adopt: {} });
    expect(tabLabel(adopted.tabs.at(-1)!, adopted.tabs)).toBe('Deploy');
  });
  it('adopts tabs from other windows with their status and session', () => {
    const state = reduce(opened(), { type: 'adopt', id: 'moved', connection, status: 'connected',
      adopt: { session: { kind: 'terminal', sessionId: 'synthetic' }, snapshot: 'screen' } });
    expect(state.activeTabId).toBe('moved');
    expect(state.tabs.at(-1)).toMatchObject({ id: 'moved', status: 'connected', ordinal: 3, adopt: { snapshot: 'screen' } });
    expect(reduce(state, { type: 'adopt', id: 'moved', connection, status: 'closed', adopt: {} })).toBe(state);
  });
});

const shell = { item: { kind: 'container' as const, runtime: 'docker' as const, ref: 'web-1', name: 'web-1' }, mode: 'shell' as const };

describe('container tabs', () => {
  it('names tabs after the container and the host', () => {
    expect(containerTabName(shell, 'server01')).toBe('web-1 @ server01');
    expect(containerTabName({ ...shell, mode: 'logs' }, 'server01')).toBe('Logs: web-1 @ server01');
    expect(containerTabName({ item: { kind: 'lxc', vmid: 101, name: 'ct-web' }, mode: 'shell' }, 'pve1')).toBe('CT 101 ct-web @ pve1');
    expect(containerTabName({ item: { kind: 'vm', vmid: 100, name: 'win11' }, mode: 'shell' }, 'pve1')).toBe('VM 100 win11 @ pve1');
  });
  it('keeps the target when opening and tells targets apart', () => {
    const tab = containerConnection('h1', 'server01', 'admin@server01', shell);
    const state = reduce(emptyTerminalTabs, { type: 'open', id: 't1', connection: tab });
    expect(state.tabs[0].connection.target).toEqual(shell);
    expect(sameTarget(tab, containerConnection('h1', 'server01', 'admin@server01', { ...shell, mode: 'logs' }))).toBe(false);
    expect(sameTarget(tab, { id: 'h1', name: 'server01', protocol: 'ssh', address: 'admin@server01' })).toBe(false);
  });
  it('keeps local container tabs when the vault changes', () => {
    const local = containerConnection(LOCAL_CONTAINER_HOST, 'Dieser Computer', 'lokal', shell);
    let state = reduce(emptyTerminalTabs, { type: 'open', id: 't1', connection: local });
    state = reduce(state, { type: 'retainConnections', connectionIds: [] });
    expect(state.tabs).toHaveLength(1);
  });
  it('treats container tabs as POSIX shells, also on this computer', () => {
    const tab = (connection: TerminalTab['connection']): TerminalTab => ({ id: 't', connection, ordinal: 1, status: 'connected' });
    expect(shellOf(tab(containerConnection(LOCAL_CONTAINER_HOST, 'Dieser Computer', 'lokal', shell)))).toBe('ssh');
    expect(shellOf(tab(containerConnection('h1', 'server01', 'admin@server01', shell)))).toBe('ssh');
    expect(shellOf(tab({ id: 'c', name: 'CMD', protocol: 'cmd', address: 'lokal' }))).toBe('cmd');
    expect(shellOf(tab({ id: 'p', name: 'PS', protocol: 'powershell', address: 'lokal' }))).toBe('powershell');
    expect(shellOf(tab({ id: 's', name: 'Dateien', protocol: 'sftp', address: 'x', view: 'files' }))).toBeNull();
    expect(shellOf(undefined)).toBeNull();
  });
});

describe('kubernetes tabs', () => {
  const cluster = { id: 'k1', name: 'k8s', protocol: 'kubernetes' as const, address: 'k8s' };
  const logs = { namespace: 'shop', pod: 'api-1', container: 'api', mode: 'logs' as const };
  const tab = (connection: TerminalTab['connection']): TerminalTab => ({ id: 't', connection, ordinal: 1, status: 'connected' });
  it('keeps the pod target when opening and adopting tabs, and tells apart tabs with different targets', () => {
    const podTab = { ...cluster, kube: logs };
    const state = reduce(reduce(emptyTerminalTabs, { type: 'open', id: 'a', connection: podTab }),
      { type: 'open', id: 'b', connection: { ...cluster, kube: { ...logs, mode: 'shell' as const } } });
    expect(state.tabs[0].connection.kube).toEqual(logs);
    expect(state.tabs[1].connection.kube?.mode).toBe('shell');
    expect(sameTarget(state.tabs[0].connection, state.tabs[1].connection)).toBe(false);
    expect(sameTarget(state.tabs[0].connection, podTab)).toBe(true);
    expect(sameTarget(cluster, podTab)).toBe(false);
    const adopted = reduce(emptyTerminalTabs, { type: 'adopt', id: 'c', connection: podTab, status: 'connected', adopt: {} });
    expect(adopted.tabs[0].connection.kube).toEqual(logs);
  });
  it('names pod tabs by mode and the cluster', () => {
    expect(kubeTabName(logs, 'k8s')).toBe('Logs: api-1 @ k8s');
    expect(kubeTabName({ ...logs, mode: 'previous' }, 'k8s')).toBe('Vorherige Logs: api-1 @ k8s');
    expect(kubeTabName({ ...logs, mode: 'shell' }, 'k8s')).toBe('api-1 @ k8s');
  });
  it('treats only pod shells as ssh shells', () => {
    expect(shellOf(tab({ ...cluster, kube: { ...logs, mode: 'shell' } }))).toBe('ssh');
    expect(shellOf(tab({ ...cluster, kube: logs }))).toBeNull();
    expect(shellOf(tab(cluster))).toBeNull();
  });
});

describe('container view tabs', () => {
  const tab = (conn: TerminalTab['connection']): TerminalTab => ({ id: 't', connection: conn, ordinal: 1, status: 'connected' });
  it('builds the view connection for SSH and for this computer', () => {
    expect(containerViewConnection('h1', 'srv', 'admin@srv')).toEqual({ id: 'h1', name: 'srv · Container', protocol: 'ssh', address: 'admin@srv', view: 'containers' });
    expect(containerViewConnection(LOCAL_CONTAINER_HOST, 'Dieser Computer', 'lokal')).toEqual({ id: LOCAL_CONTAINER_HOST, name: 'Dieser Computer · Container', protocol: 'cmd', address: 'lokal', view: 'containers' });
  });
  it('has no shell, also for the local view', () => {
    expect(shellOf(tab(containerViewConnection('h1', 'srv', 'a')))).toBeNull();
    expect(shellOf(tab(containerViewConnection(LOCAL_CONTAINER_HOST, 'x', 'lokal')))).toBeNull();
  });
  it('keeps files, containers and the plain tab apart and counts ordinals per kind', () => {
    const plain = { id: 'h1', name: 'srv', protocol: 'ssh' as const, address: 'a' };
    const files = toTerminalConnection({ id: 'h1', type: 'connection', protocol: 'ssh', name: 'srv', host: 'srv', port: 22, username: 'u', authentication: { method: 'agent' }, tags: [] } as never, true);
    const view = containerViewConnection('h1', 'srv', 'a');
    expect(sameTarget(files, view)).toBe(false);
    expect(sameTarget(plain, view)).toBe(false);
    expect(sameTarget(view, containerViewConnection('h1', 'srv', 'a'))).toBe(true);
    let state = reduce(emptyTerminalTabs, { type: 'open', id: 'p', connection: plain });
    state = reduce(state, { type: 'open', id: 'v1', connection: view });
    state = reduce(state, { type: 'open', id: 'v2', connection: view });
    expect(state.tabs.map(t => t.ordinal)).toEqual([1, 1, 2]);
    expect(state.tabs[1].connection.view).toBe('containers');
  });
  it('carries a fixed runtime in name and field', () => {
    expect(containerViewConnection('h1', 'srv', 'admin@srv', 'docker')).toEqual({ id: 'h1', name: 'srv · Docker', protocol: 'ssh', address: 'admin@srv', view: 'containers', runtime: 'docker' });
    expect(containerViewConnection(LOCAL_CONTAINER_HOST, 'Dieser Computer', 'lokal', 'podman').name).toBe('Dieser Computer · Podman');
    expect('runtime' in containerViewConnection('h1', 'srv', 'a')).toBe(false);
  });
  it('tells runtimes apart and counts ordinals per runtime', () => {
    const docker = containerViewConnection('h1', 'srv', 'a', 'docker');
    const podman = containerViewConnection('h1', 'srv', 'a', 'podman');
    expect(sameTarget(docker, podman)).toBe(false);
    expect(sameTarget(docker, containerViewConnection('h1', 'srv', 'a'))).toBe(false);
    expect(sameTarget(docker, containerViewConnection('h1', 'srv', 'a', 'docker'))).toBe(true);
    let state = reduce(emptyTerminalTabs, { type: 'open', id: 'd1', connection: docker });
    state = reduce(state, { type: 'open', id: 'd2', connection: docker });
    state = reduce(state, { type: 'open', id: 'p1', connection: podman });
    expect(state.tabs.map(t => t.ordinal)).toEqual([1, 2, 1]);
    expect(state.tabs.map(t => t.connection.runtime)).toEqual(['docker', 'docker', 'podman']);
  });
  it('keeps the runtime when adopting a tab', () => {
    const state = reduce(emptyTerminalTabs, { type: 'adopt', id: 'x', connection: containerViewConnection('h1', 'srv', 'a', 'podman'), status: 'connected', adopt: {} });
    expect(state.tabs[0].connection.runtime).toBe('podman');
  });
  const mk = (id: string, conn: TerminalTab['connection']): TerminalTab => ({ id, connection: conn, ordinal: 1, status: 'connected' });
  const docker = containerViewConnection('h1', 'srv', 'a', 'docker');
  const filler = (n: number): TerminalTab[] => Array.from({ length: n }, (_, i) => mk(`f${i}`, { id: `x${i}`, name: 'x', protocol: 'ssh', address: 'a' }));
  it('reusableTab prefers the active match, else the first', () => {
    const tabs = [mk('a', docker), mk('b', docker)];
    expect(reusableTab(tabs, 'b', docker)?.id).toBe('b');
    expect(reusableTab(tabs, null, docker)?.id).toBe('a');
    expect(reusableTab(tabs, 'zzz', docker)?.id).toBe('a');
    expect(reusableTab([], null, docker)).toBeUndefined();
  });
  it('reusableTab never matches another runtime, files or terminal tabs', () => {
    const plain = { id: 'h1', name: 'srv', protocol: 'ssh' as const, address: 'a' };
    const files = { ...plain, protocol: 'sftp' as const, view: 'files' as const };
    const tabs = [mk('d', docker), mk('p', plain), mk('f', files)];
    expect(reusableTab(tabs, 'd', containerViewConnection('h1', 'srv', 'a', 'podman'))).toBeUndefined();
    expect(reusableTab(tabs, 'd', containerViewConnection('h1', 'srv', 'a'))).toBeUndefined();
    expect(reusableTab([mk('p', plain), mk('f', files)], null, docker)).toBeUndefined();
  });
  it('planContainerView focuses before the limit and honors reuse', () => {
    const full = [...filler(MAX_SSH_SESSIONS - 1), mk('v', docker)];
    expect(planContainerView(full, null, docker, true)).toEqual({ kind: 'focus', tabId: 'v' });
    expect(planContainerView(filler(MAX_SSH_SESSIONS), null, docker, true)).toEqual({ kind: 'limit' });
    expect(planContainerView(full, null, docker, false)).toEqual({ kind: 'limit' });
    expect(planContainerView(filler(2), null, docker, true)).toEqual({ kind: 'open' });
    expect(planContainerView([...filler(2), mk('v', docker)], null, docker, false)).toEqual({ kind: 'open' });
  });
});

describe('terminal tab names in en-US', () => {
  afterEach(async () => { await i18n.changeLanguage('de-DE'); });
  it('translates the log prefixes and the file browser suffix', async () => {
    await i18n.changeLanguage('en-US');
    const logs = { namespace: 'shop', pod: 'api-1', container: 'api', mode: 'logs' as const };
    expect(kubeTabName({ ...logs, mode: 'previous' }, 'k8s')).toBe('Previous logs: api-1 @ k8s');
    expect(kubeTabName(logs, 'k8s')).toBe('Logs: api-1 @ k8s');
  });
});

describe('welcome tab', () => {
  it('opens closed, is not running, has no shell and survives retainConnections', () => {
    const state = reduce(opened(), { type: 'open', id: 'w', connection: welcomeConnection() });
    const tab = state.tabs.find(item => item.id === 'w')!;
    expect(isWelcomeTab(tab)).toBe(true);
    expect(tab.connection.id).toBe(WELCOME_HOST);
    expect(tab.status).toBe('closed');
    expect(isRunning(tab)).toBe(false);
    expect(shellOf(tab)).toBeNull();
    expect(reduce(state, { type: 'retainConnections', connectionIds: [] }).tabs.map(item => item.id)).toEqual(['w']);
    expect(sameTarget(tab.connection, welcomeConnection())).toBe(true);
    expect(reusableTab(state.tabs, state.activeTabId, welcomeConnection())).toBe(tab);
  });
  it('counts toward the tab limit', () => {
    let state = emptyTerminalTabs;
    for (let i = 0; i < MAX_SSH_SESSIONS; i++) state = reduce(state, { type: 'open', id: `t${i}`, connection });
    expect(reduce(state, { type: 'open', id: 'w', connection: welcomeConnection() })).toBe(state);
  });
});
