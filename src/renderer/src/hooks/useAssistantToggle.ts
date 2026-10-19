import { useCallback, useState } from 'react';
import { useCtrlShiftShortcut } from './useShortcut';

const KEY = 'terminus.assistantOpen';

/** Assistant visibility per window; Ctrl+Shift+K toggles it even while a terminal has focus. */
export function useAssistantToggle(): { open: boolean; setOpen: (open: boolean) => void; toggle: () => void } {
  const [open, setOpenState] = useState(() => { try { return localStorage.getItem(KEY) === 'on'; } catch { return false; } });
  const setOpen = useCallback((value: boolean) => {
    setOpenState(value);
    try { localStorage.setItem(KEY, value ? 'on' : 'off'); } catch { /* convenience only */ }
  }, []);
  const toggle = useCallback(() => setOpenState(current => {
    try { localStorage.setItem(KEY, current ? 'off' : 'on'); } catch { /* convenience only */ }
    return !current;
  }), []);
  useCtrlShiftShortcut('KeyK', toggle);
  return { open, setOpen, toggle };
}
