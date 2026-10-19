import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { KIND_COLUMNS, refKey, type DockMode, type KubeDetail, type KubeDetailMode, type KubeRef, type KubeRow, type KubeTerminalMode, type KubeTerminalTarget } from '../../../../shared/kubernetes';
import { errorText } from '../../error-text';
import { useT } from '../../i18n';
import { columnLabel } from '../../kube-labels';
import type { TerminalConnection } from '../../terminal-tabs';
import { dockTerminalKey, formatAge } from '../../kube-view';
import { TerminalPanel } from '../TerminalPanel';
import '../../kubernetes-dock.css';
import { liveSessions } from '../../session-registry';
import { capText, eventsTsv } from '../../kube-copy';
import { isKeyboardContextMenu, isMenuKey, menuHandlers, type MenuOpener } from '../../kube-menu-trigger';

const DOCK_TABS: { mode: DockMode; key: string }[] = [
  { mode: 'logs', key: 'l' },
  { mode: 'shell', key: 's' },
  { mode: 'events', key: 'e' },
  { mode: 'yaml', key: 'y' },
  { mode: 'describe', key: 'd' },
];
const DOCK_TAB_LABEL_KEYS = {
  logs: 'kubernetes:dock.tabs.logs', shell: 'kubernetes:dock.tabs.shell', events: 'kubernetes:dock.tabs.events',
  yaml: 'kubernetes:dock.tabs.yaml', describe: 'kubernetes:dock.tabs.describe',
} as const satisfies Record<DockMode, string>;
const MAX_COPY_CHARS = 4 * 1024 * 1024 - 1024;
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
  /** Full pod row, for the container entries of the dock menu (C12). */
  podRow?: KubeRow | null;
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
  onMenu?: MenuOpener;
  /** Log format of the dock's log streams. */
  logFormat: 'compact' | 'raw';
  onLogFormat: (format: 'compact' | 'raw') => void;
  /** Puts `text` on the clipboard and reports it; `label` names the content in the status line. */
  onCopy: (text: string, label: string, info?: { lines?: number; shortened?: boolean }) => void;
  /** Reports a status line (nothing to copy). */
  onSay: (message: string) => void;
}

type DetailResult = { id: string; data?: KubeDetail; error?: string };

/** Bottom dock: logs and shell as embedded terminal, events and manifests as text. Follows the selection. */
export function DetailDock(props: DetailDockProps) {
  const { connection, tabId, visible, open, mode, previous, armed, selected, podRef, podRow, container, readOnly, detail, onMode, onArm, onToggle, onPopout, epoch, onMenu, logFormat, onLogFormat, onCopy, onSay } = props;
  const { t } = useT();
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
      caught => { if (!cancelled) setResult({ id: resultId, error: errorText(caught, t('kubernetes:dock.loadFailed')) }); },
    );
    return () => { cancelled = true; };
    // resultId stands for `selected`: a new row object with the same key is the same request.
  }, [open, detailMode, selectedKey, resultId, detail, t]);

  const terminalKind: KubeTerminalMode | null = mode === 'logs' ? (previous ? 'previous' : 'logs') : mode === 'shell' ? 'shell' : null;
  const target: KubeTerminalTarget | null = terminalKind && podRef && container
    ? { namespace: podRef.namespace ?? '', pod: podRef.name, container, mode: terminalKind, ...(terminalKind !== 'shell' && logFormat === 'raw' ? { format: 'raw' as const } : {}) }
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

  const shellWaiting = terminalKind === 'shell' && !armed;
  const copyLabel = terminalKind === 'previous' ? t('kubernetes:dock.previousLogs') : t(DOCK_TAB_LABEL_KEYS[mode]);
  const copyText = (): string => {
    if (terminalKind) return liveSessions.get(`${tabId}:dock`)?.terminal?.allText(5000) ?? '';
    const data = currentResult?.data;
    if (data?.mode === 'events') return eventsTsv(data.rows, Date.now());
    return data?.text ?? '';
  };
  const nothingToCopy = terminalKind ? !target || shellWaiting : !currentResult?.data || (currentResult.data.mode === 'events' ? currentResult.data.rows.length === 0 : currentResult.data.text === '');
  const copy = () => {
    const full = copyText();
    if (full.trim() === '') { onSay(t('kubernetes:dock.nothingToCopy')); return; }
    // The clipboard IPC rejects over 4 MiB: keep the newest part and say so.
    const { text, shortened } = capText(full, MAX_COPY_CHARS);
    onCopy(text, copyLabel, { ...(currentResult?.data?.mode === 'events' && !terminalKind ? { lines: currentResult.data.rows.length } : {}), ...(shortened ? { shortened } : {}) });
  };

  return (
    <section ref={dockRef} className={`kube-dock${open ? '' : ' kube-dock-collapsed'}`} style={open ? { height } : undefined} aria-label={t('kubernetes:dock.label')}>
      {open && (
        <div className="kube-dock-handle" role="separator" aria-orientation="horizontal" aria-label={t('kubernetes:dock.resize')} onPointerDown={startResize} />
      )}
      <div className="kube-dock-bar" {...menuHandlers(onMenu, { type: 'dock', mode, pod: podRow ?? null, container, previous })}>
        <div role="tablist" className="kube-dock-tabs">
          {DOCK_TABS.map(tab => (
            <button key={tab.mode} type="button" role="tab" aria-selected={mode === tab.mode} className={mode === tab.mode ? 'kube-dock-tab kube-dock-tab-on' : 'kube-dock-tab'}
              onClick={() => onMode(tab.mode)}>
              {t(DOCK_TAB_LABEL_KEYS[tab.mode])} <kbd>{tab.key}</kbd>
            </button>
          ))}
        </div>
        <span className="kube-muted kube-dock-hint">{selected ? refKey(selected).split('/').pop() : t('kubernetes:dock.followsSelection')}</span>
        {terminalKind && target && onPopout && (
          <button type="button" className="kube-dock-popout" onClick={onPopout}>{t('kubernetes:dock.popout')}</button>
        )}
        {(terminalKind === 'logs' || terminalKind === 'previous') && (
          <div className="kube-dock-format" role="group" aria-label={t('kubernetes:dock.logFormat')}>
            <button type="button" aria-pressed={logFormat === 'compact'} onClick={() => onLogFormat('compact')}>{t('kubernetes:dock.compact')}</button>
            <button type="button" aria-pressed={logFormat === 'raw'} onClick={() => onLogFormat('raw')}>{t('kubernetes:dock.raw')}</button>
          </div>
        )}
        <button type="button" className="kube-dock-copy" disabled={nothingToCopy} title={nothingToCopy ? t('kubernetes:dock.nothingToCopy') : undefined} onClick={copy}>{t('common:actions.copy')}</button>
        <button type="button" className="kube-dock-toggle" aria-expanded={open} aria-label={open ? t('kubernetes:dock.collapse') : t('kubernetes:dock.expand')} onClick={onToggle}>
          <svg className={`chevron${!open ? ' is-up' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 9 7 7 7-7" /></svg>
        </button>
      </div>
      <div className="kube-dock-body" hidden={!open}>
        {terminalKind ? (
          !podRef ? <p className="kube-placeholder">{terminalKind === 'shell' ? t('kubernetes:dock.selectPodForShell') : t('kubernetes:dock.selectPodForLogs')}</p>
          : !container ? <p className="kube-placeholder">{t('kubernetes:dock.noContainer')}</p>
          : terminalKind === 'shell' && !armed ? (
            <div className="kube-placeholder">
              <p>{t('kubernetes:dock.shellOnDemand')}</p>
              <button type="button" className="primary-button" disabled={readOnly} title={readOnly ? t('errors:kubernetes.readOnly') : undefined} onClick={onArm}>
                {t('kubernetes:dock.openShell')}
              </button>
              {readOnly && <p className="kube-muted">{t('errors:kubernetes.readOnly')}</p>}
            </div>
          ) : terminalConnection && target && (
            <div className="kube-dock-terminal">
              <TerminalPanel key={dockTerminalKey(refKey(podRef), container, terminalKind, epoch, target.format ?? 'compact')} connection={terminalConnection} tabId={`${tabId}:dock`}
                visible={visible && open} style={{ height: '100%' }} onStatusChange={ignoreStatus} onClose={noop} embedded />
            </div>
          )
        ) : !selected ? <p className="kube-placeholder">{t('kubernetes:dock.selectRow')}</p>
        : !currentResult ? <p className="kube-placeholder">{t('kubernetes:loading')}</p>
        : currentResult.error ? <p className="kube-placeholder error-message">{currentResult.error}</p>
        : currentResult.data?.mode === 'events' ? <EventsTable rows={currentResult.data.rows} onMenu={onMenu} />
        : currentResult.data ? <ManifestText mode={currentResult.data.mode} text={currentResult.data.text} onMenu={onMenu} />
        : null}
      </div>
    </section>
  );
}

function ManifestText({ mode, text, onMenu }: { mode: KubeDetail['mode']; text: string; onMenu: MenuOpener | undefined }) {
  if (mode !== 'yaml' && mode !== 'describe') return <pre className="kube-manifest">{text}</pre>;
  return (
    <pre className="kube-manifest" tabIndex={0}
      onContextMenu={event => {
        if (!onMenu) return;
        event.preventDefault();
        event.stopPropagation();
        if (isKeyboardContextMenu(event)) return;
        onMenu({ type: 'dockText', mode, text, selection: window.getSelection()?.toString() ?? '' }, event.clientX, event.clientY);
      }}
      onKeyDown={event => {
        if (!isMenuKey(event)) return;
        menuHandlers(onMenu, { type: 'dockText', mode, text, selection: window.getSelection()?.toString() ?? '' }).onKeyDown(event);
      }}>{text}</pre>
  );
}

function EventsTable({ rows, onMenu }: { rows: KubeRow[]; onMenu: MenuOpener | undefined }) {
  const { t } = useT();
  const columns = KIND_COLUMNS.events;
  const now = Date.now();
  if (rows.length === 0) return <p className="kube-placeholder">{t('kubernetes:dock.noEvents')}</p>;
  return (
    <table className="kube-table kube-events">
      <thead>
        <tr>{columns.map(column => <th key={column.key}>{columnLabel(column.key)}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.uid} className={`kube-tone-${row.tone}`} tabIndex={onMenu ? 0 : undefined} {...menuHandlers(onMenu, { type: 'dockEvent', row })}>
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
