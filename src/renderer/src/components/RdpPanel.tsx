import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { AdoptedSession, TerminalConnection } from '../terminal-tabs';
import type { RdpStatus, ViewportRect } from '../../../shared/rdp';
import type { SshStatus } from '../../../shared/ssh';
import { useNativeSurfacesBlocked } from '../native-surface';
import { liveSessions } from '../session-registry';
import { errorText } from '../error-text';
import { useT } from '../i18n';

interface RdpPanelProps {
  connection: TerminalConnection;
  tabId: string;
  visible: boolean;
  focused?: boolean;
  style?: CSSProperties;
  onFocus?: () => void;
  onStatusChange: (id: string, status: SshStatus) => void;
  /** Session moved here from another window; no new connection is opened. */
  adopt?: AdoptedSession;
  initialStatus?: SshStatus;
}

const STATUS_KEYS = {
  connecting: 'terminal:rdp.status.connecting', connected: 'terminal:rdp.status.connected', closed: 'terminal:rdp.status.closed', error: 'terminal:rdp.status.error',
} as const satisfies Record<RdpStatus, string>;

/** Placeholder in the layout; the native RDP surface is positioned exactly over it by the main process. */
export function RdpPanel({ connection, tabId, visible, focused = true, style, onFocus, onStatusChange, adopt, initialStatus }: RdpPanelProps) {
  const { t } = useT();
  const container = useRef<HTMLDivElement>(null);
  const session = useRef<string | null>(null);
  const lastBounds = useRef('');
  const [status, setStatus] = useState<RdpStatus>(initialStatus ?? 'connecting');
  const adoptRef = useRef(adopt);
  const [message, setMessage] = useState<string | null>(null);
  const [resizing, setResizing] = useState(false);
  const blocked = useNativeSurfacesBlocked();
  const shown = visible && !blocked && !resizing && (status === 'connecting' || status === 'connected');
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
    const report = (next: RdpStatus, failure?: unknown): void => {
      if (disposed) return;
      setStatus(next); setMessage(failure ? errorText(failure) : null); onStatusChange(tabId, next);
    };
    const unsubscribe = window.desktopApi.onRdpEvent(event => {
      if (event.sessionId !== id || disposed) return;
      if (event.type === 'resizing') setResizing(event.active);
      else report(event.status, event.error);
    });
    const attach = (sessionId: string): void => {
      id = sessionId;
      session.current = id;
      liveSessions.set(tabId, { kind: 'rdp', sessionId: id });
    };
    // StrictMode mounts twice in development; only the surviving mount opens or adopts a session.
    const timer = setTimeout(() => {
      const adopted = adoptRef.current?.session;
      if (adopted) {
        attach(adopted.sessionId);
        lastBounds.current = '';
        syncRef.current();
        void window.desktopApi.rdpVisible({ sessionId: adopted.sessionId, visible: shownRef.current }).catch(() => {});
        return;
      }
      if (adoptRef.current) return;
      const bounds = measure();
      window.desktopApi.rdpOpen({ connectionId: connection.id, bounds, visible: shownRef.current }).then(result => {
        if (disposed) { void window.desktopApi.rdpClose(result).catch(() => {}); return; }
        attach(result.sessionId);
        lastBounds.current = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
        syncRef.current();
      }).catch((error: unknown) => report('error', error));
    }, 0);
    return () => {
      disposed = true;
      clearTimeout(timer);
      unsubscribe();
      session.current = null;
      liveSessions.delete(tabId);
      if (id && !liveSessions.takeTransferred(id)) void window.desktopApi.rdpClose({ sessionId: id }).catch(() => {});
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
      <span className="terminal-live-status" role="status">{t(STATUS_KEYS[status])}</span>
      <div ref={container} className="rdp-surface">
        {!shown && <p className="rdp-placeholder">{resizing ? t('terminal:rdp.resizing')
          : blocked && (status === 'connecting' || status === 'connected')
          ? t('terminal:rdp.hiddenWhileMenu') : message ?? t(STATUS_KEYS[status])}</p>}
      </div>
    </section>
  );
}
