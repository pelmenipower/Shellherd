import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { ContainerDockMode, InventoryKind, InventoryRow } from '../../../../shared/containers';
import { containerConnection, type TerminalConnection } from '../../terminal-tabs';
import { actionUnavailable } from '../../container-commands';
import { dockTerminalKey } from '../../container-view';
import { terminalTargetOf, type ContainerMenuTarget } from '../../container-menus';
import { ipcMessage } from '../../container-tree';
import { TerminalPanel } from '../TerminalPanel';
import '../../kubernetes-dock.css';
import { liveSessions } from '../../session-registry';
import { capText } from '../../kube-copy';
import { isKeyboardContextMenu, isMenuKey, keyMenuAnchor, markKeyMenu } from '../../kube-menu-trigger';

const DOCK_TABS: { mode: ContainerDockMode; label: string; key: string }[] = [
  { mode: 'logs', label: 'Logs', key: 'l' },
  { mode: 'shell', label: 'Shell', key: 's' },
  { mode: 'inspect', label: 'Inspect', key: 'i' },
];
const MAX_COPY_CHARS = 4 * 1024 * 1024 - 1024;
const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 260;
const ONLY_CONTAINERS = 'Nur für Container.';
/** Stable identity: TerminalPanel's effect depends on it, so a new function would reconnect. */
const ignoreStatus = (): void => {};
const noop = (): void => {};

interface ContainerDockProps {
  connection: TerminalConnection;
  /** Host part of the tab name, for the popout tab and the dock terminal. */
  hostName: string;
  tabId: string;
  visible: boolean;
  open: boolean;
  mode: ContainerDockMode;
  kind: InventoryKind;
  /** Selected row; the dock follows it. */
  row: InventoryRow | null;
  /** The shell was opened for this row (state.armed === row.uid). */
  armed: boolean;
  /** Changes when the log stream is to be restarted; also refetches Inspect. */
  epoch: number;
  onMode: (mode: ContainerDockMode) => void;
  onArm: () => void;
  /** Starts the container (through the view's confirm path). */
  onStart: (row: InventoryRow) => void;
  onToggle: () => void;
  /** Absent where no tab can be opened. */
  onPopout?: (() => void) | undefined;
  onMenu: (target: ContainerMenuTarget, x: number, y: number) => void;
  /** Puts `text` on the clipboard and reports it. */
  onCopy: (text: string, label: string, info?: { shortened?: boolean }) => void;
  /** Reports a status line. */
  onSay: (message: string) => void;
}

type InspectResult = { id: string; text?: string; error?: string };

/** Bottom dock: logs and shell as embedded terminal, inspect as text. Follows the selection. */
export function ContainerDock(props: ContainerDockProps) {
  const { connection, hostName, tabId, visible, open, mode, kind, row, armed, epoch, onMode, onArm, onStart, onToggle, onPopout, onMenu, onCopy, onSay } = props;
  const dockRef = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [result, setResult] = useState<InspectResult | null>(null);
  const isContainer = kind === 'containers';
  const inspectId = mode === 'inspect' && row ? `${row.uid}/${epoch}` : null;

  // Inspect is fetched when the selection, the mode or the epoch changes; a poll does not refetch.
  useEffect(() => {
    if (!open || !row || !inspectId) return;
    let cancelled = false;
    window.desktopApi.containersInspect({ hostId: connection.id, ref: row.ref }).then(
      text => { if (!cancelled) setResult({ id: inspectId, text }); },
      caught => { if (!cancelled) setResult({ id: inspectId, error: ipcMessage(caught, 'Inspect konnte nicht geladen werden.') }); },
    );
    return () => { cancelled = true; };
    // inspectId stands for `row`: a new row object with the same uid is the same request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inspectId, connection.id]);
  const current = result?.id === inspectId ? result : null;

  const terminalMode: 'logs' | 'shell' | null = mode === 'logs' || mode === 'shell' ? mode : null;
  const running = row?.state === 'running';
  const terminalConnection: TerminalConnection | null = terminalMode && row && isContainer
    ? containerConnection(connection.id, hostName, connection.address, terminalTargetOf(row, terminalMode)) : null;
  const shellWaiting = terminalMode === 'shell' && (!armed || !running);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dock = dockRef.current;
    const area = dock?.parentElement;
    if (!dock || !area) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = dock.getBoundingClientRect().height;
    const move = (moveEvent: PointerEvent) => {
      const max = Math.floor(area.clientHeight * 0.7);
      setHeight(Math.max(MIN_HEIGHT, Math.min(max, Math.round(startHeight + startY - moveEvent.clientY))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const copyLabel = mode === 'shell' ? 'Shell' : mode === 'logs' ? 'Logs' : 'Inspect';
  const nothingToCopy = terminalMode ? !terminalConnection || shellWaiting : !current?.text;
  const copy = () => {
    const full = terminalMode ? liveSessions.get(`${tabId}:dock`)?.terminal?.allText(5000) ?? '' : current?.text ?? '';
    if (full.trim() === '') { onSay('Nichts zu kopieren.'); return; }
    // The clipboard IPC rejects over 4 MiB: keep the newest part and say so.
    const { text, shortened } = capText(full, MAX_COPY_CHARS);
    onCopy(text, copyLabel, shortened ? { shortened } : {});
  };

  const target = (): ContainerMenuTarget => ({ type: 'dock', mode, row });
  const barMenu = {
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (isKeyboardContextMenu(event)) return;
      onMenu(target(), event.clientX, event.clientY);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (!isMenuKey(event)) return;
      event.preventDefault();
      event.stopPropagation();
      markKeyMenu();
      const { x, y } = keyMenuAnchor(event.currentTarget.getBoundingClientRect());
      onMenu(target(), x, y);
    },
  };

  const startReason = row ? actionUnavailable(row, 'start') : undefined;
  let body;
  if (terminalMode) {
    if (!isContainer) body = <p className="kube-placeholder">{ONLY_CONTAINERS}</p>;
    else if (!row) body = <p className="kube-placeholder">Wähle einen Container, um {terminalMode === 'shell' ? 'eine Shell zu öffnen' : 'Logs zu sehen'}.</p>;
    else if (terminalMode === 'shell' && !running) {
      body = (
        <div className="kube-placeholder">
          <p>Der Container läuft nicht.</p>
          <button type="button" className="primary-button" disabled={startReason !== undefined} title={startReason} onClick={() => onStart(row)}>Starten</button>
        </div>
      );
    } else if (terminalMode === 'shell' && !armed) {
      body = (
        <div className="kube-placeholder">
          <p>Die Shell startet erst auf Knopfdruck, damit Auswahlwechsel keine Verbindung öffnen.</p>
          <button type="button" className="primary-button" onClick={onArm}>Shell öffnen</button>
        </div>
      );
    } else if (terminalConnection) {
      // The key restarts the terminal for another container, mode or epoch; TerminalPanel ignores a new target otherwise.
      body = (
        <div className="kube-dock-terminal">
          <TerminalPanel key={dockTerminalKey(row, terminalMode, epoch)} connection={terminalConnection} tabId={`${tabId}:dock`}
            visible={visible && open} style={{ height: '100%' }} onStatusChange={ignoreStatus} onClose={noop} />
        </div>
      );
    }
  } else if (!row) body = <p className="kube-placeholder">Wähle eine Zeile.</p>;
  else if (!current) body = <p className="kube-placeholder">Lade …</p>;
  else if (current.error) body = <p className="kube-placeholder error-message">{current.error}</p>;
  else body = <pre className="kube-manifest">{current.text}</pre>;

  return (
    <section ref={dockRef} className={`kube-dock${open ? '' : ' kube-dock-collapsed'}`} style={open ? { height } : undefined} aria-label="Details">
      {open && (
        <div className="kube-dock-handle" role="separator" aria-orientation="horizontal" aria-label="Höhe ändern" onPointerDown={startResize} />
      )}
      <div className="kube-dock-bar" {...barMenu}>
        <div role="tablist" className="kube-dock-tabs">
          {DOCK_TABS.map(tab => {
            const off = tab.mode !== 'inspect' && !isContainer;
            return (
              <button key={tab.mode} type="button" role="tab" aria-selected={mode === tab.mode} disabled={off} title={off ? ONLY_CONTAINERS : undefined}
                className={mode === tab.mode ? 'kube-dock-tab kube-dock-tab-on' : 'kube-dock-tab'} onClick={() => onMode(tab.mode)}>
                {tab.label} <kbd>{tab.key}</kbd>
              </button>
            );
          })}
        </div>
        <span className="kube-muted kube-dock-hint">{row ? row.name : 'folgt Auswahl'}</span>
        {terminalConnection && onPopout && <button type="button" className="kube-dock-popout" onClick={onPopout}>Als Tab öffnen</button>}
        <button type="button" className="kube-dock-copy" disabled={nothingToCopy} title={nothingToCopy ? 'Nichts zu kopieren.' : undefined} onClick={copy}>Kopieren</button>
        <button type="button" className="kube-dock-toggle" aria-expanded={open} aria-label={open ? 'Panel einklappen' : 'Panel ausklappen'} onClick={onToggle}>
          {open ? '▾' : '▴'}
        </button>
      </div>
      <div className="kube-dock-body" hidden={!open}>{body}</div>
    </section>
  );
}
