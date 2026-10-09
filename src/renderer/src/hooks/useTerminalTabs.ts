import { useCallback, useReducer } from 'react';
import type { SshStatus } from '../../../shared/ssh';
import type { TerminalTab, TerminalConnection } from '../terminal-tabs';
import { emptyTerminalTabs, isRunning, terminalTabsReducer } from '../terminal-tabs';

export function useTerminalTabs() {
  const [state, dispatch] = useReducer(terminalTabsReducer, emptyTerminalTabs);
  const open = useCallback((connection: TerminalConnection) => dispatch({ type: 'open', id: crypto.randomUUID(), connection }), []);
  const select = useCallback((id: string | null) => dispatch({ type: 'select', id }), []);
  const close = useCallback((id: string) => dispatch({ type: 'close', id }), []);
  const updateStatus = useCallback((id: string, status: SshStatus) => dispatch({ type: 'status', id, status }), []);
  const restore = useCallback((tabs: TerminalTab[], activeTabId: string | null) => dispatch({ type: 'restore', tabs, activeTabId }), []);
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);
  const retainConnections = useCallback((connectionIds: string[]) => dispatch({ type: 'retainConnections', connectionIds }), []);
  return { ...state, hasRunning: state.tabs.some(isRunning), open, select, close, updateStatus, reset, restore, retainConnections };
}
