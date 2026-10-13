import { describe, expect, it } from 'vitest';
import { MAX_SSH_SESSIONS } from '../../shared/ssh';
import { connectionProtocol, emptyTerminalTabs, isRunning, tabLabel, terminalTabsReducer as reduce } from './terminal-tabs';
import type { TerminalTabsState } from './terminal-tabs';
const connection = { id: 'ssh', name: 'Server', host: 'example.test', port: 22, username: 'synthetic' };
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
    const withSecrets = { ...connection, authentication: { method: 'password' as const, password: 'synthetic-secret' } };
    let state = reduce(emptyTerminalTabs, { type: 'open', id: 'first', connection: withSecrets });
    expect(JSON.stringify(state)).not.toContain('synthetic-secret');
    expect(reduce(state, { type: 'open', id: 'first', connection })).toBe(state);
    for (let index = 1; index < MAX_SSH_SESSIONS; index++) state = reduce(state, { type: 'open', id: String(index), connection });
    expect(reduce(state, { type: 'open', id: 'overflow', connection })).toBe(state);
    expect(reduce(state, { type: 'select', id: 'unknown' })).toBe(state);
    expect(reduce(state, { type: 'reset' })).toEqual(emptyTerminalTabs);
  });
  it('marks tagged connections as RDP (prototype) and defaults to SSH', () => {
    expect(connectionProtocol({ ...connection, tags: ['rdp'] })).toBe('rdp');
    expect(connectionProtocol({ ...connection, tags: [] })).toBe('ssh');
    const state = reduce(emptyTerminalTabs, { type: 'open', id: 'r', connection: { ...connection, tags: ['rdp'] } as typeof connection });
    expect(state.tabs[0].connection.protocol).toBe('rdp');
  });
});
