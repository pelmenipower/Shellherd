import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { KIND_INFO, KUBE_KINDS, refKey, type KubeAction, type KubeViewSnapshot, type KubeTerminalMode } from '../../../../shared/kubernetes';
import type { SshStatus } from '../../../../shared/ssh';
import type { TerminalConnection } from '../../terminal-tabs';
import { useClusterSession } from '../../hooks/useClusterSession';
import { KUBE_COMMANDS, bindingOf, commandForKey, completions, parseCommandLine, type KubeCommand } from '../../kube-commands';
import { snapshotOf, visibleRows } from '../../kube-view';
import { NodeStrip } from './NodeStrip';
import { ProblemBanner } from './ProblemBanner';
import { ResourceTable } from './ResourceTable';
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
  onPopout: (connection: TerminalConnection) => void;
  initialView?: KubeViewSnapshot;
  onSnapshot?: (tabId: string, snapshot: KubeViewSnapshot) => void;
}

const ALL_NAMESPACES = '__all';
const NOTICE_MS = 6000;

/** Cluster tab: header, node strip, problems, the resource table and the detail dock. */
export function ClusterView({ connection, tabId, visible, focused = true, style, onFocus, onStatusChange, onPopout, initialView, onSnapshot }: ClusterViewProps) {
  const { state, dispatch, retry, detail, action } = useClusterSession(connection.id, initialView, 'default');
  const rootRef = useRef<HTMLElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [previous, setPrevious] = useState(false);
  const [armed, setArmed] = useState(false);
  const [help, setHelp] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [prompt, setPrompt] = useState<'filter' | 'command' | null>(null);
  const [line, setLine] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const status = state.status;
  const readOnly = status?.readOnly ?? false;
  const clusterName = status?.name ?? connection.name;
  const modal = help || pending !== null;
  const rows = visibleRows(state);
  const selectedRow = rows.find(row => refKey(row.ref) === state.selected) ?? null;
  // Logs and shell follow the pod: the drilled-into pod, or the selected pod row.
  const podRow = state.containersOf ?? (selectedRow?.ref.kind === 'pods' ? selectedRow : null);
  const podRef = podRow?.ref ?? null;
  const container = state.containersOf ? state.container : (podRow?.containers?.[0] ?? null);
  const terminalMode: KubeTerminalMode | null = state.dock === 'logs' ? (previous ? 'previous' : 'logs') : state.dock === 'shell' ? 'shell' : null;
  const selectedKey = state.selected;

  const say = useCallback((message: string) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  // A shell started for one container does not carry over to another selection.
  useEffect(() => { setArmed(false); }, [selectedKey, container]);

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

  const startAction = (kind: KubeAction, replicas?: number) => {
    const command = KUBE_COMMANDS.find(candidate => candidate.id === kind);
    const reason = command?.unavailable?.({ state, readOnly });
    if (reason) { say(reason); return; }
    if (!selectedRow) { say('Wähle zuerst eine Zeile.'); return; }
    setPending({
      ref: selectedRow.ref, action: kind,
      ...(selectedRow.replicas !== undefined ? { currentReplicas: selectedRow.replicas } : {}),
      ...(replicas !== undefined ? { replicas } : {}),
    });
  };

  const popout = () => {
    if (!terminalMode) { say('Als Tab öffnen gibt es nur für Logs und Shell.'); return; }
    if (!podRef || !container) { say('Wähle einen Pod mit Container.'); return; }
    const target = { namespace: podRef.namespace ?? '', pod: podRef.name, container, mode: terminalMode };
    const name = terminalMode === 'shell' ? `${podRef.name} @ ${clusterName}` : `Logs: ${podRef.name} @ ${clusterName}`;
    onPopout({ ...connection, name, kube: target });
  };

  const runCommand = (text: string) => {
    const parsed = parseCommandLine(text);
    if ('error' in parsed) { say(parsed.error); return; }
    switch (parsed.id) {
      case 'kind': dispatch({ type: 'setKind', kind: parsed.kind }); return;
      case 'namespace': dispatch({ type: 'setNamespace', namespace: parsed.namespace }); return;
      case 'scale': startAction('scale', parsed.replicas); return;
      case 'restart': startAction('restart'); return;
      case 'delete': startAction('delete'); return;
      case 'help': setHelp(true); return;
    }
  };

  const moveContainer = (delta: number) => {
    const names = state.containersOf?.containers ?? [];
    if (names.length === 0) return;
    const index = names.indexOf(state.container ?? '');
    const next = Math.min(names.length - 1, Math.max(0, index + delta));
    dispatch({ type: 'selectContainer', name: names[next] });
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
      case 'command': setLine(''); setPrompt('command'); return;
      case 'filter': setLine(state.filter); setPrompt('filter'); return;
      case 'logs': setPrevious(false); dispatch({ type: 'dock', mode: 'logs' }); return;
      case 'previous': setPrevious(true); dispatch({ type: 'dock', mode: 'logs' }); return;
      case 'shell': setArmed(true); dispatch({ type: 'dock', mode: 'shell' }); return;
      case 'events': dispatch({ type: 'dock', mode: 'events' }); return;
      case 'yaml': dispatch({ type: 'dock', mode: 'yaml' }); return;
      case 'describe': dispatch({ type: 'dock', mode: 'describe' }); return;
      case 'toggleDock': dispatch({ type: 'toggleDock' }); return;
      case 'popout': popout(); return;
      case 'help': setHelp(true); return;
      case 'restart': startAction('restart'); return;
      case 'scale': startAction('scale'); return;
      case 'delete': startAction('delete'); return;
      default: return;
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (modal) return;
    const target = event.target as HTMLElement;
    const binding = bindingOf(event);
    // Keys inside the dock belong to the terminal or the detail text; only the dock toggles pass through.
    if (target.closest?.('.kube-dock')) {
      if (binding === 'Ctrl+j' || binding === 'Ctrl+Shift+T') {
        const command = commandForKey(binding);
        if (command) { event.preventDefault(); runKey(command, binding); }
      }
      return;
    }
    // Inputs handle their own keys (the prompt handles Escape itself).
    if (target.closest?.('input, textarea, select')) return;
    const command = commandForKey(binding);
    if (!command) return;
    event.preventDefault();
    const reason = command.unavailable?.({ state, readOnly });
    if (reason) { say(reason); return; }
    runKey(command, binding);
  };

  const closePrompt = (keepFilter: boolean) => {
    if (prompt === 'filter' && !keepFilter) dispatch({ type: 'filter', text: '' });
    setPrompt(null);
    setLine('');
  };

  const onPromptKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closePrompt(false);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (prompt === 'command') {
        const text = line;
        setPrompt(null);
        setLine('');
        if (text.trim()) runCommand(text);
      } else {
        setPrompt(null);
      }
      return;
    }
    if (event.key === 'Tab' && prompt === 'command') {
      const first = completions(line, state.namespaces)[0];
      if (first) { event.preventDefault(); setLine(first); }
    }
  };

  const suggestions = prompt === 'command' ? completions(line, state.namespaces) : [];
  const namespaceOptions = [...new Set([...(state.query.namespace ? [state.query.namespace] : []), ...state.namespaces])];
  const crumbCount = state.crumbs.length;

  let statusText: ReactNode;
  if (notice) statusText = notice;
  else if (!status || status.state === 'connecting') statusText = 'verbinde …';
  else if (status.state === 'ready') statusText = status.host ? `bereit über ${status.host}` : 'bereit';
  else if (status.state === 'reconnecting') statusText = 'getrennt – verbinde neu …';
  else statusText = status.message ?? 'Verbindung fehlgeschlagen.';

  return (
    <section ref={rootRef} className={`kube-view${focused ? ' focused-pane' : ''}`} style={style} hidden={!visible}
      id={`cluster-${tabId}`} role="tabpanel" aria-labelledby={`tab-${tabId}`} onPointerDown={onFocus} onFocusCapture={onFocus} onKeyDown={onKeyDown}>
      <header className="kube-header">
        <div className="kube-title">
          <strong>{clusterName}</strong>
          {status?.production && <span className="kube-chip kube-chip-bad">Produktion</span>}
          {readOnly && <span className="kube-chip">Nur lesen</span>}
        </div>
        <nav className="kube-crumbs" aria-label="Pfad">
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
          {prompt ? (
            <>
              <input type="text" autoFocus className="kube-prompt-input" aria-label={prompt === 'filter' ? 'Filter' : 'Befehl'} autoComplete="off" spellCheck={false}
                placeholder={prompt === 'filter' ? 'Name oder key=value' : ':befehl'} value={prompt === 'filter' ? state.filter : line}
                onChange={event => {
                  if (prompt === 'filter') dispatch({ type: 'filter', text: event.target.value });
                  else setLine(event.target.value);
                }}
                onKeyDown={onPromptKeyDown} onBlur={() => { if (prompt === 'filter') setPrompt(null); }} />
              {suggestions.length > 0 && (
                <ul className="kube-suggest" role="listbox" aria-label="Vorschläge">
                  {suggestions.map(suggestion => (
                    <li key={suggestion}>
                      <button type="button" role="option" aria-selected={false} onMouseDown={event => { event.preventDefault(); setLine(suggestion); }}>{suggestion}</button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <button type="button" className="kube-prompt-hint" onClick={() => { setLine(state.filter); setPrompt('filter'); }}>
              {state.filter ? `Filter: ${state.filter}` : '/ filtern'} · : befehl
            </button>
          )}
          <button type="button" className="kube-help-button" aria-label="Hilfe" title="Hilfe (?)" onClick={() => setHelp(true)}>?</button>
        </div>
        <p className={`kube-status${status?.state === 'error' ? ' kube-status-error' : ''}`} role="status">
          <span>{statusText}</span>
          {status?.state === 'error' && <button type="button" onClick={retry}>Erneut versuchen</button>}
        </p>
      </header>
      <div className={`kube-body${status?.state === 'reconnecting' ? ' kube-stale' : ''}`}>
        <NodeStrip nodes={state.nodes} onJump={name => dispatch({ type: 'jump', ref: { kind: 'nodes', name } })} />
        <ProblemBanner problems={state.problems} onJump={ref => dispatch({ type: 'jump', ref })} />
        <ResourceTable state={state} rows={rows} dispatch={dispatch} tableRef={tableRef} />
        <DetailDock connection={connection} tabId={tabId} visible={visible} open={state.dockOpen} mode={state.dock}
          previous={previous} armed={armed} selected={selectedRow?.ref ?? null} podRef={podRef} container={container} readOnly={readOnly}
          detail={detail} onMode={mode => dispatch({ type: 'dock', mode })} onArm={() => { setArmed(true); dispatch({ type: 'dock', mode: 'shell' }); }}
          onToggle={() => dispatch({ type: 'toggleDock' })} onPopout={popout} />
      </div>
      {help && <HelpOverlay state={state} readOnly={readOnly} onClose={() => setHelp(false)} />}
      {pending && (
        <ConfirmAction pending={pending} cluster={{ name: clusterName, production: status?.production ?? false }}
          run={action} onClose={() => setPending(null)} />
      )}
    </section>
  );
}
