import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { KIND_INFO, KUBE_KINDS, refKey, type KubeAction, type KubeRef, type KubeViewSnapshot, type KubeTerminalMode, type KubeTerminalTarget } from '../../../../shared/kubernetes';
import type { SshStatus } from '../../../../shared/ssh';
import { kubeTabName, type TerminalConnection } from '../../terminal-tabs';
import { useClusterSession } from '../../hooks/useClusterSession';
import { errorText } from '../../error-text';
import { actionReason, bindingOf, commandForKey, type KubeCommand } from '../../kube-commands';
import { menuFor, type MenuTarget } from '../../kube-menus';
import { runMenuAction, type MenuRunner } from '../../kube-menu-run';
import { ContextMenu, type ContextMenuEntry } from '../ContextMenu';
import { dockSelection, filterOf, settleArm, snapshotOf, visibleRows } from '../../kube-view';
import { primaryFilterColumn } from '../../kube-columns';
import { attentionChip } from '../../../../shared/kube-status';
import { NodeStrip } from './NodeStrip';
import { ProblemBanner } from './ProblemBanner';
import { ResourceTable } from './ResourceTable';
import { copiedMessage } from '../../kube-copy';
import { DetailDock } from './DetailDock';
import { HelpOverlay } from './HelpOverlay';
import { ConfirmAction, type PendingAction } from './ConfirmAction';
import '../../kubernetes-ui.css';

interface ClusterViewProps {
  connection: TerminalConnection;
  tabId: string;
  visible: boolean;
  focused?: boolean;
  style?: CSSProperties;
  onFocus?: () => void;
  onStatusChange: (id: string, status: SshStatus) => void;
  /** Absent in windows that cannot open a tab (secondary windows). */
  onPopout?: (connection: TerminalConnection) => void;
  initialView?: KubeViewSnapshot;
  onSnapshot?: (tabId: string, snapshot: KubeViewSnapshot) => void;
  /** Vault SSH connection for a node; absent where connections cannot be opened. */
  sshForNode?: (node: { name: string; ip?: string }) => { id: string; name: string } | undefined;
  onOpenSsh?: (connectionId: string) => void;
}

interface MenuState { x: number; y: number; target: MenuTarget; now: number }
const noSsh = (): undefined => undefined;

const ALL_NAMESPACES = '__all';
const NOTICE_MS = 6000;
/** Cadence of the clock that drives ages and time chips. */
const TICK_MS = 10_000;

/** Cluster tab: header, node strip, problems, the resource table and the detail dock. */
export function ClusterView({ connection, tabId, visible, focused = true, style, onFocus, onStatusChange, onPopout, initialView, onSnapshot, sshForNode, onOpenSsh }: ClusterViewProps) {
  const { state, dispatch, retry, detail, action } = useClusterSession(connection.id, initialView, null);
  const rootRef = useRef<HTMLElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [previous, setPrevious] = useState(false);
  const [armedFor, setArmedFor] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dockReloads, setDockReloads] = useState(0);
  const [help, setHelp] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const status = state.status;
  // Without a status nothing is known: treat the cluster as production and read-only until main says otherwise.
  const readOnly = status?.readOnly ?? true;
  const production = status?.production ?? true;
  const clusterName = status?.name ?? connection.name;
  const modal = help || pending !== null || menu !== null;
  const filter = filterOf(state);
  // visibleRows reads exactly these fields of state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => visibleRows(state), [state.rows, state.query.kind, filter.text, filter.chips, filter.columns, state.sort, state.now, state.query.namespace]);
  const selectedRow = rows.find(row => refKey(row.ref) === state.selected) ?? null;
  // Logs and shell follow the pod: the drilled-into pod, or the selected pod row.
  const { podRow, container, armKey } = dockSelection(state.containersOf, selectedRow, state.container);
  const podRef = podRow?.ref ?? null;
  const terminalMode: KubeTerminalMode | null = state.dock === 'logs' ? (previous ? 'previous' : 'logs') : state.dock === 'shell' ? 'shell' : null;
  // A shell arm holds only for the key it was armed for. Once the dock key moves away the arm is dropped at once
  // (during render, so it cannot race with arm()), and returning to that pod shows the placeholder again.
  const armed = settleArm(armedFor, armKey) !== null;
  if (armedFor !== null && !armed) setArmedFor(null);

  // One clock for the whole view: ages and time chips read state.now.
  useEffect(() => {
    dispatch({ type: 'tick', now: Date.now() });
    const timer = setInterval(() => dispatch({ type: 'tick', now: Date.now() }), TICK_MS);
    return () => clearInterval(timer);
  }, [dispatch]);

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

  // Status for the tab bar: ready = connected, error = error, everything else = connecting.
  const onStatusRef = useRef(onStatusChange);
  onStatusRef.current = onStatusChange;
  const statusState = status?.state;
  useEffect(() => {
    if (!statusState) return;
    onStatusRef.current(tabId, statusState === 'ready' ? 'connected' : statusState === 'error' ? 'error' : 'connecting');
  }, [statusState, tabId]);

  // Counts the returns to `ready` after a reconnect: a log stream restarts then; a shell goes back to its
  // "Shell öffnen" placeholder and is only reopened by the user.
  const [epoch, setEpoch] = useState(0);
  const wasReady = useRef(false);
  const seenReady = useRef(false);
  useEffect(() => {
    if (statusState === 'ready') {
      if (wasReady.current === false && seenReady.current) { setEpoch(value => value + 1); setArmedFor(null); }
      wasReady.current = true;
      seenReady.current = true;
    } else if (statusState) wasReady.current = false;
  }, [statusState]);

  // Saved with the workspace whenever the view moves.
  const snapshot = snapshotOf(state);
  const snapshotKey = JSON.stringify(snapshot);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSnapshotRef = useRef(onSnapshot);
  onSnapshotRef.current = onSnapshot;
  useEffect(() => {
    onSnapshotRef.current?.(tabId, snapshotRef.current);
  }, [snapshotKey, tabId]);

  const confirm = (ref: KubeRef, kind: KubeAction, currentReplicas?: number, replicas?: number) => {
    const reason = actionReason(kind, { ref, readOnly, connected: status?.state === 'ready' });
    if (reason) { say(reason); return; }
    setPending({
      ref, action: kind,
      ...(currentReplicas !== undefined ? { currentReplicas } : {}),
      ...(replicas !== undefined ? { replicas } : {}),
    });
  };

  const startAction = (kind: KubeAction, replicas?: number) => {
    const target = state.containersOf ?? selectedRow;
    const reason = actionReason(kind, {
      ref: target?.ref ?? null, readOnly, connected: status?.state === 'ready', kind: state.containersOf ? 'pods' : state.query.kind,
    });
    if (reason || !target) { say(reason ?? 'Wähle zuerst eine Zeile.'); return; }
    confirm(target.ref, kind, target.replicas, replicas);
  };

  const openTab = (target: KubeTerminalTarget) => {
    if (!onPopout) { say('Hier lässt sich kein Tab öffnen.'); return; }
    onPopout({ ...connection, name: kubeTabName(target, clusterName), kube: target });
  };

  const popout = () => {
    if (!onPopout) { say('Hier lässt sich kein Tab öffnen.'); return; }
    if (!terminalMode) { say('Als Tab öffnen gibt es nur für Logs und Shell.'); return; }
    if (!podRef || !container) { say('Wähle einen Pod mit Container.'); return; }
    openTab({ namespace: podRef.namespace ?? '', pod: podRef.name, container, mode: terminalMode, ...(terminalMode !== 'shell' && state.logFormat === 'raw' ? { format: 'raw' as const } : {}) });
  };

  const moveContainer = (delta: number) => {
    const names = state.containersOf?.containers ?? [];
    if (names.length === 0) return;
    const index = names.indexOf(state.container ?? '');
    const next = Math.min(names.length - 1, Math.max(0, index + delta));
    dispatch({ type: 'selectContainer', name: names[next] });
  };

  const openMenu = (target: MenuTarget, x: number, y: number) => setMenu({ x, y, target, now: Date.now() });

  const openKeyboardMenu = () => {
    const table = tableRef.current;
    const anchor = table?.querySelector('tr[aria-selected="true"]') ?? table?.querySelector('.kube-row-selected') ?? table;
    const rect = anchor?.getBoundingClientRect();
    const x = (rect?.left ?? 0) + 24;
    const y = rect?.bottom ?? 0;
    if (state.containersOf) {
      if (!state.container) { say('Wähle zuerst eine Zeile.'); return; }
      openMenu({ type: 'container', pod: state.containersOf, name: state.container }, x, y);
      return;
    }
    if (!selectedRow) { say('Wähle zuerst eine Zeile.'); return; }
    openMenu({ type: 'row', row: selectedRow }, x, y);
  };

  /** Shell key of the menu target, so arming survives the selection change the same menu action causes. */
  const menuArmKey = (target: MenuTarget): string | null => {
    if (target.type === 'row') return target.row.containers?.[0] ? `${refKey(target.row.ref)}/${target.row.containers[0]}` : null;
    if (target.type === 'container') return `${refKey(target.pod.ref)}/${target.name}`;
    if (target.type === 'dock') {
      const name = target.container ?? target.pod?.containers?.[0];
      return target.pod && name ? `${refKey(target.pod.ref)}/${name}` : null;
    }
    return null;
  };

  const runnerFor = (target: MenuTarget): MenuRunner => ({
    dispatch,
    setPrevious,
    arm: () => setArmedFor(menuArmKey(target)),
    copy: (text, label) => {
      const shown = text.includes('\n') ? label : text.length > 60 ? `${text.slice(0, 60)}…` : text;
      window.desktopApi.writeClipboardText(text).then(() => say(`Kopiert: ${shown}`), () => say('Kopieren fehlgeschlagen.'));
    },
    confirm: (ref, kind, currentReplicas) => confirm(ref, kind, currentReplicas),
    popout: openTab,
    ssh: id => onOpenSsh?.(id),
    reloadDock: () => setDockReloads(value => value + 1),
    help: () => setHelp(true),
  });

  const menuEntries = (current: MenuState): ContextMenuEntry[] => {
    const entries = menuFor(current.target, {
      state, status, canPopout: Boolean(onPopout), sshForNode: onOpenSsh && sshForNode ? sshForNode : noSsh, canSsh: Boolean(onOpenSsh && sshForNode), now: current.now,
    });
    const run = runnerFor(current.target);
    return entries.map((entry): ContextMenuEntry => entry.kind === 'item'
      ? { kind: 'item', label: entry.label, ...(entry.hint ? { hint: entry.hint } : {}), ...(entry.disabled ? { disabled: true } : {}),
        onSelect: entry.disabled ? () => {} : () => runMenuAction(entry.run, run) }
      : entry);
  };

  const runKey = (command: KubeCommand, binding: string) => {
    switch (command.id) {
      case 'down': if (state.containersOf) moveContainer(1); else dispatch({ type: 'move', delta: 1 }); return;
      case 'up': if (state.containersOf) moveContainer(-1); else dispatch({ type: 'move', delta: -1 }); return;
      case 'drill': dispatch({ type: 'drill' }); return;
      case 'back': dispatch({ type: 'back' }); return;
      case 'tab': {
        const index = binding === '0' ? 9 : Number(binding) - 1;
        if (KUBE_KINDS[index]) dispatch({ type: 'setKind', kind: KUBE_KINDS[index] });
        return;
      }
      case 'filter': {
        const field = rootRef.current?.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-column-filter="${primaryFilterColumn(state.query.kind)}"]`);
        field?.focus({ preventScroll: true });
        field?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        if (field instanceof HTMLInputElement) field.select();
        return;
      }
      case 'attention': {
        const chip = attentionChip(state.query.kind);
        if (chip) dispatch({ type: 'toggleChip', id: chip });
        return;
      }
      case 'resetFilter': dispatch({ type: 'clearFilter' }); return;
      case 'logs': setPrevious(false); dispatch({ type: 'dock', mode: 'logs' }); return;
      case 'previous': setPrevious(true); dispatch({ type: 'dock', mode: 'logs' }); return;
      case 'shell': setArmedFor(armKey); dispatch({ type: 'dock', mode: 'shell' }); return;
      case 'events': dispatch({ type: 'dock', mode: 'events' }); return;
      case 'yaml': dispatch({ type: 'dock', mode: 'yaml' }); return;
      case 'describe': dispatch({ type: 'dock', mode: 'describe' }); return;
      case 'toggleDock': dispatch({ type: 'toggleDock' }); return;
      case 'menu': openKeyboardMenu(); return;
      case 'popout': popout(); return;
      case 'help': setHelp(true); return;
      case 'restart': startAction('restart'); return;
      case 'scale': startAction('scale'); return;
      case 'delete': startAction('delete'); return;
      default: return;
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest?.('.context-menu')) return;
    if (modal) return;
    const binding = bindingOf(event);
    // Keys inside the dock belong to the terminal or the detail text; only the dock toggles pass through.
    if (target.closest?.('.kube-dock')) {
      if (binding === 'Ctrl+j' || binding === 'Ctrl+Shift+T') {
        const command = commandForKey(binding);
        if (command) { event.preventDefault(); runKey(command, binding); }
      }
      return;
    }
    // Inputs (the column filters) handle their own keys.
    if (target.closest?.('input, textarea, select')) return;
    const command = commandForKey(binding);
    if (!command) return;
    event.preventDefault();
    const reason = command.unavailable?.({ state, readOnly });
    if (reason) { say(reason); return; }
    runKey(command, binding);
  };

  const namespaceOptions = [...new Set([...(state.query.namespace ? [state.query.namespace] : []), ...state.namespaces])];
  const crumbCount = state.crumbs.length;

  let statusText: ReactNode;
  if (notice) statusText = notice;
  else if (!status || status.state === 'connecting') statusText = 'verbinde …';
  else if (status.state === 'ready') statusText = status.host ? `bereit über ${status.host}` : 'bereit';
  else if (status.state === 'reconnecting') statusText = 'getrennt – verbinde neu …';
  else statusText = status.error ? errorText(status.error) : 'Verbindung fehlgeschlagen.';

  return (
    <section ref={rootRef} className={`kube-view${focused ? ' focused-pane' : ''}`} style={style} hidden={!visible}
      id={`cluster-${tabId}`} role="tabpanel" aria-labelledby={`tab-${tabId}`} onPointerDown={onFocus} onFocusCapture={onFocus} onKeyDown={onKeyDown}>
      <header className="kube-header">
        <div className="kube-title">
          <strong>{clusterName}</strong>
          {status?.production && <span className="kube-chip kube-chip-bad">Produktion</span>}
          {readOnly && <span className="kube-chip">Nur lesen</span>}
        </div>
        <nav className="kube-crumbs" aria-label="Pfad" onContextMenu={event => event.preventDefault()}>
          <label className="kube-ns">
            <span>ns:</span>
            <select value={state.query.namespace ?? ALL_NAMESPACES} aria-label="Namespace"
              onChange={event => dispatch({ type: 'setNamespace', namespace: event.target.value === ALL_NAMESPACES ? null : event.target.value })}>
              <option value={ALL_NAMESPACES}>alle</option>
              {namespaceOptions.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <span className="kube-crumb-current">{KIND_INFO[state.query.kind].label}</span>
          {state.crumbs.map((crumb, index) => (
            <button key={`${index}-${crumb.label}`} type="button" className="kube-crumb"
              onClick={() => { for (let step = crumbCount; step > index; step--) dispatch({ type: 'back' }); }}>› {crumb.label}</button>
          ))}
          {state.containersOf && <span className="kube-crumb-current">› {state.containersOf.ref.name}</span>}
        </nav>
        <div className="kube-prompt">
          <button type="button" className="kube-help-button" aria-label="Hilfe" title="Hilfe (?)" onClick={() => setHelp(true)}>?</button>
        </div>
        <p className={`kube-status${status?.state === 'error' ? ' kube-status-error' : ''}`} role="status">
          <span>{statusText}</span>
          {status?.state === 'error' && <button type="button" onClick={retry}>Erneut versuchen</button>}
        </p>
      </header>
      <div className={`kube-body${status?.state === 'reconnecting' ? ' kube-stale' : ''}`}>
        <NodeStrip nodes={state.nodes} onMenu={(target, x, y) => openMenu(target, x, y)} onJump={name => dispatch({ type: 'jump', ref: { kind: 'nodes', name } })} />
        <ProblemBanner problems={state.problems} onMenu={(target, x, y) => openMenu(target, x, y)} onJump={ref => dispatch({ type: 'jump', ref })} />
        <ResourceTable state={state} rows={rows} dispatch={dispatch} tableRef={tableRef} onMenu={openMenu} />
        <DetailDock connection={connection} tabId={tabId} visible={visible} open={state.dockOpen} mode={state.dock}
          previous={previous} armed={armed} selected={selectedRow?.ref ?? null} podRef={podRef} podRow={podRow} container={container} readOnly={readOnly}
          detail={detail} onMode={mode => dispatch({ type: 'dock', mode })} onArm={() => { setArmedFor(armKey); dispatch({ type: 'dock', mode: 'shell' }); }}
          onToggle={() => dispatch({ type: 'toggleDock' })} onPopout={onPopout ? popout : undefined} epoch={epoch + dockReloads} onMenu={(target, x, y) => openMenu(target, x, y)}
          logFormat={state.logFormat} onLogFormat={format => dispatch({ type: 'setLogFormat', format })} onSay={say}
          onCopy={(text, label, info) => { window.desktopApi.writeClipboardText(text).then(() => say(copiedMessage(label, text, info)), () => say('Kopieren fehlgeschlagen.')); }} />
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} label="Kontextmenü" entries={menuEntries(menu)} onClose={() => setMenu(null)} />}
      {help && <HelpOverlay state={state} readOnly={readOnly} onClose={() => setHelp(false)} />}
      {pending && (
        <ConfirmAction pending={pending} cluster={{ name: clusterName, production }}
          run={action} onClose={() => setPending(null)} />
      )}
    </section>
  );
}
