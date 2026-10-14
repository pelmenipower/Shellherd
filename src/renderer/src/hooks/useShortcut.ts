import { useEffect, useRef } from 'react';

/** Ctrl+Shift+<code> in the capture phase, so terminals with focus do not swallow it. */
export function useCtrlShiftShortcut(code: string, action: () => void): void {
  const ref = useRef(action);
  ref.current = action;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.shiftKey && !event.altKey && event.code === code) { event.preventDefault(); event.stopPropagation(); ref.current(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [code]);
}
