import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import '@xterm/xterm/css/xterm.css';
import type { AdoptedSession, TerminalConnection } from '../terminal-tabs';
import { liveSessions } from '../session-registry';
import { terminalAccess } from '../terminal-access';
import { xtermTheme } from '../terminal-theme';
import { useT } from '../i18n';
import { codedFrom } from '../../../shared/errors';
import type { CodedError } from '../../../shared/errors';
import type { SshStatus, SshStep } from '../../../shared/ssh';
import type { ConnectionErrorCode } from '../../../shared/connection-errors';
import { LOCAL_CONTAINER_HOST } from '../../../shared/containers';
import { WAIT_MS } from '../connect-timeline';
import type { StepMark } from '../connect-timeline';
import { notify } from '../notice-store';
import { statusWord } from '../status-words';
import { ConnectingCard } from './ConnectingCard';
import { ConnectionErrorCard } from './ConnectionErrorCard';
import { DisconnectedBar, type DisconnectReason } from './DisconnectedBar';

interface TerminalPanelProps {
  connection: TerminalConnection;
  tabId: string;
  visible: boolean;
  focused?: boolean;
  style?: CSSProperties;
  onFocus?: () => void;
  onStatusChange: (id: string, status: SshStatus) => void;
  onClose: () => void;
  onDrag?: (id: string | null) => void;
  /** Session moved here from another window; its screen is restored from the snapshot. */
  adopt?: AdoptedSession;
  initialStatus?: SshStatus;
  /** Dock terminals: the connection cards never take focus. */
  embedded?: boolean;
  /** A new value starts one attempt without the login block; 0 or a value seen at mount does nothing. */
  reconnectPlain?: number;
}

interface Failure { code: ConnectionErrorCode; error?: CodedError }
interface Closed { reason: DisconnectReason; endedAt: number }

const SSH2_STEPS: readonly SshStep[] = ['reach', 'hostkey', 'auth', 'shell'];
const SHELL_STEPS: readonly SshStep[] = ['shell'];

export function TerminalPanel({ connection, tabId, visible, focused = true, style, onFocus, onStatusChange, adopt, initialStatus, embedded = false, reconnectPlain }: TerminalPanelProps) {
  const { t } = useT();
  // The session effect must not restart on a language change, so it reads the latest translator here.
  const tRef = useRef(t);
  tRef.current = t;
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const [status, setStatus] = useState<SshStatus>(initialStatus ?? 'connecting');
  const adoptRef = useRef(adopt);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [closed, setClosed] = useState<Closed | null>(null);
  const [marks, setMarks] = useState<StepMark[]>([]);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [attempt, setAttempt] = useState(0);
  // The attempt number that runs without the login block; later attempts log in again.
  const plainAttempt = useRef(-1);
  const seenPlain = useRef(reconnectPlain ?? 0);
  useEffect(() => {
    if (!reconnectPlain || reconnectPlain === seenPlain.current) return;
    seenPlain.current = reconnectPlain;
    adoptRef.current = undefined;
    setAttempt(value => { plainAttempt.current = value + 1; return value + 1; });
  }, [reconnectPlain]);
  const [showCard, setShowCard] = useState(false);
  // Session id of the running attempt, and whether the user cancelled it (also before the id is known).
  const sessionRef = useRef<string | undefined>(undefined);
  const cancelledRef = useRef(false);
  // A new kube target (another pod, container or mode) reconnects; the key only remounts the panel.
  const kubeKey = connection.kube ? JSON.stringify(connection.kube) : '';

  useEffect(() => {
    let disposed = false;
    let sessionId: string | undefined;
    let connected = false;
    const skipLogin = plainAttempt.current === attempt;
    cancelledRef.current = false;
    sessionRef.current = undefined;
    if (attempt > 0) {
      setFailure(null); setClosed(null); setMarks([]); setStartedAt(Date.now());
      setStatus('connecting');
      onStatusChange(tabId, 'connecting');
    }
    const styles = getComputedStyle(document.documentElement);
    const term = new Terminal({ cursorBlink: true, screenReaderMode: true, scrollback: 5000, fontSize: 14,
      fontFamily: 'Consolas, "Cascadia Mono", monospace', allowProposedApi: false,
      theme: xtermTheme(name => styles.getPropertyValue(name)) });
    const fit = new FitAddon();
    const serialize = new SerializeAddon();
    terminal.current = term;
    fitAddon.current = fit;
    term.loadAddon(fit);
    term.loadAddon(serialize);
    const access = terminalAccess(term);
    const register = (id: string): void => {
      sessionId = id;
      sessionRef.current = id;
      liveSessions.set(tabId, { kind: 'terminal', sessionId: id, snapshot: () => serialize.serialize({ scrollback: 5000 }), terminal: access });
    };
    term.open(container.current!);
    fit.fit();
    const report = (show: () => void): void => { if (!disposed) show(); };
    let copyTimer: ReturnType<typeof setTimeout> | undefined;
    let copyQueue = Promise.resolve();
    let pendingSelection = '';
    const flushCopy = () => {
      clearTimeout(copyTimer); copyTimer = undefined;
      const text = pendingSelection; pendingSelection = '';
      if (text) copyQueue = copyQueue.then(() => window.desktopApi.writeClipboardText(text))
        .catch(() => report(() => notify.error(tRef.current('terminal:panel.copyFailedTitle'), { body: tRef.current('terminal:panel.copyFailed') })));
      return copyQueue;
    };
    const selection = term.onSelectionChange(() => {
      const text = term.getSelection();
      if (!text || !visibleRef.current) return;
      pendingSelection = text;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => { void flushCopy(); }, 80);
    });
    const terminalElement = container.current!;
    const preventRightMouse = (event: MouseEvent) => {
      if (event.button === 2) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const pasteOnRightClick = (event: MouseEvent) => {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!connected || disposed) return;
      term.focus();
      void flushCopy().then(() => window.desktopApi.readClipboardText()).then(text => {
        if (!disposed && connected && text) term.paste(text);
      }).catch(() => report(() => notify.error(tRef.current('terminal:panel.pasteFailedTitle'), { body: tRef.current('terminal:panel.pasteFailed') })));
    };
    terminalElement.addEventListener('mousedown', preventRightMouse, true);
    terminalElement.addEventListener('contextmenu', pasteOnRightClick, true);
    const unsubscribe = window.desktopApi.onSshEvent(event => {
      if (disposed || event.sessionId !== sessionId) return;
      if (event.type === 'data') {
        term.write(new Uint8Array(event.data), () => {
          if (!disposed && sessionId) void window.desktopApi.sshAck({ sessionId, sequence: event.sequence }).catch(() => {});
        });
      } else if (event.type === 'step') {
        setMarks(previous => [...previous, { step: event.step, at: Date.now() }]);
      } else if (event.type === 'status') {
        // After cancelling, only the end of the session counts; a late 'connected' must not hide the bar.
        if (cancelledRef.current && event.status !== 'closed' && event.status !== 'error') return;
        connected = event.status === 'connected';
        setStatus(event.status);
        onStatusChange(tabId, event.status);
        if (event.status === 'error') setFailure({ code: event.code ?? 'unknown', ...(event.error ? { error: event.error } : {}) });
        if (event.status === 'closed') {
          const reason: DisconnectReason = cancelledRef.current ? 'cancel' : event.code === 'closed-by-server' ? 'server' : event.code === 'idle' ? 'idle' : 'session';
          setClosed(previous => (previous?.reason === 'cancel' ? previous : { reason, endedAt: Date.now() }));
        }
        if (connected && visibleRef.current && focusedRef.current) term.focus();
      }
    });
    let inputQueue = Promise.resolve();
    let pendingInputBytes = 0;
    const input = term.onData(data => {
      if (!sessionId || !connected) return;
      const bytes = new TextEncoder().encode(data).length;
      if (pendingInputBytes + bytes > 256 * 1024) {
        notify.info(tRef.current('terminal:panel.inputTooLargeTitle'), { body: tRef.current('terminal:panel.inputTooLarge') });
        return;
      }
      pendingInputBytes += bytes;
      // Serialize paste chunks, preserving Unicode and socket backpressure.
      inputQueue = inputQueue.then(async () => {
        const chunks = data.match(/[\s\S]{1,4096}/gu) ?? [];
        for (const chunk of chunks) {
          if (disposed || !connected || !sessionId) return;
          await window.desktopApi.sshInput({ sessionId, data: chunk });
        }
      }).catch(() => report(() => notify.error(tRef.current('terminal:panel.inputFailedTitle'), { body: tRef.current('terminal:panel.inputFailed') })))
        .finally(() => { pendingInputBytes -= bytes; });
    });
    const resize = term.onResize(size => {
      if (sessionId) void window.desktopApi.sshResize({ sessionId, cols: Math.min(500, size.cols), rows: Math.min(300, size.rows) }).catch(() => {});
    });
    const observer = new ResizeObserver(() => { if (!disposed && container.current?.clientWidth) fit.fit(); });
    observer.observe(container.current!);
    // Defer network work so StrictMode's setup/cleanup probe creates no SSH session.
    const startTimer = setTimeout(() => {
      const adopted = adoptRef.current;
      if (adopted) {
        if (adopted.snapshot) term.write(adopted.snapshot);
        if (!adopted.session) return;
        register(adopted.session.sessionId);
        connected = (initialStatus ?? 'connecting') === 'connected';
        void window.desktopApi.sshAttach({ sessionId: adopted.session.sessionId }).catch(() => report(() => {
          setFailure({ code: 'unknown', error: { code: 'ssh.adoptFailed' } });
          setStatus('error');
          onStatusChange(tabId, 'error');
        }));
        // The new window may have another size; a resize also makes full-screen programs redraw.
        void window.desktopApi.sshResize({ sessionId: adopted.session.sessionId, cols: Math.max(2, Math.min(500, term.cols)), rows: Math.max(1, Math.min(300, term.rows)) }).catch(() => {});
        if (connected && visibleRef.current && focusedRef.current) term.focus();
        return;
      }
      void (async () => {
        try {
          const result = await window.desktopApi.sshPrepare({ connectionId: connection.id, ...(connection.target ? { target: connection.target } : {}),
            ...(connection.kube ? { kube: connection.kube } : {}), ...(skipLogin ? { skipLogin: true } : {}),
            cols: Math.max(2, Math.min(500, term.cols)), rows: Math.max(1, Math.min(300, term.rows)) });
          if (disposed || cancelledRef.current) { await window.desktopApi.sshClose({ sessionId: result.sessionId }); return; }
          register(result.sessionId);
          await window.desktopApi.sshConnect({ sessionId: result.sessionId });
        } catch (caught) {
          if (disposed || cancelledRef.current) return;
          setStatus('error');
          onStatusChange(tabId, 'error');
          const coded = codedFrom(caught, 'ssh.startFailed');
          setFailure({ code: coded.code === 'ssh.sessionLimit' || coded.code === 'core.rdpSessionLimit' ? 'limit' : 'unknown', error: coded });
          if (sessionId) void window.desktopApi.sshClose({ sessionId }).catch(() => {});
        }
      })();
    }, 0);
    return () => {
      disposed = true;
      clearTimeout(startTimer);
      clearTimeout(copyTimer);
      selection.dispose();
      terminalElement.removeEventListener('mousedown', preventRightMouse, true);
      terminalElement.removeEventListener('contextmenu', pasteOnRightClick, true);
      unsubscribe();
      observer.disconnect();
      input.dispose();
      resize.dispose();
      access.dispose();
      term.dispose();
      terminal.current = null;
      fitAddon.current = null;
      liveSessions.delete(tabId);
      if (sessionId && !liveSessions.takeTransferred(sessionId)) void window.desktopApi.sshClose({ sessionId }).catch(() => {});
    };
  }, [connection.id, kubeKey, tabId, onStatusChange, attempt]);

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      if (container.current?.clientWidth) fitAddon.current?.fit();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  // The connecting card is a waiting indicator: it shows only when connecting takes longer than WAIT_MS.
  useEffect(() => {
    if (status !== 'connecting') { setShowCard(false); return; }
    const remaining = WAIT_MS - (Date.now() - startedAt);
    if (remaining <= 0) { setShowCard(true); return; }
    setShowCard(false);
    const timer = setTimeout(() => setShowCard(true), remaining);
    return () => clearTimeout(timer);
  }, [status, startedAt, attempt]);

  const reconnect = (): void => {
    adoptRef.current = undefined;
    setAttempt(value => value + 1);
  };
  const cancel = (): void => {
    cancelledRef.current = true;
    setClosed({ reason: 'cancel', endedAt: Date.now() });
    setStatus('closed');
    onStatusChange(tabId, 'closed');
    const id = sessionRef.current;
    if (id) void window.desktopApi.sshClose({ sessionId: id }).catch(() => {});
  };
  const cardActive = focused && visible && !embedded;
  const steps = connection.protocol === 'ssh' && !connection.kube && connection.id !== LOCAL_CONTAINER_HOST ? SSH2_STEPS : SHELL_STEPS;
  const remote = (connection.protocol === 'ssh' || connection.protocol === 'sftp' || connection.protocol === 'rdp') && connection.id !== LOCAL_CONTAINER_HOST;

  return (
    <section className={`terminal-panel${focused ? ' focused-pane' : ''}`} style={style} onPointerDown={onFocus} onFocusCapture={onFocus} id={`terminal-${tabId}`} role="tabpanel" aria-labelledby={`tab-${tabId}`} hidden={!visible}>
      <span className="terminal-live-status" role="status">{statusWord(status, 'long', { name: connection.name })}</span>
      <div ref={container} className="terminal-container" />
      {status === 'connecting' && showCard && (
        <ConnectingCard name={connection.name} address={connection.address} steps={steps} marks={marks} startedAt={startedAt}
          active={cardActive} ticking={visible} onCancel={cancel} />
      )}
      {status === 'error' && (
        <ConnectionErrorCard connectionId={connection.id} code={failure?.code ?? 'unknown'} name={connection.name} address={connection.address}
          remote={remote} error={failure?.error} active={cardActive} onRetry={reconnect} />
      )}
      {status === 'closed' && (
        <DisconnectedBar reason={closed?.reason ?? 'session'} endedAt={closed?.endedAt ?? startedAt} active={cardActive} ticking={visible} onReconnect={reconnect} />
      )}
    </section>
  );
}
