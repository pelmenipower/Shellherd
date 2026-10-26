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

/** Ctrl+Shift+<code>, capture phase, so terminals with focus do not swallow it; fires on repeat unless allowRepeat is false. */
export function useCtrlShiftShortcut(code: string, action: () => void, allowRepeat = true): void {
  useCaptureShortcut(code, true, allowRepeat, action);
}

/** Ctrl+<code> without Shift/Alt, capture phase. Always swallows a match; the action runs on repeat only if allowRepeat. */
export function useCtrlShortcut(code: string, action: () => void, allowRepeat = false): void {
  useCaptureShortcut(code, false, allowRepeat, action);
}
