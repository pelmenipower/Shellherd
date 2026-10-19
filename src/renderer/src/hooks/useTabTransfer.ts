import { useCallback, useEffect, useState } from 'react';
import type { SshStatus } from '../../../shared/ssh';
import type { ExternalDragHover, TransferTarget, ViewTransferTab } from '../../../shared/windows';
import { panes } from '../terminal-layout';
import type { LiveLayout } from '../terminal-layout';
import { remapLayout } from '../terminal-views';
import type { LiveView } from '../terminal-views';
import type { AdoptedSession, TerminalConnection, TerminalTab } from '../terminal-tabs';
import { isRunning } from '../terminal-tabs';
import { liveSessions } from '../session-registry';
import { errorText } from '../error-text';

interface Terminals {
  tabs: TerminalTab[];
  adopt: (connection: TerminalConnection, status: SshStatus, session: AdoptedSession) => string;
  close: (id: string) => void;
}

interface Views {
  insertView: (name: string, layout: LiveLayout) => void;
  removeView: (id: string) => void;
}

/** Moves tabs between windows without reconnecting and receives tabs from other windows. */
export function useTabTransfer(terminals: Terminals, views: Views, onError: (message: string) => void) {
  const [externalHover, setExternalHover] = useState<ExternalDragHover>(null);
  const [pendingDock, setPendingDock] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const { adopt, close } = terminals;
  const { insertView, removeView } = views;

  useEffect(() => window.desktopApi.onTabDragHover(setExternalHover), []);
  useEffect(() => window.desktopApi.onIncomingTab(incoming => {
    setExternalHover(null);
    const tabId = adopt(incoming.connection, incoming.status, { session: incoming.session, snapshot: incoming.snapshot });
    if (incoming.drop) setPendingDock({ tabId, ...incoming.drop });
  }), [adopt]);

  // A whole view arrives: adopt its tabs, then insert the view with the same split structure.
  useEffect(() => window.desktopApi.onIncomingView(incoming => {
    setExternalHover(null);
    const ids = new Map<string, string>();
    for (const tab of incoming.tabs) ids.set(tab.key, adopt(tab.connection, tab.status, { session: tab.session, snapshot: tab.snapshot }));
    insertView(incoming.name, remapLayout(incoming.layout, ids));
  }), [adopt, insertView]);

  const transferView = useCallback(async (view: LiveView, target: TransferTarget): Promise<boolean> => {
    const keys = panes(view.layout).flatMap(pane => pane.tabIds);
    const tabs = keys.flatMap(key => terminals.tabs.find(tab => tab.id === key) ?? []);
    const moving: ViewTransferTab[] = tabs.map(tab => {
      const live = isRunning(tab) ? liveSessions.get(tab.id) : undefined;
      return { key: tab.id, connection: tab.connection, status: tab.status,
        ...(live ? { session: { kind: live.kind, sessionId: live.sessionId } } : {}),
        ...(live?.snapshot ? { snapshot: live.snapshot() } : {}) };
    });
    try {
      await window.desktopApi.transferView({ name: view.name, layout: view.layout, tabs: moving, target });
    } catch (error) {
      onError(errorText(error, 'Der Tab konnte nicht verschoben werden.'));
      return false;
    }
    for (const tab of moving) if (tab.session) liveSessions.markTransferred(tab.session.sessionId);
    removeView(view.id);
    for (const tab of tabs) close(tab.id);
    return true;
  }, [terminals.tabs, removeView, close, onError]);

  const transfer = useCallback(async (tab: TerminalTab, target: TransferTarget): Promise<boolean> => {
    const live = isRunning(tab) ? liveSessions.get(tab.id) : undefined;
    try {
      await window.desktopApi.transferTab({ connection: tab.connection, status: tab.status, target,
        ...(live ? { session: { kind: live.kind, sessionId: live.sessionId } } : {}),
        ...(live?.snapshot ? { snapshot: live.snapshot() } : {}) });
    } catch (error) {
      onError(errorText(error, 'Der Tab konnte nicht verschoben werden.'));
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

  return { externalHover, pendingDock, clearPendingDock: useCallback(() => setPendingDock(null), []), transfer, transferView, tearOff };
}
