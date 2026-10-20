import { describe, expect, it } from 'vitest';
import { matchesShortcut, settingsShortcutAction } from './shortcut-match';

const ev = (init: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; code: string }>) =>
  ({ ctrlKey: false, shiftKey: false, altKey: false, code: '', ...init });
const comma = { ctrl: true, shift: false, code: 'Comma' };

describe('matchesShortcut', () => {
  it('matches Ctrl+Comma only', () => {
    expect(matchesShortcut(ev({ ctrlKey: true, code: 'Comma' }), comma)).toBe(true);
    expect(matchesShortcut(ev({ ctrlKey: true, shiftKey: true, code: 'Comma' }), comma)).toBe(false);
    expect(matchesShortcut(ev({ ctrlKey: true, altKey: true, code: 'Comma' }), comma)).toBe(false);
    expect(matchesShortcut(ev({ code: 'Comma' }), comma)).toBe(false);
  });
  it('matches Ctrl+Shift+Space', () => {
    expect(matchesShortcut(ev({ ctrlKey: true, shiftKey: true, code: 'Space' }), { ctrl: true, shift: true, code: 'Space' })).toBe(true);
  });
});

describe('settingsShortcutAction', () => {
  it('opens only when no dialog is open', () => {
    expect(settingsShortcutAction(false, false, [])).toBe('open');
    expect(settingsShortcutAction(false, false, ['confirm-dialog compact-confirm'])).toBe('ignore');
    expect(settingsShortcutAction(false, false, ['confirm-dialog ai-settings-dialog'])).toBe('ignore');
  });
  it('closes only the lone settings dialog while idle', () => {
    expect(settingsShortcutAction(true, false, ['confirm-dialog settings-dialog'])).toBe('close');
    expect(settingsShortcutAction(true, true, ['confirm-dialog settings-dialog'])).toBe('ignore');
    expect(settingsShortcutAction(true, false, ['confirm-dialog settings-dialog', 'confirm-dialog compact-confirm'])).toBe('ignore');
  });
});
