import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { TerminalConnection } from '../terminal-tabs';
import type { RdpStatus, ViewportRect } from '../../../shared/rdp';
import type { SshStatus } from '../../../shared/ssh';
import { useNativeSurfacesBlocked } from '../native-surface';

interface RdpPanelProps {
  connection: TerminalConnection;
  tabId: string;
  visible: boolean;
  focused?: boolean;
  style?: CSSProperties;
  onFocus?: () => void;
  onStatusChange: (id: string, status: SshStatus) => void;
}

const statusLabels: Record<RdpStatus, string> = {
  connecting: 'RDP verbindet ...', connected: 'RDP verbunden', closed: 'RDP-Verbindung beendet', error: 'RDP-Verbindung fehlgeschlagen',
};

/** Placeholder in the layout; the native RDP surface is positioned exactly over it by the main process. */
export function RdpPanel({ connection, tabId, visible, focused = true, style, onFocus, onStatusChange }: RdpPanelProps) {
  const container = useRef<HTMLDivElement>(null);
  const session = useRef<string | null>(null);
  const lastBounds = useRef('');
  const [status, setStatus] = useState<RdpStatus>('connecting');
  const [message, setMessage] = useState<string | null>(null);
  const blocked = useNativeSurfacesBlocked();
  const shown = visible && !blocked && (status === 'connecting' || status === 'connected');
  const shownRef = useRef(shown);
  shownRef.current = shown;

  const measure = (): ViewportRect => {
    const rect = container.current!.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  };
  const syncBounds = (): void => {
    if (!session.current || !container.current || !shownRef.current) return;
    const bounds = measure();
    const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
    if (key === lastBounds.current) return;
    lastBounds.current = key;
    void window.desktopApi.rdpBounds({ sessionId: session.current, bounds }).catch(() => {});
  };
  const syncRef = useRef(syncBounds);
  syncRef.current = syncBounds;

  useEffect(() => {
    let disposed = false;
    let id: string | null = null;
    const report = (next: RdpStatus, text?: string): void => {
      if (disposed) return;
      setStatus(next); setMessage(text ?? null); onStatusChange(tabId, next);
    };
    const unsubscribe = window.desktopApi.onRdpEvent(event => { if (event.sessionId === id) report(event.status, event.message); });
    // StrictMode mounts twice in development; only the surviving mount opens a session.
    const timer = setTimeout(() => {
      const bounds = measure();
      window.desktopApi.rdpOpen({ connectionId: connection.id, bounds, visible: shownRef.current }).then(result => {
        if (disposed) { void window.desktopApi.rdpClose(result).catch(() => {}); return; }
        id = result.sessionId;
        session.current = id;
        lastBounds.current = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
        syncRef.current();
      }).catch((error: Error) => report('error', error.message));
    }, 0);
    return () => {
      disposed = true;
      clearTimeout(timer);
      unsubscribe();
      session.current = null;
      if (id) void window.desktopApi.rdpClose({ sessionId: id }).catch(() => {});
    };
  }, [connection.id, tabId, onStatusChange]);

  // Layout changes re-render this panel (split ratio, docking, maximize); size changes from outside are observed.
  useLayoutEffect(() => syncRef.current());
  useEffect(() => {
    const sync = (): void => syncRef.current();
    const observer = new ResizeObserver(sync);
    observer.observe(container.current!);
    window.addEventListener('resize', sync);
    return () => { observer.disconnect(); window.removeEventListener('resize', sync); };
  }, []);

  useEffect(() => {
    if (!session.current) return;
    if (shown) { lastBounds.current = ''; syncRef.current(); }
    void window.desktopApi.rdpVisible({ sessionId: session.current, visible: shown }).catch(() => {});
  }, [shown]);

  useEffect(() => {
    if (shown && focused && session.current) void window.desktopApi.rdpFocus({ sessionId: session.current }).catch(() => {});
  }, [shown, focused]);

  return (
    <section className={`terminal-panel rdp-panel${focused ? ' focused-pane' : ''}`} style={style} onPointerDown={onFocus}
      id={`terminal-${tabId}`} role="tabpanel" aria-labelledby={`tab-${tabId}`} hidden={!visible}>
      <span className="terminal-live-status" role="status">{statusLabels[status]}</span>
      <div ref={container} className="rdp-surface">
        {!shown && <p className="rdp-placeholder">{blocked && (status === 'connecting' || status === 'connected')
          ? 'Remotedesktop ausgeblendet, solange ein Menü geöffnet ist.' : message ?? statusLabels[status]}</p>}
      </div>
    </section>
  );
}
