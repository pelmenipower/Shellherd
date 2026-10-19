import { describe, expect, it } from 'vitest';
import { EMPTY_TOAST, exitedToast, nextToast } from './toast-state';

describe('toast-state', () => {
  it('shows a new message on an empty state', () => {
    expect(nextToast(EMPTY_TOAST, 'Fehler')).toEqual({ message: 'Fehler', closing: false });
  });

  it('starts the exit on null while shown and keeps the text', () => {
    expect(nextToast({ message: 'Fehler', closing: false }, null)).toEqual({ message: 'Fehler', closing: true });
  });

  it('returns the same state on null when empty', () => {
    expect(nextToast(EMPTY_TOAST, null)).toBe(EMPTY_TOAST);
  });

  it('cancels a running exit with a new message', () => {
    expect(nextToast({ message: 'Alt', closing: true }, 'Neu')).toEqual({ message: 'Neu', closing: false });
  });

  it('exitedToast returns EMPTY_TOAST', () => {
    expect(exitedToast()).toBe(EMPTY_TOAST);
  });
});
