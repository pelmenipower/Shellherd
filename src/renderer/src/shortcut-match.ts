export interface ShortcutKeys { ctrl: boolean; shift: boolean; code: string }
export type ShortcutEvent = Pick<KeyboardEvent, 'ctrlKey' | 'shiftKey' | 'altKey' | 'code'>;

/** ctrlKey === ctrl, shiftKey === shift, no Alt (AltGr is Ctrl+Alt), code equal. metaKey is ignored (as today). */
export function matchesShortcut(event: ShortcutEvent, keys: ShortcutKeys): boolean {
  return event.ctrlKey === keys.ctrl && event.shiftKey === keys.shift && !event.altKey && event.code === keys.code;
}

export type SettingsShortcutAction = 'open' | 'close' | 'ignore';

/**
 * Ctrl+, toggles only between "nothing open" and "settings open".
 * openDialogClasses: className of every `dialog[open]` in the document.
 */
export function settingsShortcutAction(settingsOpen: boolean, busy: boolean, openDialogClasses: readonly string[]): SettingsShortcutAction {
  if (!settingsOpen) return openDialogClasses.length === 0 ? 'open' : 'ignore';
  if (busy || openDialogClasses.length !== 1) return 'ignore';
  return openDialogClasses[0].split(/\s+/).includes('settings-dialog') ? 'close' : 'ignore';
}
