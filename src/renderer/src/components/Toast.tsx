import { useEffect, useState } from 'react';
import './toast-ui.css';
import { useNativeSurfaceBlock } from '../native-surface';
import { EMPTY_TOAST, exitedToast, nextToast } from '../toast-state';
import { useT } from '../i18n';

const EXIT_FALLBACK_MS = 300; // transitionend may not fire in a hidden window

export function Toast({ message, onClose }: { message: string | null; onClose: () => void }) {
  const { t } = useT();
  const [state, setState] = useState(() => nextToast(EMPTY_TOAST, message));
  useEffect(() => { setState(current => nextToast(current, message)); }, [message]);
  useNativeSurfaceBlock(state.message !== null);
  useEffect(() => {
    if (!state.closing) return;
    const timer = setTimeout(() => setState(exitedToast), EXIT_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [state.closing]);
  if (!state.message) return null;
  return (
    <div className={`toast${state.closing ? ' is-closing' : ''}`} role="alert"
      onTransitionEnd={event => { if (event.target === event.currentTarget && state.closing && event.propertyName === 'opacity') setState(exitedToast); }}>
      <span>{state.message}</span>
      <button type="button" className="toast-close" aria-label={t('app:toast.closeAria')} onClick={onClose}>{t('common:actions.close')}</button>
    </div>
  );
}
