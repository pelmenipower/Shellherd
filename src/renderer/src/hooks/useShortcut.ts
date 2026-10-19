import { useEffect, useRef } from 'react';
import { matchesShortcut } from '../shortcut-match';

function useCaptureShortcut(code: string, shift: boolean, allowRepeat: boolean, action: () => void): void {
  const ref = useRef(action);
  ref.current = action;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!matchesShortcut(event, { ctrl: true, shift, code })) return;
      event.preventDefault();
      event.stopPropagation();
      if (allowRepeat || !event.repeat) ref.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [code, shift, allowRepeat]);
}

/** Ctrl+Shift+<code>, capture phase, so terminals with focus do not swallow it; also fires on repeat. */
export function useCtrlShiftShortcut(code: string, action: () => void): void {
  useCaptureShortcut(code, true, true, action);
}

/** Ctrl+<code> without Shift/Alt, capture phase. Always swallows a match; the action runs only if !event.repeat. */
export function useCtrlShortcut(code: string, action: () => void): void {
  useCaptureShortcut(code, false, false, action);
}
