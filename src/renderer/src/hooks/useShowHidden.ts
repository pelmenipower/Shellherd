import { useState } from 'react';
import type { FileSide } from '../file-browser';

const KEYS = { local: 'shellherd.files.showHidden.local', remote: 'shellherd.files.showHidden.remote' } as const satisfies Record<FileSide, string>;

/** Dot names per side and profile; shown unless turned off (the behaviour before 0.23.0). */
export function useShowHidden(side: FileSide): [boolean, () => void] {
  const [show, setShow] = useState(() => { try { return localStorage.getItem(KEYS[side]) !== 'off'; } catch { return true; } });
  const toggle = (): void => {
    const next = !show;
    setShow(next);
    try { localStorage.setItem(KEYS[side], next ? 'on' : 'off'); } catch { /* convenience only */ }
  };
  return [show, toggle];
}
