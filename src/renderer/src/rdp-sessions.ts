import type { RdpAction } from '../../shared/rdp';

// Maps tab IDs to live RDP session IDs so pane controls can address the session of a tab.
const sessions = new Map<string, string>();

export const rdpSessions = {
  set: (tabId: string, sessionId: string): void => { sessions.set(tabId, sessionId); },
  delete: (tabId: string): void => { sessions.delete(tabId); },
  get: (tabId: string): string | undefined => sessions.get(tabId),
};

export const RDP_ACTION_LABELS: Record<RdpAction, { label: string; hint?: string }> = {
  ctrlAltDel: { label: 'Strg+Alt+Entf', hint: 'Sicherheitsoptionen' },
  taskManager: { label: 'Task-Manager', hint: 'Strg+Umschalt+Esc' },
  startScreen: { label: 'Startmenü', hint: 'Windows-Taste' },
  appSwitch: { label: 'Fenster wechseln', hint: 'Alt+Tab' },
  actionCenter: { label: 'Info-Center', hint: 'Windows+A' },
};
