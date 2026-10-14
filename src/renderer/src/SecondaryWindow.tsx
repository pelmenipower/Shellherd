import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionCatalog } from '../../shared/windows';
import { SplitTerminalArea } from './components/SplitTerminalArea';
import { ConfirmDialog } from './components/ConfirmDialog';
import { useTerminalTabs } from './hooks/useTerminalTabs';
import { useTerminalLayout } from './hooks/useTerminalLayout';
import { useTabTransfer } from './hooks/useTabTransfer';
import { useViewControls } from './hooks/useViewControls';
import { isRunning, tabLabel, toTerminalConnection } from './terminal-tabs';
import { fromWorkspaceViews, toWorkspaceViews } from './terminal-views';
import { findNode } from './vault-selection';
import { AssistantPanel } from './components/AssistantPanel';
import { useAssistantToggle } from './hooks/useAssistantToggle';
import { MAX_SSH_SESSIONS } from '../../shared/ssh';

/** Detached window: tabs and split layout only; vault, sidebar and editor stay in the main window. */
export function SecondaryWindow() {
  const [catalog, setCatalog] = useState<ConnectionCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const terminals = useTerminalTabs();
  const terminalLayout = useTerminalLayout(terminals.tabs, terminals.activeTabId);
  const transfer = useTabTransfer(terminals, terminalLayout, setError);
  const viewControls = useViewControls(terminalLayout, terminals.select, transfer.transferView);

  // Effects and listeners read the latest state through refs.
  const state = useRef({ tabs: terminals.tabs, views: terminalLayout.viewsState, catalog, replaceViews: terminalLayout.replaceViews, restore: terminals.restore });
  state.current = { tabs: terminals.tabs, views: terminalLayout.viewsState, catalog, replaceViews: terminalLayout.replaceViews, restore: terminals.restore };

  useEffect(() => {
    let active = true;
    const unsubscribe = window.desktopApi.onConnectionCatalog(setCatalog);
    window.desktopApi.connectionCatalog().then(value => { if (active) setCatalog(value); })
      .catch(() => setError('Die Verbindungsliste ist nicht verfügbar. Ist der Vault gesperrt?'));
    return () => { active = false; unsubscribe(); };
  }, []);

  // Ready once the catalog is loaded; listeners are registered by then.
  const announced = useRef(false);
  useEffect(() => {
    if (!catalog || announced.current) return;
    announced.current = true;
    void window.desktopApi.windowReady();
  }, [catalog]);

  // The last tab left: the window has no purpose anymore.
  const hadTabs = useRef(false);
  useEffect(() => {
    if (terminals.tabs.length) hadTabs.current = true;
    else if (hadTabs.current) void window.desktopApi.windowCloseReady();
  }, [terminals.tabs.length]);

  useEffect(() => window.desktopApi.onWorkspaceCollect(({ requestId }) => {
    const { tabs, views } = state.current;
    void window.desktopApi.workspaceReport({ requestId, report: tabs.length ? toWorkspaceViews(views, tabs) : null });
  }), []);

  useEffect(() => window.desktopApi.onWorkspaceRestore(saved => {
    const { catalog: current, replaceViews, restore } = state.current;
    try {
      const restored = fromWorkspaceViews(saved, id => {
        const node = current && findNode(current.nodes, id);
        return node?.type === 'connection' ? node : undefined;
      }, () => crypto.randomUUID());
      replaceViews(restored.state);
      restore(restored.tabs, restored.activeTabId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Das Fenster konnte nicht wiederhergestellt werden.');
    }
  }), []);

  const connect = useCallback((id: string, paneId: string, asFiles = false) => {
    const node = catalog && findNode(catalog.nodes, id);
    if (!node || node.type !== 'connection') return;
    if (state.current.tabs.length >= MAX_SSH_SESSIONS) { setError(`Maximal ${MAX_SSH_SESSIONS} Sessions. Schließe zuerst einen Tab.`); return; }
    terminalLayout.setFocused(paneId);
    terminals.open(toTerminalConnection(node, asFiles));
  }, [catalog, terminalLayout, terminals]);

  const requestClose = (tabId: string): void => {
    const tab = terminals.tabs.find(item => item.id === tabId);
    if (!tab) return;
    if (isRunning(tab) && (catalog?.confirmBeforeClosingSession ?? true)) setPendingClose(tabId);
    else terminals.close(tabId);
  };
  const closingTab = terminals.tabs.find(tab => tab.id === pendingClose);
  const assistant = useAssistantToggle();

  return <main className="vault-shell secondary-shell">
    <div className="secondary-body"><div className="terminal-area">
      <SplitTerminalArea nodes={catalog?.nodes ?? []} onConnect={connect} tabs={terminals.tabs} selected={terminals.activeTabId}
        layout={terminalLayout.layout} draggedTabId={draggedTabId} onDrag={setDraggedTabId} focused={terminalLayout.focused} busy={false}
        onLayout={terminalLayout.setLayout} onFocus={terminalLayout.setFocused} onSelect={terminals.select} onStatus={terminals.updateStatus}
        onClose={requestClose} externalHover={transfer.externalHover} pendingDock={transfer.pendingDock}
        onDockHandled={transfer.clearPendingDock} onTearOff={transfer.tearOff} viewControls={viewControls} />
    </div>
    {assistant.open && <AssistantPanel tabs={terminals.tabs} activeTabId={terminals.activeTabId} onClose={() => assistant.setOpen(false)} />}
    </div>
    {closingTab && <ConfirmDialog title={`Tab „${tabLabel(closingTab, terminals.tabs)}“ schließen?`}
      description="Diese Verbindung wird beendet. Laufende Programme in der Sitzung können dadurch beendet werden."
      confirmLabel="Verbindung trennen" busy={false} onCancel={() => setPendingClose(null)}
      onConfirm={() => { setPendingClose(null); terminals.close(closingTab.id); }} />}
    {error && <div className="app-error" role="alert"><span>{error}</span>
      <button type="button" aria-label="Fehlermeldung schließen" onClick={() => setError(null)}>Schließen</button></div>}
  </main>;
}
