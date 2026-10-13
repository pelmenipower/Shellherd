import { useCallback, useEffect, useState } from 'react';
import type { SshStatus } from '../../../shared/ssh';
import type { ExternalDragHover, TransferTarget } from '../../../shared/windows';
import type { AdoptedSession, TerminalConnection, TerminalTab } from '../terminal-tabs';
import { isRunning } from '../terminal-tabs';
import { liveSessions } from '../session-registry';

interface Terminals {
  tabs: TerminalTab[];
  adopt: (connection: TerminalConnection, status: SshStatus, session: AdoptedSession) => string;
  close: (id: string) => void;
}

const errorText = (error: unknown): string => error instanceof Error
  ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Der Tab konnte nicht verschoben werden.';

/** Moves tabs between windows without reconnecting and receives tabs from other windows. */
export function useTabTransfer(terminals: Terminals, onError: (message: string) => void) {
  const [externalHover, setExternalHover] = useState<ExternalDragHover>(null);
  const [pendingDock, setPendingDock] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const { adopt, close } = terminals;

  useEffect(() => window.desktopApi.onTabDragHover(setExternalHover), []);
  useEffect(() => window.desktopApi.onIncomingTab(incoming => {
    setExternalHover(null);
    const tabId = adopt(incoming.connection, incoming.status, { session: incoming.session, snapshot: incoming.snapshot });
    if (incoming.drop) setPendingDock({ tabId, ...incoming.drop });
  }), [adopt]);

  const transfer = useCallback(async (tab: TerminalTab, target: TransferTarget): Promise<boolean> => {
    const live = isRunning(tab) ? liveSessions.get(tab.id) : undefined;
    try {
      await window.desktopApi.transferTab({ connection: tab.connection, status: tab.status, target,
        ...(live ? { session: { kind: live.kind, sessionId: live.sessionId } } : {}),
        ...(live?.snapshot ? { snapshot: live.snapshot() } : {}) });
    } catch (error) {
      onError(errorText(error));
      return false;
    }
    if (live) liveSessions.markTransferred(live.sessionId);
    close(tab.id);
    return true;
  }, [close, onError]);

  const tearOff = useCallback((tabId: string, x: number, y: number): void => {
    const tab = terminals.tabs.find(item => item.id === tabId);
    if (tab) void transfer(tab, { kind: 'drop', x, y });
  }, [terminals.tabs, transfer]);

  return { externalHover, pendingDock, clearPendingDock: useCallback(() => setPendingDock(null), []), transfer, tearOff };
}
