import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionCatalog } from '../../shared/windows';
import { SplitTerminalArea } from './components/SplitTerminalArea';
import { ConfirmDialog } from './components/ConfirmDialog';
import { errorText } from './error-text';
import { t as translate, useT } from './i18n';
import { ToastStack } from './components/Toast';
import { notify } from './notice-store';
import { useTerminalTabs } from './hooks/useTerminalTabs';
import { useTerminalLayout } from './hooks/useTerminalLayout';
import { useTabTransfer } from './hooks/useTabTransfer';
import { useViewControls } from './hooks/useViewControls';
import { isRunning, tabLabel, toTerminalConnection } from './terminal-tabs';
import { fromWorkspaceViews, toWorkspaceViews } from './terminal-views';
import { findNode } from './vault-selection';
import { AssistantPanel } from './components/AssistantPanel';
import { useAssistantToggle } from './hooks/useAssistantToggle';
import { useCtrlShiftShortcut } from './hooks/useShortcut';
import { WorkflowPalette } from './components/WorkflowPalette';
import { MAX_SSH_SESSIONS } from '../../shared/ssh';
import { LockScreen } from './components/LockScreen';
import { decodeError } from '../../shared/errors';
import { disabledNotice, disabledTitle, sessionLimitNotice, skippedNotice } from './vault-notices';

/** Detached window: tabs and split layout only; vault, sidebar and editor stay in the main window. */
export function SecondaryWindow() {
  const { t } = useT();
  const [catalog, setCatalog] = useState<ConnectionCatalog | null>(null);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const terminals = useTerminalTabs();
  const terminalLayout = useTerminalLayout(terminals.tabs, terminals.activeTabId);
  const transfer = useTabTransfer(terminals, terminalLayout);
  const viewControls = useViewControls(terminalLayout, terminals.select, transfer.transferView);

  // Effects and listeners read the latest state through refs.
  const state = useRef({ tabs: terminals.tabs, views: terminalLayout.viewsState, catalog, replaceViews: terminalLayout.replaceViews, restore: terminals.restore });
  state.current = { tabs: terminals.tabs, views: terminalLayout.viewsState, catalog, replaceViews: terminalLayout.replaceViews, restore: terminals.restore };

  // Effects run once: they use the module-level translate so a later language change is not captured stale.
  useEffect(() => {
    let active = true;
    const unsubscribe = window.desktopApi.onConnectionCatalog(setCatalog);
    const offLocked = window.desktopApi.onVaultLocked(() => {
      if (document.activeElement instanceof HTMLElement) returnFocus.current = document.activeElement;
      setLocked(true); setPaletteOpen(false);
    });
    const offUnlocked = window.desktopApi.onVaultUnlocked(() => {
      setLocked(false);
      requestAnimationFrame(() => { const target = returnFocus.current; returnFocus.current = null; if (target?.isConnected) target.focus(); });
    });
    window.desktopApi.connectionCatalog().then(value => { if (active) setCatalog(value); })
      .catch(error => {
        // A window still loading during the lock misses the vault:locked event.
        if (error instanceof Error && decodeError(error.message)?.code === 'core.vaultLocked') { setLocked(true); return; }
        notify.error(translate('app:notices.catalogUnavailableTitle'), { body: translate('app:notices.catalogUnavailableBody') });
      });
    return () => { active = false; unsubscribe(); offLocked(); offUnlocked(); };
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
      if (restored.skipped) notify.info(translate('app:notices.skippedTitle'), { body: skippedNotice(restored.skipped) });
    } catch (caught) {
      notify.error(translate('app:notices.windowNotRestored'), { body: errorText(caught, translate('app:errors.windowRestoreFailed')) });
    }
  }), []);

  const connect = useCallback((id: string, paneId: string, asFiles = false) => {
    const node = catalog && findNode(catalog.nodes, id);
    if (!node || node.type !== 'connection') return;
    if (node.disabled) { notify.info(disabledTitle(), { body: disabledNotice(node) }); return; }
    if (state.current.tabs.length >= MAX_SSH_SESSIONS) { const { title, body } = sessionLimitNotice(); notify.info(title, { body }); return; }
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
  useCtrlShiftShortcut('Space', () => { if (!locked) setPaletteOpen(open => !open); });

  return <>
  <main className="vault-shell secondary-shell" inert={locked}>
    <div className="secondary-body"><div className="terminal-area">
      <SplitTerminalArea nodes={catalog?.nodes ?? []} onConnect={connect} tabs={terminals.tabs} selected={terminals.activeTabId}
        layout={terminalLayout.layout} draggedTabId={draggedTabId} onDrag={setDraggedTabId} focused={terminalLayout.focused} busy={false}
        onLayout={terminalLayout.setLayout} onFocus={terminalLayout.setFocused} onSelect={terminals.select} onStatus={terminals.updateStatus}
        onClose={requestClose} externalHover={transfer.externalHover} pendingDock={transfer.pendingDock}
        onDockHandled={transfer.clearPendingDock} onTearOff={transfer.tearOff} viewControls={viewControls} />
    </div>
    {assistant.open && <AssistantPanel tabs={terminals.tabs} activeTabId={terminals.activeTabId} onClose={() => assistant.setOpen(false)} />}
    </div>
    {paletteOpen && <WorkflowPalette workflows={catalog?.workflows ?? []} tabs={terminals.tabs} activeTabId={terminals.activeTabId} onClose={() => setPaletteOpen(false)} />}
    {closingTab && <ConfirmDialog title={t('app:dialogs.closeTab.title', { name: tabLabel(closingTab, terminals.tabs) })}
      description={t('app:dialogs.closeTab.description')}
      confirmLabel={t('app:dialogs.confirmDisconnect')} busy={false} onCancel={() => setPendingClose(null)}
      onConfirm={() => { setPendingClose(null); terminals.close(closingTab.id); }} />}
    <ToastStack />
  </main>
  {locked && <LockScreen running={terminals.tabs.filter(isRunning).length} />}
  </>;
}
