import { beforeEach, describe, expect, it } from 'vitest';
import { isKeyboardContextMenu, isMenuKey, keyMenuAnchor, markKeyMenu, resetKeyMenuForTest } from './kube-menu-trigger';

describe('kube-menu-trigger', () => {
  beforeEach(resetKeyMenuForTest);

  it('recognises ContextMenu and Shift+F10 only', () => {
    expect(isMenuKey({ key: 'ContextMenu', shiftKey: false })).toBe(true);
    expect(isMenuKey({ key: 'F10', shiftKey: true })).toBe(true);
    expect(isMenuKey({ key: 'F10', shiftKey: false })).toBe(false);
  });

  it('lets a real right-click through', () => {
    expect(isKeyboardContextMenu({ button: 2 }, 1000)).toBe(false);
  });

  it('ignores contextmenu events that are not a right-click or follow the key', () => {
    expect(isKeyboardContextMenu({ button: 0 }, 1000)).toBe(true);
    markKeyMenu(1000);
    expect(isKeyboardContextMenu({ button: 2 }, 1200)).toBe(true);
    expect(isKeyboardContextMenu({ button: 2 }, 1600)).toBe(false);
  });

  it('anchors at left + 24 and bottom', () => {
    expect(keyMenuAnchor({ left: 10, bottom: 50 })).toEqual({ x: 34, y: 50 });
  });
});
