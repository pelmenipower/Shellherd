import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import '@xterm/xterm/css/xterm.css';
import type { AdoptedSession, TerminalConnection } from '../terminal-tabs';
import { liveSessions } from '../session-registry';
import { terminalAccess } from '../terminal-access';
import type { SshStatus } from '../../../shared/ssh';

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
}

const statusLabels: Record<SshStatus, string> = {
  connecting: 'Verbindet ...', connected: 'Verbunden', closed: 'Verbindung beendet', error: 'Verbindung fehlgeschlagen',
};

export function TerminalPanel({ connection, tabId, visible, focused = true, style, onFocus, onStatusChange, adopt, initialStatus }: TerminalPanelProps) {
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const [status, setStatus] = useState<SshStatus>(initialStatus ?? 'connecting');
  const adoptRef = useRef(adopt);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let sessionId: string | undefined;
    let connected = false;
    const term = new Terminal({ cursorBlink: true, screenReaderMode: true, scrollback: 5000, fontSize: 14,
      fontFamily: 'Consolas, "Cascadia Mono", monospace', allowProposedApi: false,
      theme: { background: '#070b14', foreground: '#dce9f8', cursor: '#67e8f9', selectionBackground: '#164e63' } });
    const fit = new FitAddon();
    const serialize = new SerializeAddon();
    terminal.current = term;
    fitAddon.current = fit;
    term.loadAddon(fit);
    term.loadAddon(serialize);
    const access = terminalAccess(term);
    const register = (id: string): void => {
      sessionId = id;
      liveSessions.set(tabId, { kind: 'terminal', sessionId: id, snapshot: () => serialize.serialize({ scrollback: 5000 }), terminal: access });
    };
    term.open(container.current!);
    fit.fit();
    const showError = (message: string): void => { if (!disposed) setError(message); };
    let copyTimer: ReturnType<typeof setTimeout> | undefined;
    let copyQueue = Promise.resolve();
    let pendingSelection = '';
    const flushCopy = () => {
      clearTimeout(copyTimer); copyTimer = undefined;
      const text = pendingSelection; pendingSelection = '';
      if (text) copyQueue = copyQueue.then(() => window.desktopApi.writeClipboardText(text))
        .catch(() => showError('Der markierte Text konnte nicht kopiert werden.'));
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
      }).catch(() => showError('Die Zwischenablage konnte nicht eingefügt werden.'));
    };
    terminalElement.addEventListener('mousedown', preventRightMouse, true);
    terminalElement.addEventListener('contextmenu', pasteOnRightClick, true);
    const unsubscribe = window.desktopApi.onSshEvent(event => {
      if (disposed || event.sessionId !== sessionId) return;
      if (event.type === 'data') {
        term.write(new Uint8Array(event.data), () => {
          if (!disposed && sessionId) void window.desktopApi.sshAck({ sessionId, sequence: event.sequence }).catch(() => {});
        });
      } else {
        connected = event.status === 'connected';
        setStatus(event.status);
        onStatusChange(tabId, event.status);
        if (event.message) showError(event.message);
        if (connected && visibleRef.current && focusedRef.current) term.focus();
      }
    });
    let inputQueue = Promise.resolve();
    let pendingInputBytes = 0;
    const input = term.onData(data => {
      if (!sessionId || !connected) return;
      const bytes = new TextEncoder().encode(data).length;
      if (pendingInputBytes + bytes > 256 * 1024) {
        showError('Die Eingabe ist zu groß. Bitte füge kleinere Abschnitte ein.');
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
      }).catch(() => showError('Die Eingabe konnte nicht gesendet werden. Prüfe die Verbindung.'))
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
        void window.desktopApi.sshAttach({ sessionId: adopted.session.sessionId }).catch(() => showError('Die Sitzung konnte nicht übernommen werden.'));
        // The new window may have another size; a resize also makes full-screen programs redraw.
        void window.desktopApi.sshResize({ sessionId: adopted.session.sessionId, cols: Math.max(2, Math.min(500, term.cols)), rows: Math.max(1, Math.min(300, term.rows)) }).catch(() => {});
        if (connected && visibleRef.current && focusedRef.current) term.focus();
        return;
      }
      void (async () => {
        try {
          const result = await window.desktopApi.sshPrepare({ connectionId: connection.id,
            cols: Math.max(2, Math.min(500, term.cols)), rows: Math.max(1, Math.min(300, term.rows)) });
          if (disposed) { await window.desktopApi.sshClose({ sessionId: result.sessionId }); return; }
          register(result.sessionId);
          await window.desktopApi.sshConnect({ sessionId: result.sessionId });
        } catch (caught) {
          if (disposed) return;
          setStatus('error');
          onStatusChange(tabId, 'error');
          const message = caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Der SSH-Start ist fehlgeschlagen.';
          showError(message);
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
  }, [connection.id, tabId, onStatusChange]);

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      if (container.current?.clientWidth) fitAddon.current?.fit();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  return (
    <section className={`terminal-panel${focused ? ' focused-pane' : ''}`} style={style} onPointerDown={onFocus} onFocusCapture={onFocus} id={`terminal-${tabId}`} role="tabpanel" aria-labelledby={`tab-${tabId}`} hidden={!visible}>
      <span className="terminal-live-status" role="status">{statusLabels[status]}</span>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div ref={container} className="terminal-container" />
    </section>
  );
}
