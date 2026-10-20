import { useEffect, useState, useSyncExternalStore } from 'react';
import './toast-ui.css';
import { useNativeSurfaceBlock } from '../native-surface';
import { noticeStore, type Notice } from '../notice-store';
import { useT } from '../i18n';

const EXIT_FALLBACK_MS = 300; // transitionend may not fire in a hidden window

/** Stack of notices. No focus change and no Escape handling: notices never interrupt typing (U5). */
export function ToastStack() {
  const notices = useSyncExternalStore(noticeStore.subscribe, noticeStore.getSnapshot);
  const [hovered, setHovered] = useState(false);
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  useNativeSurfaceBlock(notices.length > 0);
  const held = hovered || hidden;
  if (notices.length === 0) return <div className="toast-stack" hidden />;
  return (
    <div className={`toast-stack${held ? ' is-held' : ''}`}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {notices.map(notice => <ToastItem key={notice.id} notice={notice} paused={held} />)}
    </div>
  );
}

export function ToastItem({ notice, paused }: { notice: Notice; paused: boolean }) {
  const { id, tone, title, body, action, leaving } = notice;
  const { t } = useT();
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => noticeStore.remove(id), EXIT_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [leaving, id]);
  return (
    <div className={`toast${leaving ? ' is-closing' : ''}`} data-tone={tone} data-paused={paused || undefined}
      role={tone === 'error' ? 'alert' : 'status'}
      onTransitionEnd={event => { if (event.target === event.currentTarget && leaving && event.propertyName === 'opacity') noticeStore.remove(id); }}>
      <span className="toast-dot" aria-hidden="true" />
      <div className="toast-text">
        <strong className="toast-title">{title}</strong>
        {body && <span className="toast-body">{body}</span>}
      </div>
      {action && (
        <button type="button" className={`toast-action ${tone === 'error' ? 'danger-button' : 'secondary-button'}`}
          onClick={() => { noticeStore.close(id); action.run(); }}>{action.label}</button>
      )}
      <button type="button" className="toast-close" aria-label={t('app:toast.closeAria')} onClick={() => noticeStore.close(id)}>{t('common:actions.close')}</button>
      {tone !== 'error' && (
        <span className="toast-bar" aria-hidden="true" onAnimationEnd={() => noticeStore.close(id)} />
      )}
    </div>
  );
}
