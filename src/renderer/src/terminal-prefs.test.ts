import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DEFAULT_TERMINAL_SETTINGS } from '../../shared/vault/terminal-settings';
import { terminalPrefs, xtermOptions } from './terminal-prefs';

const next = { ...DEFAULT_TERMINAL_SETTINGS, fontSize: 18 };

describe('terminalPrefs', () => {
  beforeEach(() => terminalPrefs.set(DEFAULT_TERMINAL_SETTINGS));

  it('starts with the defaults', () => {
    expect(terminalPrefs.get()).toEqual(DEFAULT_TERMINAL_SETTINGS);
  });

  it('stores new values and notifies subscribers', () => {
    const listener = vi.fn();
    const off = terminalPrefs.subscribe(listener);
    terminalPrefs.set(next);
    expect(terminalPrefs.get()).toEqual(next);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it('does not notify when all fields are equal', () => {
    const listener = vi.fn();
    const off = terminalPrefs.subscribe(listener);
    terminalPrefs.set({ ...DEFAULT_TERMINAL_SETTINGS });
    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const off = terminalPrefs.subscribe(listener);
    off();
    terminalPrefs.set(next);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('xtermOptions', () => {
  it('maps the five fields and expands the font name', () => {
    expect(xtermOptions({ ...DEFAULT_TERMINAL_SETTINGS, fontFamily: ' Fira Code ', fontSize: 16, scrollback: 9000, cursorStyle: 'bar', cursorBlink: false })).toEqual({
      fontFamily: '"Fira Code", Consolas, "Cascadia Mono", monospace',
      fontSize: 16,
      scrollback: 9000,
      cursorStyle: 'bar',
      cursorBlink: false,
    });
  });

  it('uses the fallback chain for an empty font name', () => {
    expect(xtermOptions(DEFAULT_TERMINAL_SETTINGS).fontFamily).toBe('Consolas, "Cascadia Mono", monospace');
  });
});
