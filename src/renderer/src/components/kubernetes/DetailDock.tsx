import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { KIND_COLUMNS, READ_ONLY_MESSAGE, refKey, type DockMode, type KubeDetail, type KubeDetailMode, type KubeRef, type KubeRow, type KubeTerminalMode, type KubeTerminalTarget } from '../../../../shared/kubernetes';
import type { TerminalConnection } from '../../terminal-tabs';
import { formatAge } from '../../kube-view';
import { TerminalPanel } from '../TerminalPanel';

const DOCK_TABS: { mode: DockMode; label: string; key: string }[] = [
  { mode: 'logs', label: 'Logs', key: 'l' },
  { mode: 'shell', label: 'Shell', key: 's' },
  { mode: 'events', label: 'Events', key: 'e' },
  { mode: 'yaml', label: 'YAML', key: 'y' },
  { mode: 'describe', label: 'Describe', key: 'd' },
];
const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 260;
/** Stable identity: TerminalPanel's effect depends on it, so a new function would reconnect. */
const ignoreStatus = (): void => {};
const noop = (): void => {};

interface DetailDockProps {
  connection: TerminalConnection;
  tabId: string;
  visible: boolean;
  open: boolean;
  mode: DockMode;
  /** Logs of the previous container instance (key `p`). */
  previous: boolean;
  /** Shell was started by `s` or the button; selection moves never start it. */
  armed: boolean;
  /** Selected row, for Events, YAML and Describe. */
  selected: KubeRef | null;
  /** The pod whose logs or shell are shown, and its container. */
  podRef: KubeRef | null;
  container: string | null;
  readOnly: boolean;
  detail: (ref: KubeRef, mode: KubeDetailMode) => Promise<KubeDetail>;
  onMode: (mode: DockMode) => void;
  onArm: () => void;
  onToggle: () => void;
  /** Absent where no tab can be opened. */
  onPopout?: (() => void) | undefined;
  /** Changes when the connection came back; remounts the log or shell terminal. */
  epoch: number;
}

type DetailResult = { id: string; data?: KubeDetail; error?: string };

/** Bottom dock: logs and shell as embedded terminal, events and manifests as text. Follows the selection. */
export function DetailDock(props: DetailDockProps) {
  const { connection, tabId, visible, open, mode, previous, armed, selected, podRef, container, readOnly, detail, onMode, onArm, onToggle, onPopout, epoch } = props;
  const dockRef = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [result, setResult] = useState<DetailResult | null>(null);
  const selectedKey = selected ? refKey(selected) : null;
  const detailMode: KubeDetailMode | null = mode === 'events' || mode === 'yaml' || mode === 'describe' ? mode : null;
  const resultId = detailMode && selectedKey ? `${detailMode}|${selectedKey}` : null;

  // Events, YAML and Describe are fetched when the selection or the mode changes.
  useEffect(() => {
    if (!open || !detailMode || !selected || !resultId) return;
    let cancelled = false;
    detail(selected, detailMode).then(
      data => { if (!cancelled) setResult({ id: resultId, data }); },
      caught => { if (!cancelled) setResult({ id: resultId, error: caught instanceof Error ? caught.message : 'Die Ansicht konnte nicht geladen werden.' }); },
    );
    return () => { cancelled = true; };
    // resultId stands for `selected`: a new row object with the same key is the same request.
  }, [open, detailMode, selectedKey, resultId, detail]);

  const terminalKind: KubeTerminalMode | null = mode === 'logs' ? (previous ? 'previous' : 'logs') : mode === 'shell' ? 'shell' : null;
  const target: KubeTerminalTarget | null = terminalKind && podRef && container
    ? { namespace: podRef.namespace ?? '', pod: podRef.name, container, mode: terminalKind }
    : null;
  const terminalConnection: TerminalConnection | null = target ? { ...connection, kube: target } : null;

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

  const currentResult = result?.id === resultId ? result : null;

  return (
    <section ref={dockRef} className={`kube-dock${open ? '' : ' kube-dock-collapsed'}`} style={open ? { height } : undefined} aria-label="Details">
      {open && (
        <div className="kube-dock-handle" role="separator" aria-orientation="horizontal" aria-label="Höhe ändern" onPointerDown={startResize} />
      )}
      <div className="kube-dock-bar">
        <div role="tablist" className="kube-dock-tabs">
          {DOCK_TABS.map(tab => (
            <button key={tab.mode} type="button" role="tab" aria-selected={mode === tab.mode} className={mode === tab.mode ? 'kube-dock-tab kube-dock-tab-on' : 'kube-dock-tab'}
              onClick={() => onMode(tab.mode)}>
              {tab.label} <kbd>{tab.key}</kbd>
            </button>
          ))}
        </div>
        <span className="kube-muted kube-dock-hint">{selected ? refKey(selected).split('/').pop() : 'folgt Auswahl'}</span>
        {terminalKind && target && onPopout && (
          <button type="button" className="kube-dock-popout" onClick={onPopout}>Als Tab öffnen</button>
        )}
        <button type="button" className="kube-dock-toggle" aria-expanded={open} aria-label={open ? 'Panel einklappen' : 'Panel ausklappen'} onClick={onToggle}>
          {open ? '▾' : '▴'}
        </button>
      </div>
      <div className="kube-dock-body" hidden={!open}>
        {terminalKind ? (
          !podRef ? <p className="kube-placeholder">Wähle einen Pod, um {terminalKind === 'shell' ? 'eine Shell' : 'Logs'} zu sehen.</p>
          : !container ? <p className="kube-placeholder">Dieser Pod hat keinen Container.</p>
          : terminalKind === 'shell' && !armed ? (
            <div className="kube-placeholder">
              <p>Die Shell startet erst auf Knopfdruck, damit Auswahlwechsel keine Verbindung öffnen.</p>
              <button type="button" className="primary-button" disabled={readOnly} title={readOnly ? READ_ONLY_MESSAGE : undefined} onClick={onArm}>
                Shell öffnen
              </button>
              {readOnly && <p className="kube-muted">{READ_ONLY_MESSAGE}</p>}
            </div>
          ) : terminalConnection && target && (
            <div className="kube-dock-terminal">
              <TerminalPanel key={`${refKey(podRef)}/${container}/${terminalKind}/${epoch}`} connection={terminalConnection} tabId={`${tabId}:dock`}
                visible={visible && open} style={{ height: '100%' }} onStatusChange={ignoreStatus} onClose={noop} />
            </div>
          )
        ) : !selected ? <p className="kube-placeholder">Wähle eine Zeile.</p>
        : !currentResult ? <p className="kube-placeholder">Lade …</p>
        : currentResult.error ? <p className="kube-placeholder error-message">{currentResult.error}</p>
        : currentResult.data?.mode === 'events' ? <EventsTable rows={currentResult.data.rows} />
        : currentResult.data ? <pre className="kube-manifest">{currentResult.data.text}</pre>
        : null}
      </div>
    </section>
  );
}

function EventsTable({ rows }: { rows: KubeRow[] }) {
  const columns = KIND_COLUMNS.events;
  const now = Date.now();
  if (rows.length === 0) return <p className="kube-placeholder">Keine Ereignisse.</p>;
  return (
    <table className="kube-table kube-events">
      <thead>
        <tr>{columns.map(column => <th key={column.key}>{column.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.uid} className={`kube-tone-${row.tone}`}>
            {columns.map(column => {
              const value = row.cells[column.key];
              return <td key={column.key}>{column.age ? formatAge(String(value ?? ''), now) : String(value ?? '–')}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
