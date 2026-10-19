import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { INVENTORY_KINDS, RUNTIME_LABEL, containerViewHostName, type InventoryAction, type InventoryRow, type TerminalTarget } from '../../../../shared/containers';
import type { SshStatus } from '../../../../shared/ssh';
import { containerConnection, type TerminalConnection } from '../../terminal-tabs';
import { useContainerInventory } from '../../hooks/useContainerInventory';
import { bindingOf } from '../../kube-commands';
import { actionUnavailable, commandForKey, type ContainerCommand, type ContainerCommandContext } from '../../container-commands';
import { confirmationFor, hostLabel, type ContainerConfirmation } from '../../container-confirm';
import { attentionChip } from '../../container-status';
import { primaryFilterColumn } from '../../container-columns';
import { menuFor, terminalTargetOf, type ContainerMenuTarget } from '../../container-menus';
import { runMenuAction, type ContainerMenuRunner } from '../../container-menu-run';
import { containerViewReducer, initialContainerViewState, loadedLabel, rootlessHint, tabStatus, visibleRows } from '../../container-view';
import { ipcMessage } from '../../container-tree';
import { copiedMessage } from '../../kube-copy';
import { ContextMenu, type ContextMenuEntry } from '../ContextMenu';
import { ContainerTable } from './ContainerTable';
import { ContainerDock } from './ContainerDock';
import { ContainerConfirm } from './ContainerConfirm';
import { ContainerHelp } from './ContainerHelp';
import '../../kubernetes-ui.css';
import '../../kubernetes-dock.css';
import '../../containers-ui.css';

export interface ContainerViewProps {
  connection: TerminalConnection;
  tabId: string;
  visible: boolean;
  focused?: boolean;
  style?: CSSProperties;
  onFocus?: () => void;
  onStatusChange: (id: string, status: SshStatus) => void;
  /** Absent in windows that cannot open a tab (secondary windows). */
  onPopout?: (connection: TerminalConnection) => void;
}

interface MenuState { x: number; y: number; target: ContainerMenuTarget }
interface PendingAction { row: InventoryRow; action: InventoryAction; confirmation: ContainerConfirmation }

const NOTICE_MS = 6000;
/** Cadence of the clock that drives ages and the "geladen vor" label. */
const TICK_MS = 5000;
const NO_POPOUT = 'Hier lässt sich kein Tab öffnen.';
const KIND_TABS = { containers: 'Container', images: 'Images', volumes: 'Volumes', networks: 'Netzwerke' } as const;

/** Container tab: header, chip bar, table and dock for one SSH host or this computer. */
export function ContainerView({ connection, tabId, visible, focused = true, style, onFocus, onStatusChange, onPopout }: ContainerViewProps) {
  const [state, dispatch] = useReducer(containerViewReducer, undefined, () => initialContainerViewState(Date.now(), connection.runtime ?? null));
  const stateRef = useRef(state);
  stateRef.current = state;
  const { reload } = useContainerInventory(connection.id, state.requestedRuntime, visible, dispatch);
  const rootRef = useRef<HTMLElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [help, setHelp] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const hostName = containerViewHostName(connection.name);
  const where = hostLabel(connection.id, hostName);
  const modal = help || pending !== null || menu !== null;
  // visibleRows reads exactly these fields of state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => visibleRows(state), [state.inventory, state.kind, state.views, state.now]);
  const selected = rows.find(row => row.uid === state.selected) ?? null;
  const commandContext: ContainerCommandContext = { kind: state.kind, row: selected, dock: state.dock, canPopout: Boolean(onPopout) };
  const inventory = state.inventory;

  // One clock for the view: ages and the load label read state.now. It only runs while the tab is visible.
  useEffect(() => {
    if (!visible) return;
    dispatch({ type: 'tick', now: Date.now() });
    const timer = setInterval(() => dispatch({ type: 'tick', now: Date.now() }), TICK_MS);
    return () => clearInterval(timer);
  }, [visible]);

  const say = useCallback((message: string) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  // Focus returns to the table when a dialog closes or the view is shown.
  useEffect(() => {
    if (modal || !visible || !focused) return;
    const dock = rootRef.current?.querySelector('.kube-dock');
    if (dock?.contains(document.activeElement)) return;
    tableRef.current?.focus({ preventScroll: true });
  }, [modal, visible, focused]);

  // Status for the tab bar, reported only when it changes.
  const status = tabStatus(state);
  const onStatusRef = useRef(onStatusChange);
  onStatusRef.current = onStatusChange;
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    if (lastStatus.current === status) return;
    lastStatus.current = status;
    onStatusRef.current(tabId, status);
  }, [status, tabId]);

  /** The only call of containersAction: busy, run, then busy off and reload. Errors go to the status line. */
  const run = async (row: InventoryRow, action: InventoryAction) => {
    dispatch({ type: 'busy', uid: row.uid, action });
    try {
      await window.desktopApi.containersAction({ hostId: connection.id, target: row.ref, action });
    } catch (caught) {
      say(ipcMessage(caught, 'Die Aktion ist fehlgeschlagen.'));
    } finally {
      dispatch({ type: 'busy', uid: row.uid });
      reload();
      // The dock shows the state from before the action: refetch Inspect (and restart logs) for the selected row.
      if (row.uid === stateRef.current.selected) dispatch({ type: 'reloadDock' });
    }
  };

  /** Every action on the host starts here: start runs at once, everything else asks first. */
  const confirm = (row: InventoryRow, action: InventoryAction) => {
    const reason = actionUnavailable(row, action);
    if (reason) { say(reason); return; }
    if (state.busy[row.uid]) { say('Für diese Zeile läuft bereits eine Aktion.'); return; }
    const confirmation = confirmationFor(row, action, where);
    if (confirmation === null) { void run(row, action); return; }
    setPending({ row, action, confirmation });
  };

  const openTab = (target: TerminalTarget) => {
    if (!onPopout) { say(NO_POPOUT); return; }
    onPopout(containerConnection(connection.id, hostName, connection.address, target));
  };

  const popout = () => {
    if (!onPopout) { say(NO_POPOUT); return; }
    // Same reasons as the Ctrl+Shift+T entry of the registry.
    const reason = commandForKey('Ctrl+Shift+T')?.unavailable?.(commandContext);
    if (reason) { say(reason); return; }
    if (!selected || (state.dock !== 'logs' && state.dock !== 'shell')) return;
    openTab(terminalTargetOf(selected, state.dock));
  };

  const openMenu = (target: ContainerMenuTarget, x: number, y: number) => setMenu({ x, y, target });

  const openKeyboardMenu = () => {
    const table = tableRef.current;
    const anchor = table?.querySelector('tr[aria-selected="true"]') ?? table;
    const rect = anchor?.getBoundingClientRect();
    const x = (rect?.left ?? 0) + 24;
    const y = rect?.bottom ?? 0;
    openMenu(selected ? { type: 'row', row: selected } : { type: 'background' }, x, y);
  };

  const copy = (text: string, label: string) => {
    window.desktopApi.writeClipboardText(text).then(() => say(copiedMessage(label, text)), () => say('Kopieren fehlgeschlagen.'));
  };

  const runner: ContainerMenuRunner = {
    dispatch, copy, confirm, popout: openTab, reload,
    reloadDock: () => dispatch({ type: 'reloadDock' }),
    help: () => setHelp(true),
  };

  const menuEntries = (current: MenuState): ContextMenuEntry[] => {
    const entries = menuFor(current.target, { state, canPopout: Boolean(onPopout) });
    return entries.map((entry): ContextMenuEntry => entry.kind === 'item'
      ? { kind: 'item', label: entry.label, ...(entry.hint ? { hint: entry.hint } : {}), ...(entry.disabled ? { disabled: true } : {}),
        onSelect: entry.disabled ? () => {} : () => runMenuAction(entry.run, runner) }
      : entry);
  };

  const runKey = (command: ContainerCommand, binding: string) => {
    switch (command.id) {
      case 'down': dispatch({ type: 'move', delta: 1 }); return;
      case 'up': dispatch({ type: 'move', delta: -1 }); return;
      case 'tab': {
        const kind = INVENTORY_KINDS[Number(binding) - 1];
        if (kind) dispatch({ type: 'setKind', kind });
        return;
      }
      case 'menu': openKeyboardMenu(); return;
      case 'help': setHelp(true); return;
      case 'reload': reload(); return;
      case 'filter': {
        const field = rootRef.current?.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-column-filter="${primaryFilterColumn(state.kind)}"]`);
        field?.focus({ preventScroll: true });
        field?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        if (field instanceof HTMLInputElement) field.select();
        return;
      }
      case 'attention': {
        const chip = attentionChip(state.kind);
        if (chip) dispatch({ type: 'toggleChip', id: chip });
        return;
      }
      case 'resetFilter': dispatch({ type: 'clearFilter' }); return;
      case 'logs': dispatch({ type: 'dock', mode: 'logs' }); return;
      // The key only shows the button; the shell starts on the user's click.
      case 'shell': dispatch({ type: 'dock', mode: 'shell' }); return;
      case 'inspect': dispatch({ type: 'dock', mode: 'inspect' }); return;
      case 'toggleDock': dispatch({ type: 'toggleDock' }); return;
      case 'popout': popout(); return;
      case 'restart': if (selected) confirm(selected, 'restart'); return;
      case 'stop': if (selected) confirm(selected, 'stop'); return;
      case 'remove': if (selected) confirm(selected, 'remove'); return;
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest?.('.context-menu')) return;
    if (modal) return;
    const binding = bindingOf(event);
    // Keys inside the dock belong to the terminal or the text; only the dock toggles pass through.
    if (target.closest?.('.kube-dock')) {
      if (binding === 'Ctrl+j' || binding === 'Ctrl+Shift+T') {
        const command = commandForKey(binding);
        if (command) {
          event.preventDefault();
          const reason = command.unavailable?.(commandContext);
          if (reason) say(reason); else runKey(command, binding);
        }
      }
      return;
    }
    // Inputs (the column filters) handle their own keys; only the arrow keys move the selection.
    if (target.closest?.('input, textarea, select')) {
      if (target instanceof HTMLInputElement && (binding === 'ArrowDown' || binding === 'ArrowUp')) {
        event.preventDefault();
        dispatch({ type: 'move', delta: binding === 'ArrowDown' ? 1 : -1 });
      }
      return;
    }
    const command = commandForKey(binding);
    if (!command) return;
    event.preventDefault();
    const reason = command.unavailable?.(commandContext);
    if (reason) { say(reason); return; }
    runKey(command, binding);
  };

  const hint = inventory ? rootlessHint(state, connection.id) : null;
  const problem = inventory?.problems[state.kind];
  const statusText = notice ?? (state.error ? state.error : state.loading ? 'lade …' : inventory ? loadedLabel(inventory.at, state.now) : 'lade …');
  const failed = notice === null && state.error !== null;

  return (
    <section ref={rootRef} className={`kube-view${focused ? ' focused-pane' : ''}`} style={style} hidden={!visible}
      id={`containers-${tabId}`} role="tabpanel" aria-labelledby={`tab-${tabId}`} onPointerDown={onFocus} onFocusCapture={onFocus} onKeyDown={onKeyDown}>
      <header className="kube-header">
        <div className="kube-title"><strong>{state.pinned ? `${hostName} · ${RUNTIME_LABEL[state.pinned]}` : hostName}</strong></div>
        <nav className="ctr-kinds" onContextMenu={event => event.preventDefault()}>
          {state.pinned === null && inventory && inventory.runtimes.length > 1 && (
            <label className="kube-ns">
              <span>Laufzeit</span>
              <select value={inventory.runtime} aria-label="Laufzeit" onChange={event => dispatch({ type: 'setRuntime', runtime: event.target.value === 'podman' ? 'podman' : 'docker' })}>
                {inventory.runtimes.map(runtime => <option key={runtime} value={runtime}>{RUNTIME_LABEL[runtime]}</option>)}
              </select>
            </label>
          )}
          <div className="kube-kind-tabs ctr-tabs" role="tablist" aria-label="Ressourcen">
            {INVENTORY_KINDS.map((candidate, index) => {
              const on = candidate === state.kind;
              const count = inventory?.rows[candidate].length;
              return (
                <button key={candidate} type="button" role="tab" aria-selected={on} className={`kube-kind${on ? ' kube-kind-on' : ''}`}
                  onClick={() => dispatch({ type: 'setKind', kind: candidate })}>
                  <kbd>{index + 1}</kbd> {KIND_TABS[candidate]}{count === undefined ? '' : ` ${count}`}
                </button>
              );
            })}
          </div>
        </nav>
        <div className="kube-prompt">
          <button type="button" onClick={reload}>Aktualisieren</button>
          <button type="button" className="kube-help-button" aria-label="Hilfe" title="Hilfe (?)" onClick={() => setHelp(true)}>?</button>
        </div>
        <p className={`kube-status${failed ? ' kube-status-error' : ''}`} role="status">
          <span>{statusText}</span>
          {failed && <button type="button" onClick={reload}>Erneut versuchen</button>}
          {problem && <span className="kube-status-error">{problem}</span>}
          {hint && <span>{hint}</span>}
        </p>
      </header>
      <div className="kube-body">
        <ContainerTable state={state} rows={rows} dispatch={dispatch} tableRef={tableRef} onMenu={openMenu} />
        <ContainerDock connection={connection} hostName={hostName} tabId={tabId} visible={visible} open={state.dockOpen} mode={state.dock} kind={state.kind}
          row={selected} armed={selected !== null && state.armed === selected.uid} epoch={state.epoch}
          onMode={mode => dispatch({ type: 'dock', mode })} onArm={() => dispatch({ type: 'arm' })} onStart={row => confirm(row, 'start')}
          onToggle={() => dispatch({ type: 'toggleDock' })} onPopout={onPopout ? popout : undefined} onMenu={openMenu}
          onCopy={(text, label, info) => { window.desktopApi.writeClipboardText(text).then(() => say(copiedMessage(label, text, info)), () => say('Kopieren fehlgeschlagen.')); }}
          onSay={say} />
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} label="Kontextmenü" entries={menuEntries(menu)} onClose={() => setMenu(null)} />}
      {help && <ContainerHelp state={state} context={commandContext} onClose={() => setHelp(false)} />}
      {pending && (
        <ContainerConfirm confirmation={pending.confirmation} onClose={() => setPending(null)} onConfirm={() => { void run(pending.row, pending.action); }} />
      )}
    </section>
  );
}
