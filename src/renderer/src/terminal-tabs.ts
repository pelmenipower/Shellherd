import type { ConnectionNode } from '../../shared/vault/types';
import { MAX_SSH_SESSIONS } from '../../shared/ssh';
import type { SshStatus } from '../../shared/ssh';

export type TerminalConnection = Pick<ConnectionNode, 'id' | 'name' | 'host' | 'port' | 'username'>;
export interface TerminalTab {
  id: string;
  connection: TerminalConnection;
  ordinal: number;
  status: SshStatus;
}
export interface TerminalTabsState { tabs: TerminalTab[]; activeTabId: string | null }
export const emptyTerminalTabs: TerminalTabsState = { tabs: [], activeTabId: null };
export type TerminalTabsAction =
  | { type: 'open'; id: string; connection: TerminalConnection }
  | { type: 'select'; id: string | null }
  | { type: 'status'; id: string; status: SshStatus }
  | { type: 'close'; id: string }
  | { type: 'retainConnections'; connectionIds: string[] }
  | { type: 'reset' }
  | { type: 'restore'; tabs: TerminalTab[]; activeTabId: string | null };

export function isRunning(tab: TerminalTab): boolean {
  return tab.status === 'connecting' || tab.status === 'connected';
}

export function terminalTabsReducer(state: TerminalTabsState, action: TerminalTabsAction): TerminalTabsState {
  switch (action.type) {
    case 'open': {
      if (state.tabs.length >= MAX_SSH_SESSIONS || state.tabs.some(tab => tab.id === action.id)) return state;
      const { id, name, host, port, username } = action.connection;
      const ordinal = Math.max(0, ...state.tabs.filter(tab => tab.connection.id === id).map(tab => tab.ordinal)) + 1;
      return { tabs: [...state.tabs, { id: action.id, connection: { id, name, host, port, username }, ordinal, status: 'connecting' }], activeTabId: action.id };
    }
    case 'select':
      return action.id === null || state.tabs.some(tab => tab.id === action.id) ? { ...state, activeTabId: action.id } : state;
    case 'status':
      return state.tabs.some(tab => tab.id === action.id)
        ? { ...state, tabs: state.tabs.map(tab => tab.id === action.id ? { ...tab, status: action.status } : tab) } : state;
    case 'close': {
      const index = state.tabs.findIndex(tab => tab.id === action.id);
      if (index < 0) return state;
      const tabs = state.tabs.filter(tab => tab.id !== action.id);
      return { tabs, activeTabId: state.activeTabId === action.id ? tabs[Math.min(index, tabs.length - 1)]?.id ?? null : state.activeTabId };
    }
    case 'retainConnections': {
      const ids = new Set(action.connectionIds);
      const tabs = state.tabs.filter(tab => ids.has(tab.connection.id));
      return tabs.length === state.tabs.length ? state : { tabs,
        activeTabId: state.activeTabId === null || tabs.some(tab => tab.id === state.activeTabId) ? state.activeTabId : tabs[0]?.id ?? null };
    }
    case 'reset': return emptyTerminalTabs;
    case 'restore': return { tabs: action.tabs, activeTabId: action.activeTabId };
  }
}

export function tabLabel(tab: TerminalTab, tabs: TerminalTab[]): string {
  return tabs.filter(other => other.connection.id === tab.connection.id).length > 1 || tab.ordinal > 1
    ? `${tab.connection.name} (${tab.ordinal})` : tab.connection.name;
}
