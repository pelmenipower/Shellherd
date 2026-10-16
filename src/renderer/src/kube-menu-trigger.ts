import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { MenuTarget } from './kube-menus';

/** Shared triggers for the cluster-tab context menus (spec C17). */

/** Keyboard dedupe window: Chromium may send a native `contextmenu` right after the key. */
const DEDUPE_MS = 500;
let lastKeyOpen = -Infinity;

export function isMenuKey(event: { key: string; shiftKey: boolean }): boolean {
  return event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
}

/** Records that the menu was opened with the keyboard at `now`. */
export function markKeyMenu(now: number = Date.now()): void {
  lastKeyOpen = now;
}

/** True for a `contextmenu` event that the keyboard path has already handled (not a real right-click). */
export function isKeyboardContextMenu(event: { button: number }, now: number = Date.now()): boolean {
  return event.button !== 2 || now - lastKeyOpen < DEDUPE_MS;
}

/** Anchor for keyboard-opened menus: left + 24, bottom of the element. */
export function keyMenuAnchor(rect: { left: number; bottom: number }): { x: number; y: number } {
  return { x: rect.left + 24, y: rect.bottom };
}

export function resetKeyMenuForTest(): void {
  lastKeyOpen = -Infinity;
}

export type MenuOpener = (target: MenuTarget, x: number, y: number) => void;

/** Right-click and keyboard handlers for one element; nothing is attached when `onMenu` is absent. */
export function menuHandlers(onMenu: MenuOpener | undefined, target: MenuTarget) {
  return {
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
      if (!onMenu) return;
      event.preventDefault();
      event.stopPropagation();
      if (isKeyboardContextMenu(event)) return;
      onMenu(target, event.clientX, event.clientY);
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      if (!onMenu || !isMenuKey(event)) return;
      event.preventDefault();
      event.stopPropagation();
      markKeyMenu();
      const { x, y } = keyMenuAnchor(event.currentTarget.getBoundingClientRect());
      onMenu(target, x, y);
    },
  };
}
