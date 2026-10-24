import type { ITerminalOptions } from '@xterm/xterm';
import { DEFAULT_TERMINAL_SETTINGS, xtermFontFamily } from '../../shared/vault/terminal-settings';
import type { TerminalSettings } from '../../shared/vault/types';

// Terminal look and limits of the open vault; panels read it on creation and follow changes live.
let current: TerminalSettings = DEFAULT_TERMINAL_SETTINGS;
const listeners = new Set<() => void>();

const sameSettings = (a: TerminalSettings, b: TerminalSettings): boolean =>
  a.fontFamily === b.fontFamily && a.fontSize === b.fontSize && a.scrollback === b.scrollback
  && a.cursorStyle === b.cursorStyle && a.cursorBlink === b.cursorBlink;

export const terminalPrefs = {
  get: (): TerminalSettings => current,
  /** No-op (no notification) when all five fields are equal. */
  set(next: TerminalSettings): void {
    if (sameSettings(current, next)) return;
    current = next;
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};

export type XtermPrefOptions = Pick<ITerminalOptions, 'fontFamily' | 'fontSize' | 'scrollback' | 'cursorStyle' | 'cursorBlink'>;

export function xtermOptions(prefs: TerminalSettings): XtermPrefOptions {
  return {
    fontFamily: xtermFontFamily(prefs.fontFamily),
    fontSize: prefs.fontSize,
    scrollback: prefs.scrollback,
    cursorStyle: prefs.cursorStyle,
    cursorBlink: prefs.cursorBlink,
  };
}
