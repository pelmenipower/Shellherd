import type { TransferSession } from '../../shared/windows';

interface LiveSession extends TransferSession {
  /** Serialized terminal screen and scrollback; terminals only. */
  snapshot?: () => string;
}

// Panels register their session per tab so pane controls and tab transfers can address it.
const sessions = new Map<string, LiveSession>();
// Sessions handed to another window; their panels must not close them on unmount.
const transferred = new Set<string>();

export const liveSessions = {
  set: (tabId: string, session: LiveSession): void => { sessions.set(tabId, session); },
  get: (tabId: string): LiveSession | undefined => sessions.get(tabId),
  delete: (tabId: string): void => { sessions.delete(tabId); },
  markTransferred: (sessionId: string): void => { transferred.add(sessionId); },
  /** True once; the panel that sees it skips closing the session. */
  takeTransferred: (sessionId: string): boolean => transferred.delete(sessionId),
};
